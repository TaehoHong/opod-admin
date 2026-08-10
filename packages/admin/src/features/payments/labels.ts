import type { CreditPurchaseStatus, LedgerStatus, PaymentStatus } from "./api";

// 상태는 색만으로 구분하지 않고 항상 한국어 문구를 함께 둔다
// (docs/04-design-rules.md:85).

// 구매 상태 — 크레딧이 결국 지급됐는지를 말한다.
export const PROVIDER_STATUS_LABEL: Record<CreditPurchaseStatus, string> = {
  pending: "결제 대기",
  payment_processing: "결제 진행",
  completed: "지급 완료",
  failed: "결제 실패",
  canceled: "결제 취소",
  refunded: "환불",
  reversed: "결제 취소(역전)",
};

export const PROVIDER_STATUS_COLOR: Record<CreditPurchaseStatus, string> = {
  pending: "attention",
  payment_processing: "attention",
  completed: "teal",
  failed: "red",
  canceled: "gray",
  refunded: "accent",
  reversed: "red",
};

// 결제 상태 — provider 쪽 원본 상태다.
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: "승인 대기",
  verified: "검증 완료",
  processing: "처리 중",
  paid: "결제 완료",
  failed: "결제 실패",
  canceled: "결제 취소",
  partially_refunded: "부분 환불",
  refunded: "환불",
  reversed: "결제 취소(역전)",
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
