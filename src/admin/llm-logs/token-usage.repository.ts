import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../domain/database/prisma.service";

// entity repository — PrismaService는 이 계층에서만 쓴다
// (docs/02-development-rules.md "Module and Repository Rules").
//
// llm_logs가 provider, model과 토큰 수를 이미 보관하므로 집계는 읽기 전용이며
// schema 변경이 필요 없다.

export type TokenTotals = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  calls: number;
};

export type TokenBreakdown = TokenTotals & { key: string };

export type TokenDailyPoint = TokenTotals & { date: string };

type LlmLogRow = {
  createdAt: Date;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

@Injectable()
export class TokenUsageRepository {
  constructor(private readonly prisma: PrismaService) {}

  // 집계 축이 셋(일자/provider/model)이라 한 번 읽고 메모리에서 나눈다.
  // POC 기간 30일 로그 규모에서는 세 번 질의하는 것보다 단순하고 일관된다.
  findUsageSince(since: Date): Promise<LlmLogRow[]> {
    return this.prisma.llmLog.findMany({
      where: { createdAt: { gte: since }, totalTokens: { not: null } },
      select: {
        createdAt: true,
        provider: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
      },
      orderBy: { createdAt: "asc" },
    });
  }
}
