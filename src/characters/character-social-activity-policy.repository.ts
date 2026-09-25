import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../domain/database/database.service";
import { DatabaseTransactionContext } from "../domain/database/database-transaction-context";
import { characterSocialActivityPolicies } from "../domain/database/schema";

export type CharacterSocialActivityPolicyValues = {
  enabled: boolean;
  activeStartLocalTime: string;
  activeEndLocalTime: string;
  activityIntervalMinutes: number;
  maxDailyPostViews: number;
  maxDailyPostLikes: number;
  maxDailyFollows: number;
  postLikeProbability: string;
};

const fields = {
  characterId: characterSocialActivityPolicies.characterId,
  enabled: characterSocialActivityPolicies.enabled,
  activeStartLocalTime: characterSocialActivityPolicies.activeStartLocalTime,
  activeEndLocalTime: characterSocialActivityPolicies.activeEndLocalTime,
  activityIntervalMinutes:
    characterSocialActivityPolicies.activityIntervalMinutes,
  maxDailyPostViews: characterSocialActivityPolicies.maxDailyPostViews,
  maxDailyPostLikes: characterSocialActivityPolicies.maxDailyPostLikes,
  maxDailyFollows: characterSocialActivityPolicies.maxDailyFollows,
  postLikeProbability: characterSocialActivityPolicies.postLikeProbability,
  nextActivityAt: characterSocialActivityPolicies.nextActivityAt,
  createdAt: characterSocialActivityPolicies.createdAt,
  updatedAt: characterSocialActivityPolicies.updatedAt,
} as const;

@Injectable()
export class CharacterSocialActivityPolicyRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly transactions: DatabaseTransactionContext,
  ) {}

  find(characterId: string) {
    return this.transactions
      .currentOr(this.database.client)
      .select(fields)
      .from(characterSocialActivityPolicies)
      .where(eq(characterSocialActivityPolicies.characterId, characterId))
      .limit(1)
      .then(([row]) => row ?? null);
  }

  async upsert(
    characterId: string,
    values: CharacterSocialActivityPolicyValues,
    nextActivityAt: Date | null,
  ) {
    const client = this.transactions.currentOr(this.database.client);
    const [policy] = await client
      .insert(characterSocialActivityPolicies)
      .values({ characterId, ...values, nextActivityAt })
      .onConflictDoUpdate({
        target: characterSocialActivityPolicies.characterId,
        set: { ...values, nextActivityAt, updatedAt: new Date() },
      })
      .returning(fields);
    return policy;
  }

  async disable(characterId: string) {
    await this.transactions
      .currentOr(this.database.client)
      .update(characterSocialActivityPolicies)
      .set({ enabled: false, nextActivityAt: null, updatedAt: new Date() })
      .where(eq(characterSocialActivityPolicies.characterId, characterId));
  }
}
