import { Injectable } from "@nestjs/common";
import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  lt,
  notInArray,
  or,
} from "drizzle-orm";
import type { AssertableMedia } from "../media/media.service";
import { DatabaseService } from "../../domain/database/database.service";
import {
  characterLocationReferences,
  characterLocations,
  characters,
  media,
} from "../../domain/database/schema";

export type LocationRow = typeof characterLocations.$inferSelect & {
  character: { id: string; displayName: string; publicId: string } | null;
  references: Array<
    Omit<
      typeof characterLocationReferences.$inferSelect,
      "embedding" | "embeddingModel" | "embeddedAt"
    > & {
      media: Pick<
        typeof media.$inferSelect,
        "id" | "url" | "width" | "height" | "uploadedAt"
      >;
    }
  >;
};
export type LocationScope = "all" | "global" | "character";
export class DuplicateLocationKeyError extends Error {}

@Injectable()
export class LocationsRepository {
  constructor(private readonly database: DatabaseService) {}

  async characterExists(characterId: string): Promise<boolean> {
    const rows = await this.database.client
      .select({ id: characters.id })
      .from(characters)
      .where(eq(characters.id, characterId))
      .limit(1);
    return rows.length > 0;
  }

  findUploadedMedia(mediaId: string): Promise<AssertableMedia | null> {
    return this.database.client
      .select({
        id: media.id,
        mediaType: media.mediaType,
        url: media.url,
        width: media.width,
        height: media.height,
        durationSeconds: media.durationSeconds,
        uploadedAt: media.uploadedAt,
      })
      .from(media)
      .where(eq(media.id, mediaId))
      .limit(1)
      .then(([row]) => row ?? null);
  }

  async cursorMatchesFilter(
    cursorId: string,
    filter: { characterId?: string; scope: LocationScope },
  ): Promise<boolean> {
    const rows = await this.database.client
      .select({ id: characterLocations.id })
      .from(characterLocations)
      .where(
        and(
          eq(characterLocations.id, cursorId),
          isNull(characterLocations.deletedAt),
          this.scopeCondition(filter),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async findMany(input: {
    characterId?: string;
    scope: LocationScope;
    take: number;
    cursorId?: string;
  }): Promise<LocationRow[]> {
    const [cursor] = input.cursorId
      ? await this.database.client
          .select({
            id: characterLocations.id,
            updatedAt: characterLocations.updatedAt,
          })
          .from(characterLocations)
          .where(eq(characterLocations.id, input.cursorId))
          .limit(1)
      : [];
    const rows = await this.database.client
      .select()
      .from(characterLocations)
      .where(
        and(
          isNull(characterLocations.deletedAt),
          this.scopeCondition(input),
          cursor
            ? or(
                lt(characterLocations.updatedAt, cursor.updatedAt),
                and(
                  eq(characterLocations.updatedAt, cursor.updatedAt),
                  lt(characterLocations.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(characterLocations.updatedAt), desc(characterLocations.id))
      .limit(input.take);
    return this.hydrate(rows);
  }

  async findById(locationId: string): Promise<LocationRow | null> {
    const [row] = await this.database.client
      .select()
      .from(characterLocations)
      .where(
        and(
          eq(characterLocations.id, locationId),
          isNull(characterLocations.deletedAt),
        ),
      )
      .limit(1);
    return row ? (await this.hydrate([row]))[0] : null;
  }

  async create(
    data: typeof characterLocations.$inferInsert,
  ): Promise<LocationRow> {
    try {
      const [row] = await this.database.client
        .insert(characterLocations)
        .values(data)
        .returning();
      return (await this.hydrate([row]))[0];
    } catch (error) {
      this.rethrowDuplicate(error, data.locationKey);
    }
  }

  async update(
    locationId: string,
    data: Partial<
      Pick<
        typeof characterLocations.$inferInsert,
        | "characterId"
        | "locationKey"
        | "displayName"
        | "description"
        | "visualPrompt"
        | "negativePrompt"
        | "referenceNegativePrompt"
      >
    >,
  ): Promise<LocationRow> {
    try {
      const [row] = await this.database.client
        .update(characterLocations)
        .set(data)
        .where(eq(characterLocations.id, locationId))
        .returning();
      return (await this.hydrate([row]))[0];
    } catch (error) {
      this.rethrowDuplicate(error, data.locationKey ?? "");
    }
  }

  async softDelete(locationId: string): Promise<void> {
    await this.database.client
      .update(characterLocations)
      .set({ deletedAt: new Date() })
      .where(eq(characterLocations.id, locationId));
  }

  async replaceReferences(
    locationId: string,
    references: Array<{ mediaId: string; description: string }>,
  ): Promise<LocationRow> {
    await this.database.client.transaction(async (tx) => {
      await tx.delete(characterLocationReferences).where(
        and(
          eq(characterLocationReferences.locationId, locationId),
          references.length > 0
            ? notInArray(
                characterLocationReferences.mediaId,
                references.map((item) => item.mediaId),
              )
            : undefined,
        ),
      );
      for (const [index, reference] of references.entries()) {
        await tx
          .insert(characterLocationReferences)
          .values({ locationId, ...reference, sortOrder: (index + 1) * 10 })
          .onConflictDoUpdate({
            target: [
              characterLocationReferences.locationId,
              characterLocationReferences.mediaId,
            ],
            set: {
              description: reference.description,
              sortOrder: (index + 1) * 10,
            },
          });
      }
    });
    return (await this.findById(locationId))!;
  }

  private scopeCondition(input: {
    characterId?: string;
    scope: LocationScope;
  }) {
    if (input.characterId)
      return eq(characterLocations.characterId, input.characterId);
    if (input.scope === "global") return isNull(characterLocations.characterId);
    if (input.scope === "character")
      return isNotNull(characterLocations.characterId);
    return undefined;
  }

  private async hydrate(
    rows: Array<typeof characterLocations.$inferSelect>,
  ): Promise<LocationRow[]> {
    return Promise.all(
      rows.map(async (row) => {
        const [character, references] = await Promise.all([
          row.characterId
            ? this.database.client
                .select({
                  id: characters.id,
                  displayName: characters.displayName,
                  publicId: characters.publicId,
                })
                .from(characters)
                .where(eq(characters.id, row.characterId))
                .limit(1)
                .then(([value]) => value ?? null)
            : null,
          this.database.client
            .select({
              locationId: characterLocationReferences.locationId,
              mediaId: characterLocationReferences.mediaId,
              sortOrder: characterLocationReferences.sortOrder,
              description: characterLocationReferences.description,
              createdAt: characterLocationReferences.createdAt,
              updatedAt: characterLocationReferences.updatedAt,
              media: {
                id: media.id,
                url: media.url,
                width: media.width,
                height: media.height,
                uploadedAt: media.uploadedAt,
              },
            })
            .from(characterLocationReferences)
            .innerJoin(media, eq(media.id, characterLocationReferences.mediaId))
            .where(eq(characterLocationReferences.locationId, row.id))
            .orderBy(asc(characterLocationReferences.sortOrder)),
        ]);
        return { ...row, character, references };
      }),
    );
  }

  private rethrowDuplicate(error: unknown, locationKey: string): never {
    const code =
      (error as { code?: string }).code ??
      (error as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") throw new DuplicateLocationKeyError(locationKey);
    throw error;
  }
}
