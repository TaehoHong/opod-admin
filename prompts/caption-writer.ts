import { rootUnionSchema } from "./strict-schema";

// V4 (2026-08-15): 캡션·해시태그를 ⑤ 이미지 생성 뒤에, 생성된 이미지를 보고 쓴다.
// 설계 정본 docs/post-creation-agent-architecture-v3.md §20.5.
export const CAPTION_WRITER_PROMPT_VERSION = "caption-writer-v3";
export const CAPTION_SET_CONTRACT_VERSION = "caption-set-v2";

const text = (maxLength: number, minLength = 1) => ({
  type: "string",
  minLength,
  maxLength,
});

// captionLanguages·hashtags의 중복 금지는 parseCaptionSet이 강제한다 —
// structured outputs가 uniqueItems를 받지 않는다.
export const CAPTION_SET_JSON_SCHEMA = rootUnionSchema([
  {
    type: "object",
    properties: {
      status: { type: "string", enum: ["ready"] },
      caption: text(2_000),
      captionLanguages: {
        type: "array",
        minItems: 0,
        maxItems: 10,
        items: text(35),
      },
      hashtags: { type: "array", maxItems: 5, items: text(100) },
    },
    required: ["status", "caption", "captionLanguages", "hashtags"],
    additionalProperties: false,
  },
]);
