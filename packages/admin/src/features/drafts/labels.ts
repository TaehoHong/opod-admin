import type { DraftStatus, FinishPreset } from "./api";

// 상태는 색과 문구를 함께 쓴다 (docs/04-design-rules.md:85).

export const DRAFT_STATUS_LABEL: Record<DraftStatus, string> = {
  planned: "기획 대기",
  generating: "생성 중",
  needs_review: "검수 필요",
  regenerating: "재생성 중",
  approved: "승인됨",
  rejected: "반려됨",
  published: "게시됨",
  failed: "실패",
};

export const DRAFT_STATUS_COLOR: Record<DraftStatus, string> = {
  planned: "ink",
  generating: "accent",
  needs_review: "attention",
  regenerating: "accent",
  approved: "teal",
  rejected: "gray",
  published: "teal",
  failed: "red",
};

// 컷(생성 job) 상태.
export const SHOT_STATUS_LABEL: Record<string, string> = {
  draft: "생성 대기",
  queued: "대기열",
  running: "생성 중",
  completed: "완료",
  failed: "실패",
};

export const SHOT_STATUS_COLOR: Record<string, string> = {
  draft: "ink",
  queued: "attention",
  running: "accent",
  completed: "teal",
  failed: "red",
};

export const FINISH_OPTIONS = [
  { value: "none", label: "원본" },
  { value: "film", label: "필름" },
  { value: "mono-film", label: "흑백" },
] as const;

// 선택 컨트롤과 비교 배지가 같은 이름을 쓰게 한다.
export const FINISH_LABEL = Object.fromEntries(
  FINISH_OPTIONS.map((option) => [option.value, option.label]),
) as Record<FinishPreset, string>;
