import { apiRequest } from "../../shared/api/apiClient";
import { toQuery } from "../../shared/api/useCursorList";

export type CreditPurchaseStatus =
  | "pending"
  | "payment_processing"
  | "completed"
  | "failed"
  | "canceled"
  | "refunded"
  | "reversed";

export type PaymentStatus =
  | "pending"
  | "verified"
  | "processing"
  | "paid"
  | "failed"
  | "canceled"
  | "partially_refunded"
  | "refunded"
  | "reversed";

export type LedgerStatus = "granted" | "missing_grant" | "not_granted";

// 결제 수단과 금액은 payments 행에서 온다. 체크아웃 전 구매에는 결제 행이 없어
// 비어 있을 수 있다.
export type PaymentReconciliationItem = {
  paymentId: string;
  userId: string;
  provider?: string;
  providerStatus: CreditPurchaseStatus;
  paymentStatus?: PaymentStatus;
  creditAmount: number;
  paidAmount?: number;
  currency?: string;
  ledgerStatus: LedgerStatus;
  reason?: string;
  issueCodes?: string[];
  repairActions?: string[];
};

export type PaymentDetail = {
  id: string;
  userId: string;
  provider?: string;
  status: CreditPurchaseStatus;
  paymentStatus?: PaymentStatus;
  creditAmount: number;
  paidAmount?: number;
  currency?: string;
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
