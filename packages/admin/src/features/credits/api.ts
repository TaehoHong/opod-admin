import { apiRequest } from "../../shared/api/apiClient";
import { toQuery, type CursorPage } from "../../shared/api/useCursorList";

// entryType은 지급/차감 방향이고, ledgerType은 차감의 실제 이유(사용·환불 회수·
// 조정)를 구분하는 원장 원본 값이다.
export type CreditLedgerType =
  "grant" | "usage" | "refund_recovery" | "adjustment";

export type CreditEntry = {
  id: string;
  userId: string;
  entryType: "grant" | "debit";
  ledgerType: CreditLedgerType;
  creditKind?: "free" | "paid";
  purchaseId?: string;
  promotionCode?: string;
  amount: number;
  reason: string;
  externalReference?: string;
  createdAt: string;
};

export type CreditGrant = {
  userId: string;
  amount: number;
  reason: string;
  externalReference?: string;
};

export function fetchCreditLedger(params: {
  userId?: string;
  cursor?: string;
}): Promise<CursorPage<CreditEntry>> {
  return apiRequest(`/credits/ledger${toQuery(params)}`);
}

export function grantCredits(body: CreditGrant): Promise<CreditEntry> {
  return apiRequest("/credits/grants", { method: "POST", body });
}
