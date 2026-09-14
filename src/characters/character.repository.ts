import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  type DatabaseClient,
  DatabaseService,
} from "../domain/database/database.service";
import {
  characterActionLogs,
  characterMemories,
  characterPersonas,
  characterPersonaFragments,
  characterPersonaCanonLinks,
  characters,
  posts,
  userCharacterFollows,
} from "../domain/database/schema";

const characterFields = {
  id: characters.id,
  publicId: characters.publicId,
  displayName: characters.displayName,
  bio: characters.bio,
  interests: sql<string[]>`coalesce(${characters.interests}, ARRAY[]::text[])`,
} as const;
const characterListFields = {
  ...characterFields,
  status: characters.status,
  createdAt: characters.createdAt,
  _count: {
    posts: sql<number>`(select count(*)::int from ${posts} where ${posts.characterId} = ${characters.id})`,
    userFollowers: sql<number>`(select count(*)::int from ${userCharacterFollows} where ${userCharacterFollows.characterId} = ${characters.id})`,
  },
} as const;
const characterStatusFields = {
  id: characters.id,
  status: characters.status,
  updatedAt: characters.updatedAt,
} as const;
const personaFields = {
  id: characterPersonas.id,
  characterId: characterPersonas.characterId,
  title: characterPersonas.title,
  content: characterPersonas.content,
  sortOrder: characterPersonas.sortOrder,
  createdAt: characterPersonas.createdAt,
  updatedAt: characterPersonas.updatedAt,
  deletedAt: characterPersonas.deletedAt,
} as const;
const fragmentFields = {
  id: characterPersonaFragments.id,
  personaId: characterPersonaFragments.personaId,
  ordinal: characterPersonaFragments.ordinal,
  content: characterPersonaFragments.content,
  kind: characterPersonaFragments.kind,
  injection: characterPersonaFragments.injection,
  recallKeys: characterPersonaFragments.recallKeys,
  createdAt: characterPersonaFragments.createdAt,
  updatedAt: characterPersonaFragments.updatedAt,
} as const;
const memoryFields = {
  id: characterMemories.id,
  characterId: characterMemories.characterId,
  content: characterMemories.content,
  type: characterMemories.type,
  reason: characterMemories.reason,
  kind: characterMemories.kind,
  injection: characterMemories.injection,
  recallKeys: characterMemories.recallKeys,
  sourceRefs: characterMemories.sourceRefs,
  occurredLabel: characterMemories.occurredLabel,
  occurredPrecision: characterMemories.occurredPrecision,
  occurredAt: characterMemories.occurredAt,
  createdAt: characterMemories.createdAt,
  updatedAt: characterMemories.updatedAt,
  deletedAt: characterMemories.deletedAt,
} as const;

type DatabaseTransaction = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];

export type CharacterRow = Pick<
  typeof characters.$inferSelect,
  "id" | "publicId" | "displayName" | "bio"
> & { interests: string[] };
export type CharacterListRow = CharacterRow & {
  status: "active" | "inactive";
  createdAt: Date;
  _count: { posts: number; userFollowers: number };
};
export type CharacterStatusRow = Pick<
  typeof characters.$inferSelect,
  "id" | "status" | "updatedAt"
>;
export type PersonaRow = typeof characterPersonas.$inferSelect;
export type MemoryRow = Pick<
  typeof characterMemories.$inferSelect,
  keyof typeof memoryFields
>;
export type CharacterStatus = "active" | "inactive";
type FragmentInput = Pick<
  typeof characterPersonaFragments.$inferInsert,
  "content" | "kind" | "injection" | "recallKeys"
> & { canonIds?: string[] };

const sourceHash = (content: string) =>
  createHash("sha256").update(content).digest("hex");
const objectHash = (value: unknown) => sourceHash(JSON.stringify(value));
const structureHash = (
  source: { content: string },
  fragments: Array<FragmentInput>,
) =>
  objectHash({
    source: source.content,
    fragments: fragments.map((f) => ({
      content: f.content,
      kind: f.kind,
      injection: f.injection,
      recallKeys: f.recallKeys,
      canonIds: [...new Set(f.canonIds ?? [])].sort(),
    })),
  });
