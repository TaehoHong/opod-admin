import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";
import { DatabaseService } from "../core/database/database.service";
import { characterReferenceLinks } from "../core/database/schema";

export type CharacterReferenceLinkRow =
  typeof characterReferenceLinks.$inferSelect;

@Injectable()
export class CharacterReferenceLinkRepository {
  constructor(private readonly database: DatabaseService) {}

  list(characterId: string) {
    return this.database.client
      .select()
      .from(characterReferenceLinks)
      .where(eq(characterReferenceLinks.characterId, characterId))
      .orderBy(asc(characterReferenceLinks.id));
  }

  async create(characterId: string, url: string) {
    const [row] = await this.database.client
      .insert(characterReferenceLinks)
      .values({ characterId, url })
      .returning();
    return row;
  }

  listForCharacters(characterIds: string[]) {
    return this.database.client
      .select()
      .from(characterReferenceLinks)
      .where(inArray(characterReferenceLinks.characterId, characterIds))
      .orderBy(asc(characterReferenceLinks.id));
  }

  async update(characterId: string, id: bigint, url: string) {
    const [row] = await this.database.client
      .update(characterReferenceLinks)
      .set({ url, updatedAt: new Date() })
      .where(
        and(
          eq(characterReferenceLinks.characterId, characterId),
          eq(characterReferenceLinks.id, id),
        ),
      )
      .returning();
    return row ?? null;
  }

  async delete(characterId: string, id: bigint) {
    const [row] = await this.database.client
      .delete(characterReferenceLinks)
      .where(
        and(
          eq(characterReferenceLinks.characterId, characterId),
          eq(characterReferenceLinks.id, id),
        ),
      )
      .returning({ id: characterReferenceLinks.id });
    return row ?? null;
  }
}
