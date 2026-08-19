import type { ConnectionTestTarget, GenerationSettingsUpdate } from "./api";

export type SettingsFormValues = {
  imageProvider: "fal" | "opod-flux";
  falApiKey: string;
  falImageModel: string;
  falImageT2iModel: string;
  opodFluxApiBaseUrl: string;
  opodFluxApiKey: string;
  llmApiKey: string;
  llmApiUrl: string;
  llmModel: string;
  agentLlmApiKey: string;
  agentLlmApiUrl: string;
  agentLlmModel: string;
  agentEmbeddingModel: string;
  evaluatorLlmApiKey: string;
  evaluatorLlmApiUrl: string;
  evaluatorLlmModel: string;
  aspectRatioFeed: string;
  aspectRatioStory: string;
  aspectRatioReel: string;
};

// 모델·URL은 비우면 null(상위 값 복귀), API 키는 비우면 생략(유지)한다.
// 서버 DTO의 "누락 = 유지, null = 삭제" 시맨틱과 짝을 이룬다.
export function toSettingsUpdate(
  values: SettingsFormValues,
): GenerationSettingsUpdate {
  // 빈 키는 필드 자체를 빼서 "유지"로 만든다.
  const secret = (field: keyof GenerationSettingsUpdate, value: string) =>
    value.trim() ? { [field]: value.trim() } : {};
  return {
    imageProvider: values.imageProvider,
    ...secret("falApiKey", values.falApiKey),
    falImageModel: values.falImageModel.trim() || null,
    falImageT2iModel: values.falImageT2iModel.trim() || null,
    opodFluxApiBaseUrl: values.opodFluxApiBaseUrl.trim() || null,
    ...secret("opodFluxApiKey", values.opodFluxApiKey),
    ...secret("llmApiKey", values.llmApiKey),
    llmApiUrl: values.llmApiUrl.trim() || null,
    llmModel: values.llmModel.trim() || null,
    ...secret("agentLlmApiKey", values.agentLlmApiKey),
    agentLlmApiUrl: values.agentLlmApiUrl.trim() || null,
    agentLlmModel: values.agentLlmModel.trim() || null,
    agentEmbeddingModel: values.agentEmbeddingModel.trim() || null,
    ...secret("evaluatorLlmApiKey", values.evaluatorLlmApiKey),
    evaluatorLlmApiUrl: values.evaluatorLlmApiUrl.trim() || null,
    evaluatorLlmModel: values.evaluatorLlmModel.trim() || null,
    aspectRatioFeed: values.aspectRatioFeed.trim() || null,
    aspectRatioStory: values.aspectRatioStory.trim() || null,
    aspectRatioReel: values.aspectRatioReel.trim() || null,
  };
}

// 연결 테스트는 저장하지 않은 입력을 실효 설정 위에 덮어 검증한다. 채팅
// 섹션의 입력은 서버가 받는 공통 llm* 필드로 옮겨 담는다.
export function toConnectionTestBody(
  target: ConnectionTestTarget,
  values: SettingsFormValues,
): {
  target: ConnectionTestTarget;
  imageProvider?: "fal" | "opod-flux";
  falApiKey?: string;
  opodFluxApiBaseUrl?: string;
  opodFluxApiKey?: string;
  llmApiUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
} {
  if (target === "image") {
    if (values.imageProvider === "opod-flux") {
      const opodFluxApiBaseUrl = values.opodFluxApiBaseUrl.trim();
      const opodFluxApiKey = values.opodFluxApiKey.trim();
      return {
        target,
        imageProvider: "opod-flux",
        ...(opodFluxApiBaseUrl ? { opodFluxApiBaseUrl } : {}),
        ...(opodFluxApiKey ? { opodFluxApiKey } : {}),
      };
    }
    const falApiKey = values.falApiKey.trim();
    return {
      target,
      imageProvider: "fal",
      ...(falApiKey ? { falApiKey } : {}),
    };
  }
  const source =
    target === "chat"
      ? {
          llmApiKey: values.agentLlmApiKey,
          llmApiUrl: values.agentLlmApiUrl,
          llmModel: values.agentLlmModel,
        }
      : target === "evaluator"
        ? {
            llmApiKey: values.evaluatorLlmApiKey,
            llmApiUrl: values.evaluatorLlmApiUrl,
            llmModel: values.evaluatorLlmModel,
          }
        : {
            llmApiKey: values.llmApiKey,
            llmApiUrl: values.llmApiUrl,
            llmModel: values.llmModel,
          };
  return {
    target,
    ...Object.fromEntries(
      Object.entries(source)
        .map(([name, value]) => [name, value.trim()])
        .filter(([, value]) => value),
    ),
  };
}
