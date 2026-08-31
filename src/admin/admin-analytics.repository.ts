import { Injectable } from "@nestjs/common";
import { and, gte, inArray, lte, sql, sum } from "drizzle-orm";
import { DatabaseService } from "../domain/database/database.service";
import {
  creditLedger,
  generationJobs,
  messages,
  userEvents,
} from "../domain/database/schema";

@Injectable()
export class AdminAnalyticsRepository {
  constructor(private readonly database: DatabaseService) {}

  countEvents(createdAt?: { gte?: Date; lte?: Date }): Promise<number> {
    return this.countRows(userEvents, userEvents.createdAt, createdAt);
  }

  countMessages(createdAt?: { gte?: Date; lte?: Date }): Promise<number> {
    return this.countRows(messages, messages.createdAt, createdAt);
  }

  // 원장 금액은 항상 양수이고 방향은 type이 정한다. 지급은 grant 하나뿐이고
  // 차감은 사용·환불 회수·조정 셋으로 나뉘어 있어 합쳐서 센다.
  async sumCredits(
    direction: "grant" | "debit",
    createdAt?: { gte?: Date; lte?: Date },
  ): Promise<number> {
    const types =
      direction === "grant"
        ? (["grant"] as const)
        : (["usage", "refund_recovery", "adjustment"] as const);
    const [result] = await this.database.client
      .select({ value: sum(creditLedger.amount) })
      .from(creditLedger)
      .where(
        and(
          inArray(creditLedger.type, types),
          createdAt?.gte
            ? gte(creditLedger.createdAt, createdAt.gte)
            : undefined,
          createdAt?.lte
            ? lte(creditLedger.createdAt, createdAt.lte)
            : undefined,
        ),
      );
    return Number(result?.value ?? 0);
  }

  countGenerationJobs(createdAt?: { gte?: Date; lte?: Date }): Promise<number> {
    return this.countRows(generationJobs, generationJobs.createdAt, createdAt);
  }

  private async countRows(
    table: typeof userEvents | typeof messages | typeof generationJobs,
    createdAtColumn:
      | typeof userEvents.createdAt
      | typeof messages.createdAt
      | typeof generationJobs.createdAt,
    range?: { gte?: Date; lte?: Date },
  ): Promise<number> {
    const result = await this.database.client.execute<{ value: number }>(sql`
      select count(*)::int as value
      from ${table}
      where ${range?.gte ? sql`${createdAtColumn} >= ${range.gte}` : sql`true`}
        and ${range?.lte ? sql`${createdAtColumn} <= ${range.lte}` : sql`true`}
    `);
    return result.rows[0]?.value ?? 0;
  }
}
