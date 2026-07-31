import { apiRequest } from "../../shared/api/apiClient";
import { toQuery } from "../../shared/api/useCursorList";

export type CreditPurchaseStatus =
  "pending" | "paid" | "failed" | "canceled" | "refunded";

export type LedgerStatus = "granted" | "missing_grant" | "not_granted";

export type PaymentReconciliationItem = {
  paymentId: string;
  userId: string;
  provider: string;
  providerStatus: CreditPurchaseStatus;
  creditAmount: number;
  paidAmount: number;
  currency: string;
  ledgerStatus: LedgerStatus;
  reason?: string;
  issueCodes?: string[];
  repairActions?: string[];
};

export type PaymentDetail = {
  id: string;
  userId: string;
  provider: string;
  status: CreditPurchaseStatus;
  creditAmount: number;
  paidAmount: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
};

// 정산 목록은 cursor page가 아니라 { items } 한 덩어리다
// (admin.service.ts listPaymentReconciliation).
export function fetchPaymentReconciliation(params: {
  status?: string;
}): Promise<{ items: PaymentReconciliationItem[] }> {
  return apiRequest(`/payments/reconciliation${toQuery(params)}`);
}

export function fetchPayment(paymentId: string): Promise<PaymentDetail> {
  return apiRequest(`/payments/${encodeURIComponent(paymentId)}`);
}
