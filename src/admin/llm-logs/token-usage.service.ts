import { BadRequestException, Injectable } from "@nestjs/common";
import {
  TokenBreakdown,
  TokenDailyPoint,
  TokenTotals,
  TokenUsageRepository,
} from "./token-usage.repository";

// 토큰 사용량 대시보드 (docs/00-overview.md "토큰 사용량").
// 기본 30일, 기간 합계·추이와 provider/model 집계를 제공한다. 호출별 내역은
// LLM 로그 화면에서 보므로 여기서 목록을 만들지 않는다.

const DEFAULT_DAYS = 30;
const MAX_DAYS = 180;

export type TokenUsageSummary = {
  days: number;
  from: string;
  totals: TokenTotals;
  daily: TokenDailyPoint[];
  byProvider: TokenBreakdown[];
  byModel: TokenBreakdown[];
};

function emptyTotals(): TokenTotals {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0 };
}

function add(
  target: TokenTotals,
  row: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  },
): void {
  target.inputTokens += row.inputTokens ?? 0;
  target.outputTokens += row.outputTokens ?? 0;
  target.totalTokens += row.totalTokens ?? 0;
  target.calls += 1;
}

function accumulate<T extends string>(
  bucket: Map<T, TokenTotals>,
  key: T,
  row: Parameters<typeof add>[1],
): void {
  const current = bucket.get(key) ?? emptyTotals();
  add(current, row);
  bucket.set(key, current);
}

// 사용량이 큰 순으로 내려주면 화면이 정렬 없이 그대로 쓸 수 있다.
function toBreakdown(bucket: Map<string, TokenTotals>): TokenBreakdown[] {
  return [...bucket.entries()]
    .map(([key, totals]) => ({ key, ...totals }))
    .sort((left, right) => right.totalTokens - left.totalTokens);
}

@Injectable()
export class TokenUsageService {
  constructor(private readonly usage: TokenUsageRepository) {}

  async summarize(input: {
    days?: string;
    now?: Date;
  }): Promise<TokenUsageSummary> {
    const days = this.parseDays(input.days);
    const now = input.now ?? new Date();
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const rows = await this.usage.findUsageSince(from);
    const totals = emptyTotals();
    const daily = new Map<string, TokenTotals>();
    const byProvider = new Map<string, TokenTotals>();
    const byModel = new Map<string, TokenTotals>();

    for (const row of rows) {
      add(totals, row);
      accumulate(daily, row.createdAt.toISOString().slice(0, 10), row);
      accumulate(byProvider, row.provider, row);
      accumulate(byModel, row.model, row);
    }

    return {
      days,
      from: from.toISOString(),
      totals,
      // 추이는 시간순이어야 하므로 사용량 정렬을 적용하지 않는다.
      daily: [...daily.entries()]
        .map(([date, point]) => ({ date, ...point }))
        .sort((left, right) => left.date.localeCompare(right.date)),
      byProvider: toBreakdown(byProvider),
      byModel: toBreakdown(byModel),
    };
  }

  private parseDays(raw?: string): number {
    if (raw === undefined || !raw.trim()) return DEFAULT_DAYS;
    const days = Number(raw.trim());
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
      throw new BadRequestException(
        `days must be an integer between 1 and ${MAX_DAYS}`,
      );
    }
    return days;
  }
}
