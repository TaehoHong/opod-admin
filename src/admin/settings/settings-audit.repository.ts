import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../domain/database/prisma.service";

// entity repository — PrismaService는 이 계층에서만 쓴다
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
  constructor(private readonly prisma: PrismaService) {}

  async listRecentChanges(): Promise<SettingsChangeLog[]> {
    const rows = await this.prisma.consoleLog.findMany({
      where: { actionType: { in: SETTINGS_ACTION_TYPES } },
      orderBy: { id: "desc" },
      take: RECENT_CHANGE_LIMIT,
    });
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
    await this.prisma.consoleLog.createMany({ data: entries });
  }

  // KST 기준 오늘 누적 생성 비용. 설정 화면의 예산 표시에만 쓴다.
  async sumGenerationCostSince(since: Date): Promise<string | null> {
    const aggregate = await this.prisma.generationJob.aggregate({
      _sum: { costUsd: true },
      where: { updatedAt: { gte: since }, costUsd: { not: null } },
    });
    return aggregate._sum.costUsd?.toString() ?? null;
  }
}
