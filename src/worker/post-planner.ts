import {
  POST_PLAN_JSON_SCHEMA,
  POST_PLANNER_SYSTEM_PROMPT,
} from "../../prompts/post-planner";
import {
  LLM_LOG_TYPE,
  LlmLogContext,
} from "../domain/llm-logs/llm-log.service";
import { cleanHashtags } from "./content-planner";
import { StrictJsonAgentClient } from "./strict-json-agent";
import { isRecord } from "./value-utils";

const SOURCES = new Set([
  "operatorRequest",
  "persona.boundaries",
  "persona.characterContext",
  "memories",
  "persona.writingProfile.contentStyle",
  "persona.writingProfile.voice",
]);
const MEMORY_TYPES = new Set([
  "fact",
  "preference",
  "relationship",
  "event",
  "routine",
  "goal",
]);

export type PersonaEntry = { title: string; content: string };
export type PostPlannerInput = {
  character: {
    name: string;
    bio: string;
    interests: string[];
    defaultContentLanguage: string;
  };
  persona: {
    characterContext: PersonaEntry[];
    writingProfile: { contentStyle: PersonaEntry[]; voice: PersonaEntry[] };
    boundaries: PersonaEntry[];
    additionalContext: PersonaEntry[];
  };
  memories: { type: string; content: string }[];
  recentPosts: {
    premise: string | null;
    caption: string;
    hashtags: string[];
  }[];
  operatorRequest?: string;
};

export type PostPlanReady = {
  status: "ready";
  intent: {
    premise: string;
    primaryPurpose: string;
    secondaryPurpose: string | null;
  };
  caption: string;
  captionLanguages: string[];
  hashtags: string[];
  newMemoryCandidates: { type: string; content: string }[];
};
export type PostPlanConflict = {
  status: "conflict";
  conflicts: {
    left: { source: string; text: string };
    right: { source: string; text: string };
    reason: string;
  }[];
};
export type PostPlan = PostPlanReady | PostPlanConflict;

export class PostPlanningAgent {
  constructor(private readonly client: StrictJsonAgentClient) {}

  async plan(
    input: PostPlannerInput,
    context?: LlmLogContext,
  ): Promise<{ output: PostPlan; producerLogId: string | null }> {
    const result = await this.client.run({
      logType: LLM_LOG_TYPE.postPlanV3,
      schemaName: "opod_post_plan_v1",
      schema: POST_PLAN_JSON_SCHEMA as unknown as Record<string, unknown>,
      systemPrompt: POST_PLANNER_SYSTEM_PROMPT,
      input,
      context,
    });
    return {
      output: parsePostPlan(result.value),
      producerLogId: result.producerLogId,
    };
  }
}

export function parsePostPlan(value: unknown): PostPlan {
  if (
    !isRecord(value) ||
    (value.status !== "ready" && value.status !== "conflict")
  ) {
    throw new Error("post plan has an invalid status");
  }
  if (value.status === "conflict") {
    exactKeys(value, ["status", "conflicts"], "post plan conflict");
    if (
      !Array.isArray(value.conflicts) ||
      value.conflicts.length === 0 ||
      value.conflicts.length > 20
    ) {
      throw new Error("post plan conflict requires conflicts");
    }
    return {
      status: "conflict",
      conflicts: value.conflicts.map((item, index) => {
        if (!isRecord(item))
          throw new Error(`post plan conflict ${index} is invalid`);
        exactKeys(
          item,
          ["left", "right", "reason"],
          `post plan conflict ${index}`,
        );
        return {
          left: operand(item.left, index, "left"),
          right: operand(item.right, index, "right"),
          reason: requiredText(item.reason, 2_000, `conflict ${index} reason`),
        };
      }),
    };
  }
  exactKeys(
    value,
    [
      "status",
      "intent",
      "caption",
      "captionLanguages",
      "hashtags",
      "newMemoryCandidates",
    ],
    "post plan ready",
  );
  if (!isRecord(value.intent)) throw new Error("post plan intent is invalid");
  exactKeys(
    value.intent,
    ["premise", "primaryPurpose", "secondaryPurpose"],
    "post plan intent",
  );
  const secondaryPurpose =
    value.intent.secondaryPurpose === null
      ? null
      : requiredText(value.intent.secondaryPurpose, 1_000, "secondaryPurpose");
  const captionLanguages = stringArray(
    value.captionLanguages,
    1,
    10,
    35,
    "captionLanguages",
  );
  for (const language of captionLanguages) {
    if (!isCanonicalLanguageTag(language))
      throw new Error(`caption language ${language} is not canonical BCP-47`);
  }
  if (!Array.isArray(value.hashtags))
    throw new Error("hashtags must be an array");
  const hashtags = cleanHashtags(value.hashtags);
  if (hashtags.length !== value.hashtags.length)
    throw new Error("hashtags are not normalized or unique");
  if (
    !Array.isArray(value.newMemoryCandidates) ||
    value.newMemoryCandidates.length > 20
  ) {
    throw new Error("newMemoryCandidates is invalid");
  }
  const newMemoryCandidates = value.newMemoryCandidates.map(
    (candidate, index) => {
      if (!isRecord(candidate))
        throw new Error(`memory candidate ${index} is invalid`);
      exactKeys(candidate, ["type", "content"], `memory candidate ${index}`);
      if (
        typeof candidate.type !== "string" ||
        !MEMORY_TYPES.has(candidate.type)
      ) {
        throw new Error(`memory candidate ${index} has invalid type`);
      }
      return {
        type: candidate.type,
        content: requiredText(
          candidate.content,
          2_000,
          `memory candidate ${index}`,
        ),
      };
    },
  );
  return {
    status: "ready",
    intent: {
      premise: requiredText(value.intent.premise, 2_000, "premise"),
      primaryPurpose: requiredText(
        value.intent.primaryPurpose,
        1_000,
        "primaryPurpose",
      ),
      secondaryPurpose,
    },
    caption: requiredText(value.caption, 2_000, "caption"),
    captionLanguages,
    hashtags,
    newMemoryCandidates,
  };
}

function operand(value: unknown, index: number, side: string) {
  if (!isRecord(value)) throw new Error(`conflict ${index} ${side} is invalid`);
  exactKeys(value, ["source", "text"], `conflict ${index} ${side}`);
  if (typeof value.source !== "string" || !SOURCES.has(value.source)) {
    throw new Error(`conflict ${index} ${side} has invalid source`);
  }
  return {
    source: value.source,
    text: requiredText(value.text, 2_000, `conflict ${index} ${side}`),
  };
}

function requiredText(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`${label} is invalid`);
  return value.trim();
}

function stringArray(
  value: unknown,
  min: number,
  max: number,
  itemMax: number,
  label: string,
): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    throw new Error(`${label} is invalid`);
  const result = value.map((item) => requiredText(item, itemMax, label));
  if (new Set(result).size !== result.length)
    throw new Error(`${label} has duplicates`);
  return result;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${label} has invalid fields`);
  }
}

function isCanonicalLanguageTag(value: string): boolean {
  try {
    return Intl.getCanonicalLocales(value)[0] === value;
  } catch {
    return false;
  }
}
