import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { DatabaseService } from "../domain/database/database.service";
import {
  characterActionLogs,
  characterMemories,
  characterPersonas,
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
const memoryFields = {
  id: characterMemories.id,
  characterId: characterMemories.characterId,
  content: characterMemories.content,
  type: characterMemories.type,
  reason: characterMemories.reason,
  createdAt: characterMemories.createdAt,
  updatedAt: characterMemories.updatedAt,
  deletedAt: characterMemories.deletedAt,
} as const;

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
export type MemoryRow = typeof characterMemories.$inferSelect;
export type CharacterStatus = "active" | "inactive";

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
    const [row] = await this.database.client
      .update(characterPersonas)
      .set(data)
      .where(eq(characterPersonas.id, personaId))
      .returning(personaFields);
    return row;
  }

  async softDeletePersona(
    personaId: string,
    deletedAt: Date,
  ): Promise<PersonaRow> {
    const [row] = await this.database.client
      .update(characterPersonas)
      .set({ deletedAt })
      .where(eq(characterPersonas.id, personaId))
      .returning(personaFields);
    return row;
  }

  findMemories(characterId: string): Promise<MemoryRow[]> {
    return this.database.client
      .select(memoryFields)
      .from(characterMemories)
      .where(
        and(
          eq(characterMemories.characterId, characterId),
          isNull(characterMemories.deletedAt),
        ),
      )
      .orderBy(desc(characterMemories.createdAt), desc(characterMemories.id));
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
  }): Promise<MemoryRow> {
    const [row] = await this.database.client
      .insert(characterMemories)
      .values(data)
      .returning(memoryFields);
    return row;
  }

  async updateMemory(
    memoryId: string,
    data: { content?: string; type?: string; reason?: string },
  ): Promise<MemoryRow> {
    const [row] = await this.database.client
      .update(characterMemories)
      .set(data)
      .where(eq(characterMemories.id, memoryId))
      .returning(memoryFields);
    return row;
  }

  async softDeleteMemory(
    memoryId: string,
    deletedAt: Date,
  ): Promise<MemoryRow> {
    const [row] = await this.database.client
      .update(characterMemories)
      .set({ deletedAt })
      .where(eq(characterMemories.id, memoryId))
      .returning(memoryFields);
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
