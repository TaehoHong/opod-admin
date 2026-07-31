import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../domain/database/prisma.service";

export const adminUserFields = {
  id: true,
  displayName: true,
  email: true,
  createdAt: true,
  _count: { select: { characterFollows: true } },
} as const;

export type AdminUserRecord = Prisma.UserGetPayload<{
  select: typeof adminUserFields;
}>;

// 소셜 로그인은 service-backend 소관이다. admin은 유저 지원을 위해 연결
// 상태만 읽는다 — provider_account_id(sub)는 내부 신원 키라 노출하지 않는다.
export const adminUserAccountFields = {
  provider: true,
  email: true,
  createdAt: true,
} as const;

export type AdminUserAccountRecord = Prisma.UserAccountGetPayload<{
  select: typeof adminUserAccountFields;
}>;

export type AdminUserEventRecord =
  Prisma.UserEventGetPayload<Prisma.UserEventDefaultArgs>;

export type AdminHashtagPreferenceRecord =
  Prisma.UserHashtagPreferenceGetPayload<{
    include: { hashtag: { select: { name: true } } };
  }>;

@Injectable()
export class AdminUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async hasUserCursor(cursorId: string, term?: string): Promise<boolean> {
    return (
      (await this.prisma.user.findFirst({
        where: { id: cursorId, ...this.userSearchWhere(term) },
        select: { id: true },
      })) !== null
    );
  }

  listUsers(input: {
    term?: string;
    cursorId?: string;
    limit: number;
  }): Promise<AdminUserRecord[]> {
    return this.prisma.user.findMany({
      where: this.userSearchWhere(input.term),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursorId ? { cursor: { id: input.cursorId }, skip: 1 } : {}),
      select: adminUserFields,
    });
  }

  async getSpendableBalances(
    userIds: string[],
    now: Date,
  ): Promise<Map<string, { granted: number; reserved: number }>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const [grants, reservations] = await Promise.all([
      this.prisma.creditLedgerEntry.groupBy({
        by: ["userId"],
        where: {
          userId: { in: userIds },
          entryType: "grant",
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        _sum: { remainingAmount: true },
      }),
      this.prisma.creditReservation.groupBy({
        by: ["userId"],
        where: {
          userId: { in: userIds },
          status: "reserved",
          expiresAt: { gt: now },
        },
        _sum: { amount: true },
      }),
    ]);
    const reservedByUser = new Map(
      reservations.map((row) => [row.userId, row._sum.amount ?? 0]),
    );
    return new Map(
      userIds.map((userId) => {
        const grant = grants.find((row) => row.userId === userId);
        return [
          userId,
          {
            granted: grant?._sum.remainingAmount ?? 0,
            reserved: reservedByUser.get(userId) ?? 0,
          },
        ];
      }),
    );
  }

  getUser(userId: string): Promise<AdminUserRecord | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: adminUserFields,
    });
  }

  listUserAccounts(userId: string): Promise<AdminUserAccountRecord[]> {
    return this.prisma.userAccount.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: adminUserAccountFields,
    });
  }

  async hasEventCursor(
    cursorId: string,
    filters: { userId?: string; targetType?: string; targetId?: string },
  ): Promise<boolean> {
    return (
      (await this.prisma.userEvent.findFirst({
        where: { id: cursorId, ...filters },
        select: { id: true },
      })) !== null
    );
  }

  listEvents(input: {
    filters: { userId?: string; targetType?: string; targetId?: string };
    cursorId?: string;
    limit: number;
  }): Promise<AdminUserEventRecord[]> {
    return this.prisma.userEvent.findMany({
      where: input.filters,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursorId ? { cursor: { id: input.cursorId }, skip: 1 } : {}),
    });
  }

  listHashtagPreferences(
    userId?: string,
  ): Promise<AdminHashtagPreferenceRecord[]> {
    return this.prisma.userHashtagPreference.findMany({
      where: userId ? { userId } : {},
      orderBy: [{ score: "desc" }, { hashtag: { name: "asc" } }],
      include: { hashtag: { select: { name: true } } },
    });
  }

  listTopHashtags(limit: number) {
    return this.prisma.hashtag.findMany({
      orderBy: [{ posts: { _count: "desc" } }, { name: "asc" }],
      take: limit,
      select: {
        name: true,
        _count: { select: { posts: true } },
      },
    });
  }

  private userSearchWhere(term?: string): Prisma.UserWhereInput {
    return term
      ? {
          OR: [
            { email: { contains: term, mode: "insensitive" } },
            { displayName: { contains: term, mode: "insensitive" } },
          ],
        }
      : {};
  }
}
