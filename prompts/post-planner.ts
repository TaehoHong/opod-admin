import { rootUnionSchema } from "./strict-schema";

// v3: 계정 흐름과 이번 순간의 관계(accountFit)를 기획 artifact에 남긴다.
// 기존 v1/v2 artifact의 후속 실행은 intent를 계속 읽는다. 캡션은 별도 Agent 소유다.
export const POST_PLANNER_PROMPT_VERSION = "post-planner-v7";
export const POST_PLAN_CONTRACT_VERSION = "post-plan-v4";

const text = (maxLength: number, minLength = 1) => ({
  type: "string",
  minLength,
  maxLength,
});

const operand = {
  type: "object",
  properties: {
    source: {
      type: "string",
      enum: [
        "operatorRequest",
        "productionContext.mediaType",
        "contentProfile.accountConcept",
        "contentProfile.constraints",
        "persona.boundaries",
        "persona.characterContext",
        "memories",
        "persona.writingProfile.contentStyle",
        "persona.writingProfile.voice",
      ],
    },
    text: text(2_000),
  },
  required: ["source", "text"],
  additionalProperties: false,
};

// 배열 중복 금지는 스키마가 아니라 parsePostPlan이 강제한다 — structured
// outputs가 uniqueItems를 받지 않는다.
export const POST_PLAN_JSON_SCHEMA = rootUnionSchema([
  {
    type: "object",
    properties: {
      status: { type: "string", enum: ["ready"] },
      accountFit: text(2_000),
      intent: {
        type: "object",
        properties: {
          premise: text(2_000),
          primaryPurpose: text(1_000),
          secondaryPurpose: { anyOf: [text(1_000), { type: "null" }] },
        },
        required: ["premise", "primaryPurpose", "secondaryPurpose"],
        additionalProperties: false,
      },
      newMemoryCandidates: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: [
                "fact",
                "preference",
                "relationship",
                "event",
                "routine",
                "goal",
              ],
            },
            content: text(2_000),
          },
          required: ["type", "content"],
          additionalProperties: false,
        },
      },
    },
    required: ["status", "intent", "accountFit", "newMemoryCandidates"],
    additionalProperties: false,
  },
  {
    type: "object",
    properties: {
      status: { type: "string", enum: ["conflict"] },
      conflicts: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: {
          type: "object",
          properties: { left: operand, right: operand, reason: text(2_000) },
          required: ["left", "right", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["status", "conflicts"],
    additionalProperties: false,
  },
]);