const memoryHash = (
  memory: Pick<
    MemoryRow,
    | "content"
    | "type"
    | "kind"
    | "injection"
    | "recallKeys"
    | "sourceRefs"
    | "occurredLabel"
    | "occurredPrecision"
    | "occurredAt"
  >,
) =>
  objectHash({
    content: memory.content,
    type: memory.type,
    kind: memory.kind,
    injection: memory.injection,
    recallKeys: memory.recallKeys,
    sourceRefs: memory.sourceRefs,
    occurredLabel: memory.occurredLabel,
    occurredPrecision: memory.occurredPrecision,
    occurredAt: memory.occurredAt?.toISOString() ?? null,
  });

@Injectable()
export class CharacterRepository {
  constructor(private readonly database: DatabaseService) {}

  async exists(characterId: string): Promise<boolean> {
    const rows = await this.database.client
      .select({ id: characters.id })
      .from(characters)
      .where(eq(characters.id, characterId))
      .limit(1);
    return rows.length > 0;
  }

  async create(data: {
    publicId: string;
    displayName: string;
    bio: string;
    interests: string[];
  }): Promise<CharacterRow> {
    const [row] = await this.database.client
      .insert(characters)
      .values(data)
      .returning(characterFields);
    return row;
  }

  async update(
    characterId: string,
    data: { displayName?: string; bio?: string; interests?: string[] },
  ): Promise<CharacterRow> {
    const [row] = await this.database.client
      .update(characters)
      .set(data)
      .where(eq(characters.id, characterId))
      .returning(characterFields);
    return row;
  }

  async updateStatus(
    characterId: string,
    status: CharacterStatus,
  ): Promise<CharacterStatusRow> {
    const [row] = await this.database.client
      .update(characters)
      .set({ status })
      .where(eq(characters.id, characterId))
      .returning(characterStatusFields);
    return row;
  }

  findDetail(characterId: string): Promise<CharacterListRow | null> {
    return this.database.client
      .select(characterListFields)
      .from(characters)
      .where(eq(characters.id, characterId))
      .limit(1)
      .then(([row]) => row ?? null);
  }

