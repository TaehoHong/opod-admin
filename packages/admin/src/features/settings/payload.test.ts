import { describe, expect, it } from "vitest";
import {
  toConnectionTestBody,
  toSettingsUpdate,
  type SettingsFormValues,
} from "./payload";

// 빈 칸의 의미가 필드마다 다르다: API 키는 "그대로 두기", 모델·URL은 "상위
// 값으로 되돌리기". 이 구분이 뒤집히면 저장 한 번에 운영 중인 키가 지워지거나
// 옛 모델이 남는데, 화면에는 아무 신호도 나타나지 않는다.
const empty: SettingsFormValues = {
  imageProvider: "fal",
  falApiKey: "",
  falImageModel: "",
  falImageT2iModel: "",
  opodFluxApiBaseUrl: "",
  opodFluxApiKey: "",
  llmApiKey: "",
  llmApiUrl: "",
  llmModel: "",
  agentLlmApiKey: "",
  agentLlmApiUrl: "",
  agentLlmModel: "",
  agentEmbeddingModel: "",
  evaluatorLlmApiKey: "",
  evaluatorLlmApiUrl: "",
  evaluatorLlmModel: "",
  aspectRatioFeed: "",
  aspectRatioStory: "",
  aspectRatioReel: "",
};

describe("toSettingsUpdate", () => {
  it("keeps blank API keys and clears blank models", () => {
    expect(toSettingsUpdate(empty)).toEqual({
      imageProvider: "fal",
      falImageModel: null,
      falImageT2iModel: null,
      opodFluxApiBaseUrl: null,
      llmApiUrl: null,
      llmModel: null,
      agentLlmApiUrl: null,
      agentLlmModel: null,
      agentEmbeddingModel: null,
      evaluatorLlmApiUrl: null,
      evaluatorLlmModel: null,
      // 비운 종횡비는 삭제 = 코드 기본값 복귀다. 생략(유지)이 아니다.
      aspectRatioFeed: null,
      aspectRatioStory: null,
      aspectRatioReel: null,
    });
  });

  it("sends trimmed values for every filled field", () => {
    expect(
      toSettingsUpdate({
        ...empty,
        falApiKey: "  fal-secret  ",
        llmApiKey: "sk-secret",
        agentLlmApiKey: "sk-chat",
        evaluatorLlmApiKey: "sk-eval",
        llmModel: " gpt-5-mini ",
        aspectRatioFeed: " 4:5 ",
      }),
    ).toEqual({
      imageProvider: "fal",
      falApiKey: "fal-secret",
      falImageModel: null,
      falImageT2iModel: null,
      opodFluxApiBaseUrl: null,
      llmApiKey: "sk-secret",
      llmApiUrl: null,
      llmModel: "gpt-5-mini",
      agentLlmApiKey: "sk-chat",
      agentLlmApiUrl: null,
      agentLlmModel: null,
      agentEmbeddingModel: null,
      evaluatorLlmApiKey: "sk-eval",
      evaluatorLlmApiUrl: null,
      evaluatorLlmModel: null,
      aspectRatioFeed: "4:5",
      aspectRatioStory: null,
      aspectRatioReel: null,
    });
  });
});

describe("toConnectionTestBody", () => {
  it("omits fields the operator left blank so the server uses effective settings", () => {
    expect(toConnectionTestBody("image", empty)).toEqual({
      target: "image",
      imageProvider: "fal",
    });
    expect(toConnectionTestBody("planner", empty)).toEqual({
      target: "planner",
    });
  });

  it("sends only opod-flux connection fields when that provider is selected", () => {
    expect(
      toConnectionTestBody("image", {
        ...empty,
        imageProvider: "opod-flux",
        falApiKey: "fal-secret",
        opodFluxApiBaseUrl: " https://opod-flux.internal/v1 ",
        opodFluxApiKey: " flux-secret ",
      }),
    ).toEqual({
      target: "image",
      imageProvider: "opod-flux",
      opodFluxApiBaseUrl: "https://opod-flux.internal/v1",
      opodFluxApiKey: "flux-secret",
    });
  });

  it("maps chat section inputs onto the shared llm test fields", () => {
    expect(
      toConnectionTestBody("chat", {
        ...empty,
        llmModel: "planner-model",
        agentLlmModel: "chat-model",
        agentLlmApiKey: "sk-chat",
      }),
    ).toEqual({
      target: "chat",
      llmModel: "chat-model",
      llmApiKey: "sk-chat",
    });
  });

  it("maps evaluator section inputs onto the shared llm test fields", () => {
    expect(
      toConnectionTestBody("evaluator", {
        ...empty,
        llmModel: "planner-model",
        agentLlmModel: "chat-model",
        evaluatorLlmModel: "eval-model",
        evaluatorLlmApiKey: "sk-eval",
      }),
    ).toEqual({
      target: "evaluator",
      llmModel: "eval-model",
      llmApiKey: "sk-eval",
    });
  });
});
