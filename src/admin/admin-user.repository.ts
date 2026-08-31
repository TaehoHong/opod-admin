import { Injectable } from "@nestjs/common";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  sql,
  sum,
} from "drizzle-orm";
import { DatabaseService } from "../domain/database/database.service";
import {
  creditLedger,
  creditReservations,
  creditUsage,
  hashtags,
  postHashtags,
  userAccounts,
  userCharacterFollows,
  userEvents,
  userHashtagPreferences,
  users,
} from "../domain/database/schema";

export type AdminUserRecord = Pick<
  typeof users.$inferSelect,
  "id" | "displayName" | "email" | "createdAt"
> & {
  _count: { characterFollows: number };
};
export type AdminUserAccountRecord = Pick<
  typeof userAccounts.$inferSelect,
  "provider" | "email" | "createdAt"
>;
export type AdminUserEventRecord = typeof userEvents.$inferSelect;
export type AdminHashtagPreferenceRecord =
  typeof userHashtagPreferences.$inferSelect & { hashtag: { name: string } };

const adminUserFields = {
  id: users.id,
  displayName: users.displayName,
  email: users.email,
  createdAt: users.createdAt,
  _count: {
    characterFollows: sql<number>`(select count(*)::int from ${userCharacterFollows} where ${userCharacterFollows.userId} = ${users.id})`,
  },
} as const;

@Injectable()
export class AdminUserRepository {
  constructor(private readonly database: DatabaseService) {}

