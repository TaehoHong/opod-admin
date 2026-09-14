import { Injectable } from "@nestjs/common";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lte,
  lt,
  or,
  sql,
  sum,
} from "drizzle-orm";
import type { DatabaseClient } from "../domain/database/database.service";
import { DatabaseService } from "../domain/database/database.service";
import {
  creditLedger,
  creditPurchases,
  creditRefund,
  creditUsage,
  payments,
} from "../domain/database/schema";

export type CreditKind = "free" | "paid";
export type CreditLedgerType =
  "grant" | "usage" | "refund_recovery" | "adjustment";
export type CreditRefundStatus =
  | "reserved"
  | "payment_processing"
  | "payment_succeeded"
  | "completed"
  | "failed"
  | "canceled";
export type AdminCreditLedgerRecord = typeof creditLedger.$inferSelect;
export type AdminCreditPurchaseRecord = typeof creditPurchases.$inferSelect & {
  payment: typeof payments.$inferSelect | null;
};
export type AdminReconciliationLedgerRow = Pick<
  AdminCreditLedgerRecord,
  | "id"
  | "purchaseId"
  | "type"
  | "creditKind"
  | "promotionCode"
  | "amount"
  | "externalReference"
>;
export type AdminCompletedRefundRecord = typeof creditRefund.$inferSelect;
export type AdminReconciliationRefundRow = Pick<
  AdminCompletedRefundRecord,
  | "id"
  | "purchaseId"
  | "status"
  | "refundAmount"
  | "recoveryAmount"
  | "debtAmount"
>;
type TransactionClient = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];

@Injectable()
export class AdminCreditPaymentRepository {
  constructor(private readonly database: DatabaseService) {}