  async cursorMatchesFilter(
    cursorId: string,
    status?: CharacterStatus,
  ): Promise<boolean> {
    const rows = await this.database.client
      .select({ id: characters.id })
      .from(characters)
      .where(
        and(
          eq(characters.id, cursorId),
          status === undefined ? undefined : eq(characters.status, status),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async findManyForList(input: {
    status?: CharacterStatus;
    take: number;
    cursor?: string;
  }): Promise<CharacterListRow[]> {
    const [cursor] = input.cursor
      ? await this.database.client
          .select({ createdAt: characters.createdAt, id: characters.id })
          .from(characters)
          .where(eq(characters.id, input.cursor))
          .limit(1)
      : [];
    return this.database.client
      .select(characterListFields)
      .from(characters)
      .where(
        and(
          input.status === undefined
            ? undefined
            : eq(characters.status, input.status),
          cursor
            ? or(
                lt(characters.createdAt, cursor.createdAt),
                and(
                  eq(characters.createdAt, cursor.createdAt),
                  lt(characters.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(characters.createdAt), desc(characters.id))
      .limit(input.take);
  }

  findPersonas(characterId: string): Promise<PersonaRow[]> {
    return this.database.client
      .select(personaFields)
      .from(characterPersonas)
      .where(
        and(
          eq(characterPersonas.characterId, characterId),
          isNull(characterPersonas.deletedAt),
        ),
      )
      .orderBy(
        asc(characterPersonas.sortOrder),
        asc(characterPersonas.createdAt),
        asc(characterPersonas.id),
      );
  }

  findPersona(
    characterId: string,
    personaId: string,
  ): Promise<{ id: string } | null> {
    return this.database.client
      .select({ id: characterPersonas.id })
      .from(characterPersonas)
      .where(
        and(
          eq(characterPersonas.id, personaId),
          eq(characterPersonas.characterId, characterId),
          isNull(characterPersonas.deletedAt),
        ),
      )
      .limit(1)
      .then(([row]) => row ?? null);
  }

  async highestPersonaSortOrder(characterId: string): Promise<number> {
    const [top] = await this.database.client
      .select({ sortOrder: characterPersonas.sortOrder })
      .from(characterPersonas)
      .where(
        and(
          eq(characterPersonas.characterId, characterId),
          isNull(characterPersonas.deletedAt),
        ),
      )
      .orderBy(desc(characterPersonas.sortOrder))
      .limit(1);
    return top?.sortOrder ?? 0;
  }

  async createPersona(data: {
    characterId: string;
    title: string;
    content: string;
    sortOrder: number;
  }): Promise<PersonaRow> {
    const [row] = await this.database.client
      .insert(characterPersonas)
      .values(data)
      .returning(personaFields);
    return row;
  }

  async updatePersona(
    personaId: string,
    data: { title?: string; content?: string; sortOrder?: number },
  ): Promise<PersonaRow> {
    return this.database.client.transaction(async (tx) => {
      const [owner] = await tx
        .select({ characterId: characterPersonas.characterId })
        .from(characterPersonas)
        .where(eq(characterPersonas.id, personaId));
      if (owner)
        await tx
          .select({ id: characters.id })
          .from(characters)
          .where(eq(characters.id, owner.characterId))
          .for("update");
      const [source] = await tx
        .select(personaFields)
        .from(characterPersonas)
        .where(eq(characterPersonas.id, personaId))
        .for("update");
      if (data.content !== undefined && data.content !== source.content) {
        const [fragment] = await tx
          .select({ id: characterPersonaFragments.id })
          .from(characterPersonaFragments)
          .where(eq(characterPersonaFragments.personaId, personaId))
          .limit(1);
        if (fragment)
          throw new ConflictException(
            "Use persona structure API to update source and fragments together",
          );
      }
      const [row] = await tx
        .update(characterPersonas)
        .set(data)
        .where(eq(characterPersonas.id, personaId))
        .returning(personaFields);
      return row;
    });
  }

  async findPersonaStructure(characterId: string, personaId: string) {
    return this.database.client.transaction(async (tx) => {
      const [source] = await tx
        .select(personaFields)
        .from(characterPersonas)
        .where(
          and(
            eq(characterPersonas.id, personaId),
            eq(characterPersonas.characterId, characterId),
            isNull(characterPersonas.deletedAt),
          ),
        )
        .for("share");
      if (!source) throw new BadRequestException("Character persona not found");
      const fragments = await tx
        .select(fragmentFields)
        .from(characterPersonaFragments)
        .where(eq(characterPersonaFragments.personaId, personaId))
        .orderBy(asc(characterPersonaFragments.ordinal));
      const links = fragments.length
        ? await tx
            .select()
            .from(characterPersonaCanonLinks)
            .where(
              inArray(
                characterPersonaCanonLinks.fragmentId,
                fragments.map((f) => f.id),
              ),
            )
        : [];
      const linked = fragments.map((fragment) => ({
        ...fragment,
        canonIds: links
          .filter((l) => l.fragmentId === fragment.id)
          .map((l) => l.memoryId)
          .sort(),
      }));
      return {
        ...source,
        sourceSha256: sourceHash(source.content),
        structureSha256: structureHash(source, linked),
        fragments: linked,
      };
    });
  }

  async replacePersonaStructure(input: {
    characterId: string;
    personaId: string;
    sourceSha256: string;
    structureSha256?: string;
    content?: string;
    fragments: FragmentInput[];
  }) {
    return this.database.client.transaction(async (tx) => {
      await tx
        .select({ id: characters.id })
        .from(characters)
        .where(eq(characters.id, input.characterId))
        .for("update");
      const [source] = await tx
        .select(personaFields)
        .from(characterPersonas)
        .where(
          and(
            eq(characterPersonas.id, input.personaId),
            eq(characterPersonas.characterId, input.characterId),
            isNull(characterPersonas.deletedAt),
          ),
        )
        .for("update");
      if (!source) throw new BadRequestException("Character persona not found");
      if (sourceHash(source.content) !== input.sourceSha256)
        throw new ConflictException(
          "Persona source changed; reread before saving",
        );
      const currentFragments = await tx
        .select(fragmentFields)
        .from(characterPersonaFragments)
        .where(eq(characterPersonaFragments.personaId, input.personaId))
        .orderBy(asc(characterPersonaFragments.ordinal));
      const currentLinks = currentFragments.length
        ? await tx
            .select()
            .from(characterPersonaCanonLinks)
            .where(
              inArray(
                characterPersonaCanonLinks.fragmentId,
                currentFragments.map((f) => f.id),
              ),
            )
        : [];
      const current = currentFragments.map((fragment) => ({
        ...fragment,
        canonIds: currentLinks
          .filter((l) => l.fragmentId === fragment.id)
          .map((l) => l.memoryId)
          .sort(),
      }));
      const requestsLinks = input.fragments.some(
        (f) => (f.canonIds?.length ?? 0) > 0,
      );
      if (
        (input.structureSha256 !== undefined &&
          input.structureSha256 !== structureHash(source, current)) ||
        ((currentLinks.length > 0 || requestsLinks) &&
          input.structureSha256 === undefined)
      )
        throw new ConflictException(
          "Persona structure changed; reread before saving",
        );
      const canonIds = [
        ...new Set(input.fragments.flatMap((f) => f.canonIds ?? [])),
      ];
      if (
        input.fragments.some(
          (f) =>
            (f.canonIds?.length ?? 0) > 0 && f.injection !== "never_prompt",
        )
      )
        throw new BadRequestException(
          "Linked persona fragments must be never_prompt",
        );
      if (canonIds.length) {
        const memories = await tx
          .select({ id: characterMemories.id })
          .from(characterMemories)
          .where(
            and(
              inArray(characterMemories.id, canonIds),
              eq(characterMemories.characterId, input.characterId),
              isNull(characterMemories.deletedAt),
            ),
          )
          .for("update");
        if (memories.length !== canonIds.length)
          throw new BadRequestException(
            "Canon links must reference active memories for this character",
          );
      }
      const content =
        input.content === undefined ? source.content : input.content;
      if (
        typeof content !== "string" ||
        !content.trim() ||
        input.fragments.map((f) => f.content).join("") !== content
      ) {
        throw new BadRequestException(
          "Persona fragments must preserve the complete source exactly",
        );
      }
      await tx
        .delete(characterPersonaFragments)
        .where(eq(characterPersonaFragments.personaId, input.personaId));
      const fragments = await tx
        .insert(characterPersonaFragments)
        .values(
          input.fragments.map((fragment, ordinal) => ({
            content: fragment.content,
            kind: fragment.kind,
            injection: fragment.injection,
            recallKeys: fragment.recallKeys,
            personaId: input.personaId,
            ordinal,
          })),
        )
        .returning(fragmentFields);
      const linkValues = fragments.flatMap((fragment, ordinal) =>
        [...new Set(input.fragments[ordinal].canonIds ?? [])].map(
          (memoryId) => ({ fragmentId: fragment.id, memoryId }),
        ),
      );
      if (linkValues.length)
        await tx.insert(characterPersonaCanonLinks).values(linkValues);
      const [updated] =
        content === source.content
          ? [source]
          : await tx
              .update(characterPersonas)
              .set({ content })
              .where(eq(characterPersonas.id, input.personaId))
              .returning(personaFields);
      await tx.insert(characterActionLogs).values({
        characterId: input.characterId,
        actionType: "PERSONA_UPDATED",
        targetTable: "character_personas",
        targetId: input.personaId,
        reason: "persona source and structure saved",
      });
      return {
        ...updated,
        sourceSha256: sourceHash(content),
        structureSha256: structureHash({ content }, input.fragments),
        fragments: fragments
          .sort((a, b) => a.ordinal - b.ordinal)
          .map((fragment, ordinal) => ({
            ...fragment,
            canonIds: [
              ...new Set(input.fragments[ordinal].canonIds ?? []),
            ].sort(),
          })),
      };
    });
  }

  async updateMemoryRouting(
    characterId: string,
    memoryId: string,
    data: {
      kind: string;
      injection: string;
      recallKeys: string[];
      memorySha256?: string;
    },
  ): Promise<MemoryRow> {
    return this.database.client.transaction(async (tx) => {
      await tx
        .select({ id: characters.id })
        .from(characters)
        .where(eq(characters.id, characterId))
        .for("update");
      const [current] = await tx
        .select(memoryFields)
        .from(characterMemories)
        .where(
          and(
            eq(characterMemories.id, memoryId),
            eq(characterMemories.characterId, characterId),
            isNull(characterMemories.deletedAt),
          ),
        )
        .for("update");
      if (!current) throw new BadRequestException("Character memory not found");
      const linked = await tx
        .select({ fragmentId: characterPersonaCanonLinks.fragmentId })
        .from(characterPersonaCanonLinks)
        .where(eq(characterPersonaCanonLinks.memoryId, memoryId))
        .limit(1);
      if (
        (data.memorySha256 !== undefined &&
          data.memorySha256 !== memoryHash(current)) ||
        (linked.length && data.memorySha256 === undefined)
      )
        throw new ConflictException(
          "Character memory changed; reread before saving",
        );
      const update = {
        kind: data.kind,
        injection: data.injection,
        recallKeys: data.recallKeys,
      };
      const [row] = await tx
        .update(characterMemories)
        .set({ ...update, type: update.kind })
        .where(
          and(
            eq(characterMemories.id, memoryId),
            eq(characterMemories.characterId, characterId),
            isNull(characterMemories.deletedAt),
          ),
        )
        .returning(memoryFields);
      if (!row) throw new BadRequestException("Character memory not found");
      await tx.insert(characterActionLogs).values({
        characterId,
        actionType: "MEMORY_UPDATED",
        targetTable: "character_canon_memories",
        targetId: memoryId,
        reason: "memory routing saved",
      });
      return Object.assign(row, { memorySha256: memoryHash(row) });
    });
  }

  async softDeletePersona(
    personaId: string,
    deletedAt: Date,
  ): Promise<PersonaRow> {
    return this.database.client.transaction(async (tx) => {
      const [persona] = await tx
        .select({ characterId: characterPersonas.characterId })
        .from(characterPersonas)
        .where(eq(characterPersonas.id, personaId));
      if (persona)
        await tx
          .select({ id: characters.id })
          .from(characters)
          .where(eq(characters.id, persona.characterId))
          .for("update");
      await tx
        .select({ id: characterPersonas.id })
        .from(characterPersonas)
        .where(eq(characterPersonas.id, personaId))
        .for("update");
      const linked = await tx
        .select({ fragmentId: characterPersonaCanonLinks.fragmentId })
        .from(characterPersonaCanonLinks)
        .innerJoin(
          characterPersonaFragments,
          eq(
            characterPersonaFragments.id,
            characterPersonaCanonLinks.fragmentId,
          ),
        )
        .where(eq(characterPersonaFragments.personaId, personaId))
        .limit(1);
      if (linked.length)
        throw new ConflictException(
          "Linked persona must be unlinked before deletion",
        );
      const [row] = await tx
        .update(characterPersonas)
        .set({ deletedAt })
        .where(eq(characterPersonas.id, personaId))
        .returning(personaFields);
      return row;
    });
  }

  async findMemories(
    characterId: string,
  ): Promise<Array<MemoryRow & { memorySha256: string }>> {
    const rows = await this.database.client
      .select(memoryFields)
      .from(characterMemories)
      .where(
        and(
          eq(characterMemories.characterId, characterId),
          isNull(characterMemories.deletedAt),
        ),
      )
      .orderBy(desc(characterMemories.createdAt), desc(characterMemories.id));
    return rows.map((row) =>
      Object.assign(row, { memorySha256: memoryHash(row) }),
    );
  }

  findMemory(
    characterId: string,
    memoryId: string,
  ): Promise<{ id: string } | null> {
    return this.database.client
      .select({ id: characterMemories.id })
      .from(characterMemories)
      .where(
        and(
          eq(characterMemories.id, memoryId),
          eq(characterMemories.characterId, characterId),
          isNull(characterMemories.deletedAt),
        ),
      )
      .limit(1)
      .then(([row]) => row ?? null);
  }

  async createMemory(data: {
    characterId: string;
    content: string;
    type: string;
    reason: string;
    kind?: string;
    injection?: string;
  }): Promise<MemoryRow> {
    const [row] = await this.database.client
      .insert(characterMemories)
      .values(data)
      .returning(memoryFields);
    return row;
  }

  async updateMemory(
    characterId: string,
    memoryId: string,
    data: {
      content?: string;
      type?: string;
      reason?: string;
      kind?: string;
      injection?: string;
      recallKeys?: string[];
      sourceRefs?: unknown[] | null;
      occurredLabel?: string | null;
      occurredPrecision?: string | null;
      occurredAt?: Date | null;
      memorySha256?: string;
    },
  ): Promise<MemoryRow> {
    return this.database.client.transaction(async (tx) => {
      await tx
        .select({ id: characters.id })
        .from(characters)
        .where(eq(characters.id, characterId))
        .for("update");
      const [current] = await tx
        .select(memoryFields)
        .from(characterMemories)
        .where(
          and(
            eq(characterMemories.id, memoryId),
            eq(characterMemories.characterId, characterId),
            isNull(characterMemories.deletedAt),
          ),
        )
        .for("update");
      if (!current) throw new BadRequestException("Character memory not found");
      const linked = await tx
        .select({ fragmentId: characterPersonaCanonLinks.fragmentId })
        .from(characterPersonaCanonLinks)
        .where(eq(characterPersonaCanonLinks.memoryId, memoryId))
        .limit(1);
      if (
        (data.memorySha256 !== undefined &&
          data.memorySha256 !== memoryHash(current)) ||
        (linked.length && data.memorySha256 === undefined)
      )
        throw new ConflictException(
          "Character memory changed; reread before saving",
        );
      await this.validateSourceRefs(tx, characterId, data.sourceRefs);
      const update = { ...data };
      delete update.memorySha256;
      const [row] = await tx
        .update(characterMemories)
        .set({
          ...update,
          ...(update.content === undefined
            ? {}
            : {
                // Compare with the locked row in this UPDATE, not a stale preread.
                embedding: sql`CASE WHEN ${characterMemories.content} = ${update.content} THEN ${characterMemories.embedding} ELSE NULL END`,
                embeddingModel: sql`CASE WHEN ${characterMemories.content} = ${update.content} THEN ${characterMemories.embeddingModel} ELSE NULL END`,
                embeddingSourceSha256: sql`CASE WHEN ${characterMemories.content} = ${update.content} THEN ${characterMemories.embeddingSourceSha256} ELSE NULL END`,
                embeddedAt: sql`CASE WHEN ${characterMemories.content} = ${update.content} THEN ${characterMemories.embeddedAt} ELSE NULL END`,
              }),
        })
        .where(eq(characterMemories.id, memoryId))
        .returning(memoryFields);
      return Object.assign(row, { memorySha256: memoryHash(row) });
    });
  }

  private async validateSourceRefs(
    tx: DatabaseTransaction,
    characterId: string,
    refs: unknown[] | null | undefined,
  ) {
    if (refs == null) return;
    for (const value of refs as Array<Record<string, unknown>>) {
      if (value.kind === "manual")
        throw new BadRequestException(
          "Manual sources are unsupported until an approval record can be verified",
        );
      const quote = value.quote as string;
      if (!quote.trim())
        throw new BadRequestException("Source quote must not be blank");
      if (sourceHash(quote) !== value.sha256)
        throw new BadRequestException("Source quote SHA-256 does not match");
      if (value.kind === "persona_source") {
        const [source] = await tx
          .select({ content: characterPersonas.content })
          .from(characterPersonas)
          .where(
            and(
              eq(characterPersonas.id, value.sourceId as string),
              eq(characterPersonas.characterId, characterId),
              isNull(characterPersonas.deletedAt),
            ),
          )
          .for("share");
        if (!source || sourceHash(source.content) !== value.sourceSha256)
          throw new BadRequestException(
            "Persona source is missing, foreign, or stale",
          );
        const bytes = Buffer.from(source.content, "utf8");
        const start = value.byteStart as number,
          end = value.byteEnd as number;
        if (
          !Number.isInteger(start) ||
          !Number.isInteger(end) ||
          start < 0 ||
          end <= start ||
          end > bytes.length ||
          bytes.subarray(start, end).toString("utf8") !== quote
        )
          throw new BadRequestException(
            "Persona source byte range does not match quote",
          );
      } else if (value.kind === "post") {
        const [post] = await tx
          .select({ content: posts.content })
          .from(posts)
          .where(
            and(
              eq(posts.id, value.sourceId as string),
              eq(posts.characterId, characterId),
            ),
          )
          .limit(1);
        if (!post || !post.content.includes(quote))
          throw new BadRequestException(
            "Post source is missing, foreign, or does not contain quote",
          );
      }
    }
  }

  async softDeleteMemory(
    memoryId: string,
    deletedAt: Date,
  ): Promise<MemoryRow> {
    return this.database.client.transaction(async (tx) => {
      const [memory] = await tx
        .select({ characterId: characterMemories.characterId })
        .from(characterMemories)
        .where(eq(characterMemories.id, memoryId));
      if (memory)
        await tx
          .select({ id: characters.id })
          .from(characters)
          .where(eq(characters.id, memory.characterId))
          .for("update");
      await tx
        .select({ id: characterMemories.id })
        .from(characterMemories)
        .where(eq(characterMemories.id, memoryId))
        .for("update");
      const linked = await tx
        .select({ fragmentId: characterPersonaCanonLinks.fragmentId })
        .from(characterPersonaCanonLinks)
        .where(eq(characterPersonaCanonLinks.memoryId, memoryId))
        .limit(1);
      if (linked.length)
        throw new ConflictException(
          "Linked canon memory must be unlinked before deletion",
        );
      const [row] = await tx
        .update(characterMemories)
        .set({ deletedAt })
        .where(eq(characterMemories.id, memoryId))
        .returning(memoryFields);
      return row;
    });
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
