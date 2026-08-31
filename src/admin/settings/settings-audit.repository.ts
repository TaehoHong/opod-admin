import { Injectable } from "@nestjs/common";
import { and, desc, gte, inArray, isNotNull, sum } from "drizzle-orm";
import { DatabaseService } from "../../domain/database/database.service";
import { consoleLogs, generationJobs } from "../../domain/database/schema";

// entity repository — DatabaseService는 이 계층에서만 쓴다
// (docs/02-development-rules.md "Module and Repository Rules").

export type SettingsChangeLog = {
  id: string;
  adminEmail: string | null;
  actionType: string;
  target: string | null;
  summary: string;
  createdAt: string;
};

export type SettingsChangeEntry = {
  adminId: string | null;
  adminEmail: string | null;
  actionType: string;
  target: string;
  summary: string;
};

const SETTINGS_ACTION_TYPES = ["SETTINGS_SET", "SETTINGS_CLEAR"];
const RECENT_CHANGE_LIMIT = 20;

@Injectable()
export class SettingsAuditRepository {
  constructor(private readonly database: DatabaseService) {}

  async listRecentChanges(): Promise<SettingsChangeLog[]> {
    const rows = await this.database.client
      .select()
      .from(consoleLogs)
      .where(inArray(consoleLogs.actionType, SETTINGS_ACTION_TYPES))
      .orderBy(desc(consoleLogs.id))
      .limit(RECENT_CHANGE_LIMIT);
    return rows.map((row) => ({
      id: String(row.id),
      adminEmail: row.adminEmail,
      actionType: row.actionType,
      target: row.target,
      summary: row.summary,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async recordChanges(entries: SettingsChangeEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.database.client.insert(consoleLogs).values(entries);
  }

  // KST 기준 오늘 누적 생성 비용. 설정 화면의 예산 표시에만 쓴다.
  async sumGenerationCostSince(since: Date): Promise<string | null> {
    const [aggregate] = await this.database.client
      .select({ value: sum(generationJobs.costUsd) })
      .from(generationJobs)
      .where(
        and(
          gte(generationJobs.updatedAt, since),
          isNotNull(generationJobs.costUsd),
        ),
      );
    return aggregate?.value ?? null;
  }
}
