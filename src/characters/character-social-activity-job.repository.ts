import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import { DatabaseService } from "../domain/database/database.service";
import { DatabaseTransactionContext } from "../domain/database/database-transaction-context";
import { characterSocialActivityJobs } from "../domain/database/schema";

@Injectable()
export class CharacterSocialActivityJobRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly transactions: DatabaseTransactionContext,
  ) {}

  findLatest(characterId: string) {
    return this.transactions
      .currentOr(this.database.client)
      .select({
        id: characterSocialActivityJobs.id,
        scheduledAt: characterSocialActivityJobs.scheduledAt,
        processingStatus: characterSocialActivityJobs.processingStatus,
        attemptCount: characterSocialActivityJobs.attemptCount,
        lastErrorMessage: characterSocialActivityJobs.lastErrorMessage,
        finishedAt: characterSocialActivityJobs.finishedAt,
      })
      .from(characterSocialActivityJobs)
      .where(eq(characterSocialActivityJobs.characterId, characterId))
      .orderBy(
        desc(characterSocialActivityJobs.scheduledAt),
        desc(characterSocialActivityJobs.id),
      )
      .limit(1)
      .then(([row]) => row ?? null);
  }

  cancelActive(characterId: string) {
    return this.transactions
      .currentOr(this.database.client)
      .update(characterSocialActivityJobs)
      .set({
        processingStatus: "cancelled",
        processingLeaseToken: null,
        processingLeaseExpiresAt: null,
        finishedAt: new Date(),
      })
      .where(
        and(
          eq(characterSocialActivityJobs.characterId, characterId),
          inArray(characterSocialActivityJobs.processingStatus, [
            "queued",
            "running",
          ]),
        ),
      );
  }
}
