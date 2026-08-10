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
    // 남은 지급분은 컬럼이 아니라 파생값이다: 미만료 지급액 - 사용액 - 환불 회수액.
    // canonical은 회수를 purchase 단위로 0에서 끊지만(grantState), 목록의 잔액
    // 칼럼에는 사용자 합계로 충분해서 합산 한 번으로 계산한다.
    const [grants, usages, recoveries, reservations] = await Promise.all([
      this.prisma.creditLedger.groupBy({
        by: ["userId"],
        where: {
          userId: { in: userIds },
          type: "grant",
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        _sum: { amount: true },
      }),
      this.prisma.creditUsage.groupBy({
        by: ["grantLedgerId"],
        where: { grantLedger: { userId: { in: userIds } } },
        _sum: { amount: true },
      }),
      this.prisma.creditLedger.groupBy({
        by: ["userId"],
        where: { userId: { in: userIds }, type: "refund_recovery" },
        _sum: { amount: true },
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
    const usedByUser = await this.usageByUser(usages);
    const reservedByUser = new Map(
      reservations.map((row) => [row.userId, row._sum.amount ?? 0]),
    );
    const recoveredByUser = new Map(
      recoveries.map((row) => [row.userId, row._sum.amount ?? 0]),
    );
    return new Map(
      userIds.map((userId) => {
        const granted = grants.find((row) => row.userId === userId);
        return [
          userId,
          {
            granted: Math.max(
              0,
              (granted?._sum.amount ?? 0) -
                (usedByUser.get(userId) ?? 0) -
                (recoveredByUser.get(userId) ?? 0),
            ),
            reserved: reservedByUser.get(userId) ?? 0,
          },
        ];
      }),
    );
  }

  // creditUsage는 지급 행에만 묶여 있어 사용자별 합계를 바로 낼 수 없다.
  // 지급 행 → 사용자 매핑을 한 번 더 읽어 접는다.
  private async usageByUser(
    usages: Array<{ grantLedgerId: string; _sum: { amount: number | null } }>,
  ): Promise<Map<string, number>> {
    if (usages.length === 0) {
      return new Map();
    }
    const grants = await this.prisma.creditLedger.findMany({
      where: { id: { in: usages.map((row) => row.grantLedgerId) } },
      select: { id: true, userId: true },
    });
    const ownerByGrant = new Map(grants.map((row) => [row.id, row.userId]));
    const totals = new Map<string, number>();
    for (const row of usages) {
      const userId = ownerByGrant.get(row.grantLedgerId);
      if (!userId) {
        continue;
      }
      totals.set(userId, (totals.get(userId) ?? 0) + (row._sum.amount ?? 0));
    }
    return totals;
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
