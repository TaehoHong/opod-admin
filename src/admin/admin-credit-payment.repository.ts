import { Injectable } from "@nestjs/common";
import type {
  CreditKind,
  CreditLedgerType,
  CreditRefundStatus,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../domain/database/prisma.service";

// 크레딧 원장은 canonical(opod-service-backend)의 규약을 그대로 따른다:
// amount는 항상 양수이고 방향은 type이 정한다. 지급 회수는 grant 행을 고치는
// 대신 purchaseId가 붙은 refund_recovery 행을 쌓아서 표현하며, 남은 지급분을
// 넘어선 회수분은 자동으로 미수(음수 유료 잔액)가 된다.
// 참고: opod-service-backend/src/domain/credits/credits.service.ts grantState().
export type AdminCreditLedgerRecord =
  Prisma.CreditLedgerGetPayload<Prisma.CreditLedgerDefaultArgs>;

export type AdminCreditPurchaseRecord = Prisma.CreditPurchaseGetPayload<{
  include: { payment: true };
}>;

export type AdminReconciliationLedgerRow = {
  id: string;
  purchaseId: string | null;
  type: CreditLedgerType;
  creditKind: CreditKind | null;
  promotionCode: string | null;
  amount: number;
  externalReference: string | null;
};

export type AdminCompletedRefundRecord =
  Prisma.CreditRefundGetPayload<Prisma.CreditRefundDefaultArgs>;

export type AdminReconciliationRefundRow = {
  id: string;
  purchaseId: string;
  status: CreditRefundStatus;
  refundAmount: number;
  recoveryAmount: number;
  debtAmount: number;
};

@Injectable()
export class AdminCreditPaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async hasLedgerCursor(cursorId: string, userId?: string): Promise<boolean> {
    return (
      (await this.prisma.creditLedger.findFirst({
        where: { id: cursorId, ...(userId ? { userId } : {}) },
        select: { id: true },
      })) !== null
    );
  }

  listLedger(input: {
    userId?: string;
    cursorId?: string;
    limit: number;
  }): Promise<AdminCreditLedgerRecord[]> {
    return this.prisma.creditLedger.findMany({
      where: input.userId ? { userId: input.userId } : {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursorId ? { cursor: { id: input.cursorId }, skip: 1 } : {}),
    });
  }

  async hasPurchaseForUser(
    purchaseId: string,
    userId: string,
  ): Promise<boolean> {
    return (
      (await this.prisma.creditPurchase.findFirst({
        where: { id: purchaseId, userId },
        select: { id: true },
      })) !== null
    );
  }

  createLedgerEntry(input: {
    userId: string;
    type: CreditLedgerType;
    amount: number;
    reason: string;
    externalReference?: string;
    creditKind?: CreditKind;
    purchaseId?: string;
    promotionCode?: string;
    expiresAt?: Date;
  }): Promise<AdminCreditLedgerRecord> {
    return this.prisma.creditLedger.create({ data: input });
  }

  listPurchases(createdAt?: {
    gte?: Date;
    lte?: Date;
  }): Promise<AdminCreditPurchaseRecord[]> {
    return this.prisma.creditPurchase.findMany({
      where: createdAt ? { createdAt } : {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { payment: true },
    });
  }

  async listReconciliationEvidence(purchaseIds: string[]): Promise<{
    entries: AdminReconciliationLedgerRow[];
    refunds: AdminReconciliationRefundRow[];
  }> {
    if (purchaseIds.length === 0) {
      return { entries: [], refunds: [] };
    }
    const [entries, refunds] = await Promise.all([
      this.prisma.creditLedger.findMany({
        where: { purchaseId: { in: purchaseIds } },
        select: {
          id: true,
          purchaseId: true,
          type: true,
          creditKind: true,
          promotionCode: true,
          amount: true,
          externalReference: true,
        },
      }),
      this.prisma.creditRefund.findMany({
        where: { purchaseId: { in: purchaseIds } },
        select: {
          id: true,
          purchaseId: true,
          status: true,
          refundAmount: true,
          recoveryAmount: true,
          debtAmount: true,
        },
      }),
    ]);
    return { entries, refunds };
  }

  getPayment(paymentId: string): Promise<AdminCreditPurchaseRecord | null> {
    return this.prisma.creditPurchase.findUnique({
      where: { id: paymentId },
      include: { payment: true },
    });
  }

  withReconciliationTransaction<T>(
    userId: string,
    reference: string,
    work: (session: AdminCreditReconciliationSession) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
      const actionLock = `credit_reconciliation:${reference}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actionLock}, 0))`;
      return work(new AdminCreditReconciliationSession(tx));
    });
  }
}

export class AdminCreditReconciliationSession {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  findLedgerByReference(
    externalReference: string,
  ): Promise<AdminCreditLedgerRecord | null> {
    return this.tx.creditLedger.findUnique({ where: { externalReference } });
  }

  listPurchaseLedger(purchaseId: string): Promise<AdminCreditLedgerRecord[]> {
    return this.tx.creditLedger.findMany({
      where: { purchaseId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  // 지급 행별로 이미 쓰인 금액. 남은 지급분 = amount - 사용액이다.
  async sumUsageByGrant(grantIds: string[]): Promise<Map<string, number>> {
    if (grantIds.length === 0) {
      return new Map();
    }
    const rows = await this.tx.creditUsage.groupBy({
      by: ["grantLedgerId"],
      where: { grantLedgerId: { in: grantIds } },
      _sum: { amount: true },
    });
    return new Map(
      rows.map((row) => [row.grantLedgerId, row._sum.amount ?? 0]),
    );
  }

  listCompletedRefunds(
    purchaseId: string,
  ): Promise<AdminCompletedRefundRecord[]> {
    return this.tx.creditRefund.findMany({
      where: { purchaseId, status: "completed" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  createLedgerEntry(input: {
    userId: string;
    purchaseId: string;
    type: CreditLedgerType;
    creditKind?: CreditKind;
    amount: number;
    reason: string;
    externalReference: string;
  }): Promise<AdminCreditLedgerRecord> {
    return this.tx.creditLedger.create({ data: input });
  }
}
