import type { CreditPurchaseStatus, LedgerStatus } from "./api";

// 상태는 색만으로 구분하지 않고 항상 한국어 문구를 함께 둔다
// (docs/04-design-rules.md:85).

export const PROVIDER_STATUS_LABEL: Record<CreditPurchaseStatus, string> = {
  pending: "결제 대기",
  paid: "결제 완료",
  failed: "결제 실패",
  canceled: "결제 취소",
  refunded: "환불",
};

export const PROVIDER_STATUS_COLOR: Record<CreditPurchaseStatus, string> = {
  pending: "attention",
  paid: "teal",
  failed: "red",
  canceled: "gray",
  refunded: "accent",
};

export const LEDGER_STATUS_LABEL: Record<LedgerStatus, string> = {
  granted: "원장 반영",
  missing_grant: "원장 누락",
  not_granted: "미지급",
};

export const LEDGER_STATUS_COLOR: Record<LedgerStatus, string> = {
  granted: "teal",
  missing_grant: "red",
  not_granted: "gray",
};
