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
