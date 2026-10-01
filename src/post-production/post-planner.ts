import type { CharacterContentProfile } from "../character-content-profiles/character-content-profile";
import { LLM_LOG_TYPE, LlmLogContext } from "../llm-logs/llm-log.service";
import {
  StrictJsonAgentClient,
  InvalidStructuredResponseError,
  requireAgentPromptSettings,
} from "../shared/ai/strict-json-agent";
import { isRecord } from "../shared/utils/value-utils";
import type { PostMemoryEntry, PostPersonaEntry } from "./post-persona-context";
import { inputValue, matchesInputQuote } from "./planning-evidence";
import { InvalidPlanningResponseError } from "./pipeline-error";

const SOURCES = new Set([
  "operatorRequest",
  "contentDirection", // Old artifact conflict sources remain readable.
  "contentProfile.accountConcept",
  "contentProfile.constraints",
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

export type PersonaEntry = PostPersonaEntry;
export type PostPlannerInput = {
  contentProfile: Pick<
    CharacterContentProfile,
    "accountConcept" | "constraints"
  >;
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
  memories: PostMemoryEntry[];
  recentPosts: {
    premise: string | null;
    caption: string;
    hashtags: string[];
  }[];
  operatorRequest?: string;
};

export type PostPlanReady = {
  status: "ready";
  accountFit: string;
  intent: {
    premise: string;
    primaryPurpose: string;
    secondaryPurpose: string | null;
  };
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
    const settings = requireAgentPromptSettings(this.client.agentSettings);
    let result: { value: unknown; producerLogId: string | null } | undefined;
    try {
      result = await this.client.run({
        logType: LLM_LOG_TYPE.postPlanV3,
        schemaName: "opod_post_plan_v3",
        schema: settings.outputSchema,
        systemPrompt: settings.systemPrompt,
        input,
        context,
      });
      return {
        output: parsePostPlan(result.value, input),
        producerLogId: result.producerLogId,
      };
    } catch (error) {
      if (!result && !(error instanceof InvalidStructuredResponseError))
        throw error;
      throw new InvalidPlanningResponseError(
        error instanceof Error ? error.message : "invalid post plan",
        {
          input,
          output: result
            ? result.value
            : (error as InvalidStructuredResponseError).output,
          producerLogId: result
            ? result.producerLogId
            : (error as InvalidStructuredResponseError).producerLogId,
          agentConfig: settings.metadata,
        },
      );
    }
  }
}

export function parsePostPlan(
  value: unknown,
  input?: PostPlannerInput,
): PostPlan {
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
          left: operand(item.left, index, "left", input),
          right: operand(item.right, index, "right", input),
          reason: requiredText(item.reason, 2_000, `conflict ${index} reason`),
        };
      }),
    };
  }
  exactKeys(
    value,
    ["status", "intent", "accountFit", "newMemoryCandidates"],
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
    accountFit: requiredText(value.accountFit, 2_000, "accountFit"),
    intent: {
      premise: requiredText(value.intent.premise, 2_000, "premise"),
      primaryPurpose: requiredText(
        value.intent.primaryPurpose,
        1_000,
        "primaryPurpose",
      ),
      secondaryPurpose,
    },
    newMemoryCandidates,
  };
}

function operand(
  value: unknown,
  index: number,
  side: string,
  input?: PostPlannerInput,
) {
  if (!isRecord(value)) throw new Error(`conflict ${index} ${side} is invalid`);
  exactKeys(value, ["source", "text"], `conflict ${index} ${side}`);
  if (typeof value.source !== "string" || !SOURCES.has(value.source)) {
    throw new Error(`conflict ${index} ${side} has invalid source`);
  }
  const text = requiredText(value.text, 2_000, `conflict ${index} ${side}`);
  if (!matchesInputQuote(inputValue(input, value.source), text))
    throw new Error(`conflict ${side} does not match input`);
  return { source: value.source, text };
}

function requiredText(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`${label} is invalid`);
  return value.trim();
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
