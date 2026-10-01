import type {
  ReferenceEmbeddingSource,
  ReferenceEmbeddingWrite,
  RankedReference,
} from "../shared/ai/reference-embedding";
import { Injectable } from "@nestjs/common";
import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";
import type { AssertableMedia } from "../media/media.service";
import { DatabaseService } from "../core/database/database.service";
import {
  characterActionLogs,
  characterVisualProfileReferences,
  characterVisualProfiles,
  characters,
  generationJobs,
  media,
} from "../core/database/schema";

type ReferenceRow = Omit<
  typeof characterVisualProfileReferences.$inferSelect,
  "embedding" | "embeddingModel" | "embeddedAt"
> & { media: { url: string } };
export type VisualProfileRow = typeof characterVisualProfiles.$inferSelect & {
  referenceMedia: ReferenceRow[];
};
export type UncaptionedReference = {
  profileId: string;
  mediaId: string;
  media: { url: string; storageKey: string | null; contentType: string | null };
};
export type VisualProfilePrompts = {
  appearancePrompt: string;
  stylePrompt: string;
  negativePrompt: string;
  providerConfig?: unknown;
};

@Injectable()
export class VisualProfileRepository {
  constructor(private readonly database: DatabaseService) {}

  async listReferenceEmbeddingSources(
    characterId?: string,
  ): Promise<ReferenceEmbeddingSource[]> {
    const r = characterVisualProfileReferences;
    return this.database.client
      .select({
        ownerId: r.profileId,
        mediaId: r.mediaId,
        description: r.description,
        embeddingModel: r.embeddingModel,
        indexed: sql<boolean>`(${r.embedding} IS NOT NULL AND ${r.embeddedAt} IS NOT NULL AND public.vector_norm(${r.embedding}) > 0)`,
      })
      .from(r)
      .innerJoin(
        characterVisualProfiles,
        eq(characterVisualProfiles.id, r.profileId),
      )
      .innerJoin(media, eq(media.id, r.mediaId))
      .where(
        and(
          eq(r.isActive, true),
          isNotNull(media.uploadedAt),
          ne(r.description, ""),
          characterId
            ? eq(characterVisualProfiles.characterId, characterId)
            : undefined,
        ),
      )
      .orderBy(asc(r.profileId), asc(r.sortOrder), asc(r.mediaId));
  }

  async saveReferenceEmbedding(
    input: ReferenceEmbeddingWrite,
  ): Promise<boolean> {
    const r = characterVisualProfileReferences;
    const rows = await this.database.client
      .update(r)
      .set({
        embedding: input.embedding,
        embeddingModel: input.model,
        embeddedAt: new Date(),
      })
      .where(
        and(
          eq(r.profileId, input.ownerId),
          eq(r.mediaId, input.mediaId),
          eq(r.description, input.description),
          eq(r.isActive, true),
          sql`EXISTS (SELECT 1 FROM ${media} WHERE ${media.id} = ${r.mediaId} AND ${media.uploadedAt} IS NOT NULL)`,
        ),
      )
      .returning({ id: r.mediaId });
    return rows.length === 1;
  }

  async searchReferenceEmbeddings(
    characterId: string,
    embedding: number[],
    model: string,
    limit: number,
  ): Promise<RankedReference[]> {
    const r = characterVisualProfileReferences;
    const distance = sql`${r.embedding} OPERATOR(public.<=>) ${JSON.stringify(embedding)}`;
    return this.database.client
      .select({
        id: r.mediaId,
        description: r.description,
        score: sql<number>`1 - (${distance})`,
      })
      .from(r)
      .innerJoin(
        characterVisualProfiles,
        eq(characterVisualProfiles.id, r.profileId),
      )
      .innerJoin(media, eq(media.id, r.mediaId))
      .where(
        and(
          eq(characterVisualProfiles.characterId, characterId),
          eq(r.isActive, true),
          isNotNull(media.uploadedAt),
          ne(r.description, ""),
          eq(r.embeddingModel, model),
          isNotNull(r.embeddedAt),
          sql`public.vector_norm(${r.embedding}) > 0`,
        ),
      )
      .orderBy(asc(distance), asc(r.sortOrder), asc(r.mediaId))
      .limit(limit);
  }

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

  async findProfile(characterId: string): Promise<VisualProfileRow | null> {
    const [profile] = await this.database.client
      .select()
      .from(characterVisualProfiles)
      .where(eq(characterVisualProfiles.characterId, characterId))
      .limit(1);
    if (!profile) return null;
    const references = await this.database.client
      .select({
        profileId: characterVisualProfileReferences.profileId,
        mediaId: characterVisualProfileReferences.mediaId,
        sortOrder: characterVisualProfileReferences.sortOrder,
        description: characterVisualProfileReferences.description,
        isActive: characterVisualProfileReferences.isActive,
        media: { url: media.url },
      })
      .from(characterVisualProfileReferences)
      .innerJoin(media, eq(media.id, characterVisualProfileReferences.mediaId))
      .where(eq(characterVisualProfileReferences.profileId, profile.id))
      .orderBy(
        desc(characterVisualProfileReferences.isActive),
        asc(characterVisualProfileReferences.sortOrder),
      );
    return { ...profile, referenceMedia: references };
  }

