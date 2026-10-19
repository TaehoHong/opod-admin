import { BadRequestException } from "@nestjs/common";

export const AI_MANAGEMENT_KEY = "ai.management.v1";
export type AiKind = "llm" | "image";
export type AiProvider =
  "openai-compatible" | "openai" | "spicyapi" | "fal" | "opod-flux";
export type AiConnection = {
  id: string;
  type: AiKind;
  provider: AiProvider;
  apiUrl: string;
  apiKey?: string;
  legacyKey?: "planner" | "chat" | "openai" | "spicyapi" | "fal" | "opod-flux";
  models: { id: string; model: string; archived?: boolean }[];
  archived?: boolean;
};
export type AiBinding = { connectionId: string; modelId: string };
// Credentials stay in the connection owner. Jobs only pin the identity and model.
export type AiSelection = AiBinding & { provider: AiProvider; model: string };
export type AiManagementConfig = {
  version: 1;
  revision: string;
  connections: AiConnection[];
  bindings: Record<string, AiBinding>;
  changes: { at: string; actor: string; summary: string }[];
};

const stages = [
  ["post_plan", "게시물 기획", "게시물 주제와 구성", "llm"],
  ["image_plan", "이미지 기획", "촬영 구성과 레퍼런스 선택", "llm"],
  ["image_prompt", "이미지 프롬프트", "이미지 생성 프롬프트 작성", "llm"],
  ["generation", "이미지 생성", "프롬프트와 레퍼런스로 이미지 생성", "image"],
  [
    "naturalness",
    "사진 자연스러움 검수",
    "생성된 사진의 자연스러움 확인",
    "llm",
  ],
  ["requirements", "요구사항 검수", "캐릭터 정체성과 요청 조건 확인", "llm"],
  ["caption", "캡션", "게시물 캡션 작성", "llm"],
] as const;
export const AI_FEATURES = [
  ...stages.map(([stage, label, description, type]) => ({
    id: `natural.${stage}`,
    group: "새 Agent",
    label,
    description,
    type,
  })),
  {
    id: "chat.response",
    group: "캐릭터 채팅",
    label: "응답 생성",
    description: "캐릭터 대화 응답",
    type: "llm" as const,
  },
];

export function aiApiBase(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/, "");
}
export function aiChatUrl(url: string): string {
  return `${aiApiBase(url)}/chat/completions`;
}
export function validateAiApiUrl(value: string, type: AiKind): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new BadRequestException(
      "API 주소는 http:// 또는 https://로 시작해야 합니다.",
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (type === "image" && url.protocol !== "https:")
  )
    throw new BadRequestException(
      "인증 정보·쿼리 없는 API 주소를 입력하세요. 이미지 API는 HTTPS가 필요합니다.",
    );
  return type === "llm"
    ? aiApiBase(url.toString())
    : url.toString().replace(/\/+$/, "");
}
export function selectionFrom(
  config: AiManagementConfig,
  feature: string,
): AiSelection | null {
  const binding = config.bindings[feature];
  if (!binding) return null;
  const connection = config.connections.find(
    (c) => c.id === binding.connectionId,
  );
  const model = connection?.models.find((m) => m.id === binding.modelId);
  if (!connection || !model)
    throw new BadRequestException("모델 연결 설정을 확인하세요.");
  return { ...binding, provider: connection.provider, model: model.model };
}
export function pinnedAiSelection(
  concept: unknown,
  feature: string,
): AiSelection | null {
  const value = (
    concept as { aiModelAssignments?: Record<string, AiSelection> } | null
  )?.aiModelAssignments?.[feature];
  return value &&
    typeof value.connectionId === "string" &&
    typeof value.modelId === "string" &&
    typeof value.provider === "string" &&
    typeof value.model === "string"
    ? value
    : null;
}
