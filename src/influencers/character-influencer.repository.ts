import { Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { DatabaseService } from "../core/database/database.service";
import { characterInfluencers } from "../core/database/schema";
@Injectable()
export class CharacterInfluencerRepository {
  constructor(private readonly db: DatabaseService) {}
  list(ids: string[]) {
    return ids.length
      ? this.db.client
          .select()
          .from(characterInfluencers)
          .where(inArray(characterInfluencers.characterId, ids))
      : Promise.resolve([]);
  }
  async add(characterId: string, influencerId: bigint) {
    await this.db.client
      .insert(characterInfluencers)
      .values({ characterId, influencerId })
      .onConflictDoNothing();
  }
  async remove(characterId: string, influencerId: bigint) {
    return (
      (
        await this.db.client
          .delete(characterInfluencers)
          .where(
            and(
              eq(characterInfluencers.characterId, characterId),
              eq(characterInfluencers.influencerId, influencerId),
            ),
          )
          .returning()
      ).length > 0
    );
  }
  async replace(characterId: string, oldId: bigint, newId: bigint) {
    return this.db.client.transaction(async (tx) => {
      const removed = await tx
        .delete(characterInfluencers)
        .where(
          and(
            eq(characterInfluencers.characterId, characterId),
            eq(characterInfluencers.influencerId, oldId),
          ),
        )
        .returning();
      if (!removed.length) return false;
      await tx
        .insert(characterInfluencers)
        .values({ characterId, influencerId: newId })
        .onConflictDoNothing();
      return true;
    });
  }
}