  async hasLedgerCursor(cursorId: string, userId?: string): Promise<boolean> {
    const rows = await this.database.client
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.id, cursorId),
          userId ? eq(creditLedger.userId, userId) : undefined,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async listLedger(input: {
    userId?: string;
    cursorId?: string;
    limit: number;
  }): Promise<AdminCreditLedgerRecord[]> {
    const [cursor] = input.cursorId
      ? await this.database.client
          .select({ id: creditLedger.id, createdAt: creditLedger.createdAt })
          .from(creditLedger)
          .where(eq(creditLedger.id, input.cursorId))
          .limit(1)
      : [];
    return this.database.client
      .select()
      .from(creditLedger)
      .where(
        and(
          input.userId ? eq(creditLedger.userId, input.userId) : undefined,
          cursor
            ? or(
                lt(creditLedger.createdAt, cursor.createdAt),
                and(
                  eq(creditLedger.createdAt, cursor.createdAt),
                  lt(creditLedger.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
      .limit(input.limit + 1);
  }

  async hasPurchaseForUser(
    purchaseId: string,
    userId: string,
  ): Promise<boolean> {
    const rows = await this.database.client
      .select({ id: creditPurchases.id })
      .from(creditPurchases)
      .where(
        and(
          eq(creditPurchases.id, purchaseId),
          eq(creditPurchases.userId, userId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async createLedgerEntry(input: {
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
    return (
      await this.database.client.insert(creditLedger).values(input).returning()
    )[0];
  }

  async listPurchases(createdAt?: {
    gte?: Date;
    lte?: Date;
  }): Promise<AdminCreditPurchaseRecord[]> {
    const rows = await this.database.client
      .select({ purchase: creditPurchases, payment: payments })
      .from(creditPurchases)
      .leftJoin(payments, eq(payments.purchaseId, creditPurchases.id))
      .where(
        and(
          createdAt?.gte
            ? gte(creditPurchases.createdAt, createdAt.gte)
            : undefined,
          createdAt?.lte
            ? lte(creditPurchases.createdAt, createdAt.lte)
            : undefined,
        ),
      )
      .orderBy(desc(creditPurchases.createdAt), desc(creditPurchases.id));
    return rows.map((row) => ({ ...row.purchase, payment: row.payment }));
  }

  async listReconciliationEvidence(purchaseIds: string[]): Promise<{
    entries: AdminReconciliationLedgerRow[];
    refunds: AdminReconciliationRefundRow[];
  }> {
    if (purchaseIds.length === 0) return { entries: [], refunds: [] };
    const [entries, refunds] = await Promise.all([
      this.database.client
        .select({
          id: creditLedger.id,
          purchaseId: creditLedger.purchaseId,
          type: creditLedger.type,
          creditKind: creditLedger.creditKind,
          promotionCode: creditLedger.promotionCode,
          amount: creditLedger.amount,
          externalReference: creditLedger.externalReference,
        })
        .from(creditLedger)
        .where(inArray(creditLedger.purchaseId, purchaseIds)),
      this.database.client
        .select({
          id: creditRefund.id,
          purchaseId: creditRefund.purchaseId,
          status: creditRefund.status,
          refundAmount: creditRefund.refundAmount,
          recoveryAmount: creditRefund.recoveryAmount,
          debtAmount: creditRefund.debtAmount,
        })
        .from(creditRefund)
        .where(inArray(creditRefund.purchaseId, purchaseIds)),
    ]);
    return { entries, refunds };
  }

  async getPayment(
    paymentId: string,
  ): Promise<AdminCreditPurchaseRecord | null> {
    const [row] = await this.database.client
      .select({ purchase: creditPurchases, payment: payments })
      .from(creditPurchases)
      .leftJoin(payments, eq(payments.purchaseId, creditPurchases.id))
      .where(eq(creditPurchases.id, paymentId))
      .limit(1);
    return row ? { ...row.purchase, payment: row.payment } : null;
  }

  withReconciliationTransaction<T>(
    userId: string,
    reference: string,
    work: (session: AdminCreditReconciliationSession) => Promise<T>,
  ): Promise<T> {
    return this.database.client.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`,
      );
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`credit_reconciliation:${reference}`}, 0))`,
      );
      return work(new AdminCreditReconciliationSession(tx));
    });
  }
}

export class AdminCreditReconciliationSession {
  constructor(private readonly tx: TransactionClient) {}

  findLedgerByReference(
    externalReference: string,
  ): Promise<AdminCreditLedgerRecord | null> {
    return this.tx
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.externalReference, externalReference))
      .limit(1)
      .then(([row]) => row ?? null);
  }

  listPurchaseLedger(purchaseId: string): Promise<AdminCreditLedgerRecord[]> {
    return this.tx
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.purchaseId, purchaseId))
      .orderBy(asc(creditLedger.createdAt), asc(creditLedger.id));
  }

  async sumUsageByGrant(grantIds: string[]): Promise<Map<string, number>> {
    if (grantIds.length === 0) return new Map();
    const rows = await this.tx
      .select({
        grantLedgerId: creditUsage.grantLedgerId,
        amount: sum(creditUsage.amount),
      })
      .from(creditUsage)
      .where(inArray(creditUsage.grantLedgerId, grantIds))
      .groupBy(creditUsage.grantLedgerId);
    return new Map(
      rows.map((row) => [row.grantLedgerId, Number(row.amount ?? 0)]),
    );
  }

  listCompletedRefunds(
    purchaseId: string,
  ): Promise<AdminCompletedRefundRecord[]> {
    return this.tx
      .select()
      .from(creditRefund)
      .where(
        and(
          eq(creditRefund.purchaseId, purchaseId),
          eq(creditRefund.status, "completed"),
        ),
      )
      .orderBy(asc(creditRefund.createdAt), asc(creditRefund.id));
  }

  async createLedgerEntry(input: {
    userId: string;
    purchaseId: string;
    type: CreditLedgerType;
    creditKind?: CreditKind;
    amount: number;
    reason: string;
    externalReference: string;
  }): Promise<AdminCreditLedgerRecord> {
    return (await this.tx.insert(creditLedger).values(input).returning())[0];
  }
}
