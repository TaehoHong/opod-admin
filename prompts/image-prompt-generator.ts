export const IMAGE_PROMPT_GENERATOR_VERSION = "image-prompt-generator-v9";
export const PROMPT_SET_CONTRACT_VERSION = "prompt-set-v1";

export const PROMPT_SET_JSON_SCHEMA = {
  type: "object",
  properties: {
    shots: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          sortOrder: { type: "integer", minimum: 0, maximum: 2 },
          prompt: { type: "string", minLength: 1, maxLength: 16_000 },
          negativePrompt: {
            anyOf: [
              { type: "string", minLength: 1, maxLength: 4_000 },
              { type: "null" },
            ],
          },
        },
        required: ["sortOrder", "prompt", "negativePrompt"],
        additionalProperties: false,
      },
    },
  },
  required: ["shots"],
  additionalProperties: false,
} as const;
