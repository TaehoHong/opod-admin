import { apiRequest } from "../../shared/api/apiClient";
import { toQuery, type CursorPage } from "../../shared/api/useCursorList";

export type CreditEntry = {
  id: string;
  userId: string;
  entryType: "grant" | "debit";
  creditKind?: "free" | "paid";
  purchaseId?: string;
  promotionCode?: string;
  amount: number;
  reason: string;
  externalReference?: string;
  createdAt: string;
};

export function fetchCreditLedger(params: {
  userId?: string;
  cursor?: string;
}): Promise<CursorPage<CreditEntry>> {
  return apiRequest(`/credits/ledger${toQuery(params)}`);
}
