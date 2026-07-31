import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../domain/database/prisma.service";

export type AdminCreditEntryRecord =
  Prisma.CreditLedgerEntryGetPayload<Prisma.CreditLedgerEntryDefaultArgs>;
export type AdminCreditPurchaseRecord =
  Prisma.CreditPurchaseGetPayload<Prisma.CreditPurchaseDefaultArgs>;
export type AdminReconciliationActionRecord =
  Prisma.CreditReconciliationActionGetPayload<Prisma.CreditReconciliationActionDefaultArgs>;

export type AdminReconciliationLedgerRow = {
  id: string;
  purchaseId: string | null;
  entryType: "grant" | "debit";
  creditKind: "free" | "paid" | null;
  promotionCode: string | null;
  amount: number;
  externalReference: string | null;
};

export type AdminReconciliationRefundRow = {
  id: string;
  purchaseId: string;
  status: "reserved" | "refunded" | "released";
  refundAmount: number;
  allocations: Array<{
    recoveryAmount: number;
    recoveredAmount: number;
  }>;
};

export type AdminCompletedRefundRecord = Prisma.CreditRefundGetPayload<{
  include: {
    allocations: { include: { ledgerEntry: true } };
  };
}>;

@Injectable()
export class AdminCreditPaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async hasLedgerCursor(cursorId: string, userId?: string): Promise<boolean> {
    return (
      (await this.prisma.creditLedgerEntry.findFirst({
        where: { id: cursorId, ...(userId ? { userId } : {}) },
        select: { id: true },
      })) !== null
    );
  }

  listLedger(input: {
    userId?: string;
    cursorId?: string;
    limit: number;
  }): Promise<AdminCreditEntryRecord[]> {
    return this.prisma.creditLedgerEntry.findMany({
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
    entryType: "grant" | "debit";
    amount: number;
    reason: string;
    externalReference?: string;
    remainingAmount?: number;
    creditKind?: "free" | "paid";
    purchaseId?: string;
    promotionCode?: string;
    expiresAt?: Date;
  }): Promise<AdminCreditEntryRecord> {
    return this.prisma.creditLedgerEntry.create({ data: input });
  }

  listPurchases(createdAt?: { gte?: Date; lte?: Date }) {
    return this.prisma.creditPurchase.findMany({
      where: createdAt ? { createdAt } : {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
      this.prisma.creditLedgerEntry.findMany({
        where: { purchaseId: { in: purchaseIds } },
        select: {
          id: true,
          purchaseId: true,
          entryType: true,
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
          allocations: {
            select: { recoveryAmount: true, recoveredAmount: true },
          },
        },
      }),
    ]);
    return { entries, refunds };
  }

  getPayment(paymentId: string): Promise<AdminCreditPurchaseRecord | null> {
    return this.prisma.creditPurchase.findUnique({
      where: { id: paymentId },
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

  getAction(
    reference: string,
  ): Promise<AdminReconciliationActionRecord | null> {
    return this.tx.creditReconciliationAction.findUnique({
      where: { reference },
    });
  }

  listPurchaseGrants(purchaseId: string): Promise<AdminCreditEntryRecord[]> {
    return this.tx.creditLedgerEntry.findMany({
      where: { purchaseId, entryType: "grant" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  ensureCreditAccount(userId: string) {
    return this.tx.creditAccount.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  setPaidDebt(userId: string, paidDebt: number) {
    return this.tx.creditAccount.update({
      where: { userId },
      data: { paidDebt },
    });
  }

  clearDebtIdentity(userId: string) {
    return this.tx.user.update({
      where: { id: userId },
      data: { debtIdentityHash: null },
    });
  }

  createLedgerEntry(input: {
    userId: string;
    purchaseId: string;
    entryType: "grant" | "debit";
    creditKind?: "paid";
    amount: number;
    remainingAmount?: number;
    reason: string;
    externalReference: string;
  }) {
    return this.tx.creditLedgerEntry.create({ data: input });
  }

  listCompletedRefunds(
    purchaseId: string,
  ): Promise<AdminCompletedRefundRecord[]> {
    return this.tx.creditRefund.findMany({
      where: { purchaseId, status: "refunded" },
      include: { allocations: { include: { ledgerEntry: true } } },
    });
  }

  setLedgerRemaining(entryId: string, remainingAmount: number) {
    return this.tx.creditLedgerEntry.update({
      where: { id: entryId },
      data: { remainingAmount },
    });
  }

  completeRefundAllocation(
    refundId: string,
    ledgerEntryId: string,
    recoveredAmount: number,
  ) {
    return this.tx.creditRefundAllocation.update({
      where: {
        refundId_ledgerEntryId: { refundId, ledgerEntryId },
      },
      data: { recoveredAmount },
    });
  }

  async hasDebitReference(externalReference: string): Promise<boolean> {
    return (
      (await this.tx.creditLedgerEntry.findFirst({
        where: { entryType: "debit", externalReference },
        select: { id: true },
      })) !== null
    );
  }

  addPaidDebt(userId: string, paidDebt: number) {
    return this.tx.creditAccount.upsert({
      where: { userId },
      create: { userId, paidDebt },
      update: { paidDebt: { increment: paidDebt } },
    });
  }

  recordAction(input: {
    actionType:
      | "grant_missing_purchase"
      | "recover_nonpaid_grants"
      | "recover_duplicate_grants"
      | "recover_completed_refund";
    reference: string;
    purchaseId: string;
    adminId: string;
    reason: string;
    details: Prisma.InputJsonValue;
  }) {
    return this.tx.creditReconciliationAction.create({ data: input });
  }
}
