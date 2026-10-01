import {
  POST_PLAN_JSON_SCHEMA,
  POST_PLANNER_PROMPT_VERSION,
} from "./post-planner";
import {
  IMAGE_PLAN_JSON_SCHEMA,
  IMAGE_PLANNER_PROMPT_VERSION,
} from "./image-planner";
import {
  PROMPT_SET_JSON_SCHEMA,
  IMAGE_PROMPT_GENERATOR_VERSION,
} from "./image-prompt-generator";
import {
  CAPTION_SET_JSON_SCHEMA,
  CAPTION_WRITER_PROMPT_VERSION,
} from "./caption-writer";

export const POST_AGENT_STAGES = [
  "post_plan",
  "image_plan",
  "image_prompt",
  "generation",
  "caption",
] as const;
export type PostAgentStage = (typeof POST_AGENT_STAGES)[number];
export const POST_AGENT_CONTRACTS = {
  post_plan: {
    label: "게시물 기획",
    outputSchema: POST_PLAN_JSON_SCHEMA,
    promptVersion: POST_PLANNER_PROMPT_VERSION,
  },
  image_plan: {
    label: "이미지 기획",
    outputSchema: IMAGE_PLAN_JSON_SCHEMA,
    promptVersion: IMAGE_PLANNER_PROMPT_VERSION,
  },
  image_prompt: {
    label: "이미지 프롬프트",
    outputSchema: PROMPT_SET_JSON_SCHEMA,
    promptVersion: IMAGE_PROMPT_GENERATOR_VERSION,
  },
  generation: {
    label: "이미지 생성",
    outputSchema: null,
    promptVersion: null,
  },
  caption: {
    label: "캡션",
    outputSchema: CAPTION_SET_JSON_SCHEMA,
    promptVersion: CAPTION_WRITER_PROMPT_VERSION,
  },
};
