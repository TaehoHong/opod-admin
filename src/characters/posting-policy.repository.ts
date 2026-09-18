import { Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { DatabaseService } from "../domain/database/database.service";
import {
  characterActionLogs,
  characterPostingPolicies,
  characters,
} from "../domain/database/schema";

// entity repository — DatabaseService는 이 계층에서만 쓴다
// (docs/02-development-rules.md "Module and Repository Rules").

export type PostingPolicyRow = {
  characterId: string;
  enabled: boolean;
  weeklyCadence: number;
  hourStartKst: number;
  hourEndKst: number;
  updatedAt: Date;
};

export type PostingPolicyValues = Omit<
  PostingPolicyRow,
  "characterId" | "updatedAt"
>;

export type PostingRunRow = {
  processingStatus: string;
  scheduledAt: Date;
  finishedAt: Date | null;
  attemptCount: number;
  lastErrorMessage: string | null;
};

@Injectable()
export class PostingPolicyRepository {
  constructor(private readonly database: DatabaseService) {}

  findByCharacter(characterId: string): Promise<PostingPolicyRow | null> {
    return this.database.client
      .select({
        characterId: characterPostingPolicies.characterId,
        enabled: characterPostingPolicies.enabled,
        weeklyCadence: characterPostingPolicies.weeklyCadence,
        hourStartKst: characterPostingPolicies.hourStartKst,
        hourEndKst: characterPostingPolicies.hourEndKst,
        updatedAt: characterPostingPolicies.updatedAt,
      })
      .from(characterPostingPolicies)
      .where(eq(characterPostingPolicies.characterId, characterId))
      .limit(1)
      .then(([row]) => row ?? null);
  }

  async findLatestRun(characterId: string): Promise<PostingRunRow | null> {
    const table = await this.database.client.execute<{
      tableName: string | null;
    }>(
      sql`select to_regclass('opod.character_social_activity_jobs')::text as "tableName"`,
    );
    if (!table.rows[0]?.tableName) return null;

    const result = await this.database.client.execute<PostingRunRow>(sql`
      select
        processing_status as "processingStatus",
        scheduled_at as "scheduledAt",
        finished_at as "finishedAt",
        attempt_count::int as "attemptCount",
        last_error_message as "lastErrorMessage"
      from opod.character_social_activity_jobs
      where character_id = ${characterId}
      order by scheduled_at desc, id desc
      limit 1
    `);
    return result.rows[0] ?? null;
  }

  async upsert(
    characterId: string,
    values: PostingPolicyValues,
  ): Promise<PostingPolicyRow> {
    const [row] = await this.database.client
      .insert(characterPostingPolicies)
      .values({ characterId, ...values })
      .onConflictDoUpdate({
        target: characterPostingPolicies.characterId,
        set: values,
      })
      .returning({
        characterId: characterPostingPolicies.characterId,
        enabled: characterPostingPolicies.enabled,
        weeklyCadence: characterPostingPolicies.weeklyCadence,
        hourStartKst: characterPostingPolicies.hourStartKst,
        hourEndKst: characterPostingPolicies.hourEndKst,
        updatedAt: characterPostingPolicies.updatedAt,
      });
    return row;
  }

  async characterExists(characterId: string): Promise<boolean> {
    const [row] = await this.database.client
      .select({ id: characters.id })
      .from(characters)
      .where(eq(characters.id, characterId))
      .limit(1);
    return row !== null;
  }

  async recordPolicyChange(characterId: string, reason: string): Promise<void> {
    await this.database.client.insert(characterActionLogs).values({
      characterId,
      actionType: "POSTING_POLICY_UPDATED",
      targetTable: "character_posting_policies",
      targetId: characterId,
      reason,
    });
  }
}
