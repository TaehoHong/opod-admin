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
  falApiKey: "",
  falImageModel: "",
  falImageT2iModel: "",
  llmApiKey: "",
  llmApiUrl: "",
  llmModel: "",
  agentLlmApiKey: "",
  agentLlmApiUrl: "",
  agentLlmModel: "",
  agentEmbeddingModel: "",
};

describe("toSettingsUpdate", () => {
  it("keeps blank API keys and clears blank models", () => {
    expect(toSettingsUpdate(empty)).toEqual({
      falImageModel: null,
      falImageT2iModel: null,
      llmApiUrl: null,
      llmModel: null,
      agentLlmApiUrl: null,
      agentLlmModel: null,
      agentEmbeddingModel: null,
    });
  });

  it("sends trimmed values for every filled field", () => {
    expect(
      toSettingsUpdate({
        ...empty,
        falApiKey: "  fal-secret  ",
        llmApiKey: "sk-secret",
        agentLlmApiKey: "sk-chat",
        llmModel: " gpt-5-mini ",
      }),
    ).toEqual({
      falApiKey: "fal-secret",
      falImageModel: null,
      falImageT2iModel: null,
      llmApiKey: "sk-secret",
      llmApiUrl: null,
      llmModel: "gpt-5-mini",
      agentLlmApiKey: "sk-chat",
      agentLlmApiUrl: null,
      agentLlmModel: null,
      agentEmbeddingModel: null,
    });
  });
});

describe("toConnectionTestBody", () => {
  it("omits fields the operator left blank so the server uses effective settings", () => {
    expect(toConnectionTestBody("image", empty)).toEqual({ target: "image" });
    expect(toConnectionTestBody("planner", empty)).toEqual({
      target: "planner",
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
});