  async hasUserCursor(cursorId: string, term?: string): Promise<boolean> {
    const rows = await this.database.client
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, cursorId), this.userSearchCondition(term)))
      .limit(1);
    return rows.length > 0;
  }

  async listUsers(input: {
    term?: string;
    cursorId?: string;
    limit: number;
  }): Promise<AdminUserRecord[]> {
    const [cursor] = input.cursorId
      ? await this.database.client
          .select({ id: users.id, createdAt: users.createdAt })
          .from(users)
          .where(eq(users.id, input.cursorId))
          .limit(1)
      : [];
    return this.database.client
      .select(adminUserFields)
      .from(users)
      .where(
        and(
          this.userSearchCondition(input.term),
          cursor
            ? or(
                lt(users.createdAt, cursor.createdAt),
                and(
                  eq(users.createdAt, cursor.createdAt),
                  lt(users.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(input.limit + 1);
  }

  async getSpendableBalances(
    userIds: string[],
    now: Date,
  ): Promise<Map<string, { granted: number; reserved: number }>> {
    if (userIds.length === 0) return new Map();
    const [grants, usages, recoveries, reservations] = await Promise.all([
      this.database.client
        .select({
          userId: creditLedger.userId,
          amount: sum(creditLedger.amount),
        })
        .from(creditLedger)
        .where(
          and(
            inArray(creditLedger.userId, userIds),
            eq(creditLedger.type, "grant"),
            or(isNull(creditLedger.expiresAt), gt(creditLedger.expiresAt, now)),
          ),
        )
        .groupBy(creditLedger.userId),
      this.database.client
        .select({
          userId: creditLedger.userId,
          amount: sum(creditUsage.amount),
        })
        .from(creditUsage)
        .innerJoin(creditLedger, eq(creditLedger.id, creditUsage.grantLedgerId))
        .where(inArray(creditLedger.userId, userIds))
        .groupBy(creditLedger.userId),
      this.database.client
        .select({
          userId: creditLedger.userId,
          amount: sum(creditLedger.amount),
        })
        .from(creditLedger)
        .where(
          and(
            inArray(creditLedger.userId, userIds),
            eq(creditLedger.type, "refund_recovery"),
          ),
        )
        .groupBy(creditLedger.userId),
      this.database.client
        .select({
          userId: creditReservations.userId,
          amount: sum(creditReservations.amount),
        })
        .from(creditReservations)
        .where(
          and(
            inArray(creditReservations.userId, userIds),
            eq(creditReservations.status, "reserved"),
            gt(creditReservations.expiresAt, now),
          ),
        )
        .groupBy(creditReservations.userId),
    ]);
    const amountMap = (
      rows: Array<{ userId: string; amount: string | null }>,
    ) => new Map(rows.map((row) => [row.userId, Number(row.amount ?? 0)]));
    const grantedByUser = amountMap(grants);
    const usedByUser = amountMap(usages);
    const recoveredByUser = amountMap(recoveries);
    const reservedByUser = amountMap(reservations);
    return new Map(
      userIds.map((userId) => [
        userId,
        {
          granted: Math.max(
            0,
            (grantedByUser.get(userId) ?? 0) -
              (usedByUser.get(userId) ?? 0) -
              (recoveredByUser.get(userId) ?? 0),
          ),
          reserved: reservedByUser.get(userId) ?? 0,
        },
      ]),
    );
  }

  getUser(userId: string): Promise<AdminUserRecord | null> {
    return this.database.client
      .select(adminUserFields)
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .then(([row]) => row ?? null);
  }

  listUserAccounts(userId: string): Promise<AdminUserAccountRecord[]> {
    return this.database.client
      .select({
        provider: userAccounts.provider,
        email: userAccounts.email,
        createdAt: userAccounts.createdAt,
      })
      .from(userAccounts)
      .where(eq(userAccounts.userId, userId))
      .orderBy(asc(userAccounts.createdAt));
  }

  async hasEventCursor(
    cursorId: string,
    filters: { userId?: string; targetType?: string; targetId?: string },
  ): Promise<boolean> {
    const rows = await this.database.client
      .select({ id: userEvents.id })
      .from(userEvents)
      .where(and(eq(userEvents.id, cursorId), this.eventConditions(filters)))
      .limit(1);
    return rows.length > 0;
  }

  async listEvents(input: {
    filters: { userId?: string; targetType?: string; targetId?: string };
    cursorId?: string;
    limit: number;
  }): Promise<AdminUserEventRecord[]> {
    const [cursor] = input.cursorId
      ? await this.database.client
          .select({ id: userEvents.id, createdAt: userEvents.createdAt })
          .from(userEvents)
          .where(eq(userEvents.id, input.cursorId))
          .limit(1)
      : [];
    return this.database.client
      .select()
      .from(userEvents)
      .where(
        and(
          this.eventConditions(input.filters),
          cursor
            ? or(
                lt(userEvents.createdAt, cursor.createdAt),
                and(
                  eq(userEvents.createdAt, cursor.createdAt),
                  lt(userEvents.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(userEvents.createdAt), desc(userEvents.id))
      .limit(input.limit + 1);
  }

  listHashtagPreferences(
    userId?: string,
  ): Promise<AdminHashtagPreferenceRecord[]> {
    return this.database.client
      .select({
        userId: userHashtagPreferences.userId,
        hashtagId: userHashtagPreferences.hashtagId,
        score: userHashtagPreferences.score,
        updatedAt: userHashtagPreferences.updatedAt,
        hashtag: { name: hashtags.name },
      })
      .from(userHashtagPreferences)
      .innerJoin(hashtags, eq(hashtags.id, userHashtagPreferences.hashtagId))
      .where(userId ? eq(userHashtagPreferences.userId, userId) : undefined)
      .orderBy(desc(userHashtagPreferences.score), asc(hashtags.name));
  }

  listTopHashtags(
    limit: number,
  ): Promise<Array<{ name: string; _count: { posts: number } }>> {
    return this.database.client
      .select({
        name: hashtags.name,
        _count: { posts: sql<number>`count(${postHashtags.postId})::int` },
      })
      .from(hashtags)
      .leftJoin(postHashtags, eq(postHashtags.hashtagId, hashtags.id))
      .groupBy(hashtags.id, hashtags.name)
      .orderBy(desc(sql`count(${postHashtags.postId})`), asc(hashtags.name))
      .limit(limit);
  }

  private userSearchCondition(term?: string) {
    return term
      ? or(
          ilike(users.email, `%${term}%`),
          ilike(users.displayName, `%${term}%`),
        )
      : undefined;
  }

  private eventConditions(filters: {
    userId?: string;
    targetType?: string;
    targetId?: string;
  }) {
    return and(
      filters.userId ? eq(userEvents.userId, filters.userId) : undefined,
      filters.targetType
        ? eq(userEvents.targetType, filters.targetType)
        : undefined,
      filters.targetId ? eq(userEvents.targetId, filters.targetId) : undefined,
    );
  }
}