  async upsertProfile(
    characterId: string,
    data: VisualProfilePrompts,
  ): Promise<VisualProfileRow> {
    await this.database.client
      .insert(characterVisualProfiles)
      .values({ characterId, ...data })
      .onConflictDoUpdate({
        target: characterVisualProfiles.characterId,
        set: data,
      });
    return (await this.findProfile(characterId))!;
  }

  findUncaptionedReferences(
    characterId: string,
  ): Promise<UncaptionedReference[]> {
    return this.database.client
      .select({
        profileId: characterVisualProfileReferences.profileId,
        mediaId: characterVisualProfileReferences.mediaId,
        media: {
          url: media.url,
          storageKey: media.storageKey,
          contentType: media.contentType,
        },
      })
      .from(characterVisualProfileReferences)
      .innerJoin(
        characterVisualProfiles,
        eq(
          characterVisualProfiles.id,
          characterVisualProfileReferences.profileId,
        ),
      )
      .innerJoin(media, eq(media.id, characterVisualProfileReferences.mediaId))
      .where(
        and(
          eq(characterVisualProfiles.characterId, characterId),
          eq(characterVisualProfileReferences.isActive, true),
          eq(characterVisualProfileReferences.description, ""),
          isNotNull(media.uploadedAt),
        ),
      )
      .orderBy(asc(characterVisualProfileReferences.sortOrder));
  }

  async setReferenceDescription(
    profileId: string,
    mediaId: string,
    description: string,
  ): Promise<void> {
    await this.database.client
      .update(characterVisualProfileReferences)
      .set({
        description,
        embedding: sql`CASE WHEN ${characterVisualProfileReferences.description} IS DISTINCT FROM ${description} THEN NULL ELSE ${characterVisualProfileReferences.embedding} END`,
        embeddingModel: sql`CASE WHEN ${characterVisualProfileReferences.description} IS DISTINCT FROM ${description} THEN NULL ELSE ${characterVisualProfileReferences.embeddingModel} END`,
        embeddedAt: sql`CASE WHEN ${characterVisualProfileReferences.description} IS DISTINCT FROM ${description} THEN NULL ELSE ${characterVisualProfileReferences.embeddedAt} END`,
      })
      .where(
        and(
          eq(characterVisualProfileReferences.profileId, profileId),
          eq(characterVisualProfileReferences.mediaId, mediaId),
        ),
      );
  }

  async replaceReferences(
    characterId: string,
    mediaIds: string[],
  ): Promise<VisualProfileRow> {
    await this.database.client.transaction(async (tx) => {
      const [profile] = await tx
        .insert(characterVisualProfiles)
        .values({ characterId })
        .onConflictDoUpdate({
          target: characterVisualProfiles.characterId,
          set: { characterId },
        })
        .returning({ id: characterVisualProfiles.id });
      await tx
        .update(characterVisualProfileReferences)
        .set({ isActive: false })
        .where(
          and(
            eq(characterVisualProfileReferences.profileId, profile.id),
            eq(characterVisualProfileReferences.isActive, true),
            mediaIds.length > 0
              ? notInArray(characterVisualProfileReferences.mediaId, mediaIds)
              : undefined,
          ),
        );
      for (const [index, mediaId] of mediaIds.entries()) {
        const sortOrder = (index + 1) * 10;
        await tx
          .insert(characterVisualProfileReferences)
          .values({ profileId: profile.id, mediaId, sortOrder, isActive: true })
          .onConflictDoUpdate({
            target: [
              characterVisualProfileReferences.profileId,
              characterVisualProfileReferences.mediaId,
            ],
            set: { sortOrder, isActive: true },
          });
      }
    });
    return (await this.findProfile(characterId))!;
  }

  async createTestGenerationJob(input: {
    characterId: string;
    prompt: string;
  }): Promise<{ id: string; status: string }> {
    const [row] = await this.database.client
      .insert(generationJobs)
      .values({
        characterId: input.characterId,
        mediaType: "image",
        prompt: input.prompt,
      })
      .returning({ id: generationJobs.id, status: generationJobs.status });
    return row;
  }

  async recordActionLog(input: {
    characterId: string;
    actionType: string;
    targetTable: string;
    targetId: string;
    reason: string;
  }): Promise<void> {
    await this.database.client.insert(characterActionLogs).values(input);
  }
}
