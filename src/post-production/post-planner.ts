import type { CharacterContentProfile } from "../character-content-profiles/character-content-profile";
import { LLM_LOG_TYPE, LlmLogContext } from "../llm-logs/llm-log.service";
import {
  StrictJsonAgentClient,
  InvalidStructuredResponseError,
  requireAgentPromptSettings,
} from "../shared/ai/strict-json-agent";
import { isRecord } from "../shared/utils/value-utils";
import type { PostMemoryEntry, PostPersonaEntry } from "./post-persona-context";
import {
  ContextFactEntry,
  InputQuote,
  inputValue,
  matchesInputQuote,
  resolveContextFactIds,
} from "./planning-evidence";
import { InvalidPlanningResponseError } from "./pipeline-error";

const SOURCES = new Set([
  "operatorRequest",
  "productionContext.mediaType",
  "contentDirection", // Old artifact conflict sources remain readable.
  "contentProfile.accountConcept",
  "contentProfile.constraints",
  "contentProfile.imageStyle",
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

export type PersonaEntry = PostPersonaEntry & ContextFactEntry;
export type PostPlannerInput = {
  productionContext?: { contentType: string; mediaType: "image" };
  contentProfile: Pick<
    CharacterContentProfile,
    "accountConcept" | "constraints"
  > & { imageStyle?: string };
  productionCapabilities?: {
    formats: ("single_image" | "carousel")[];
    maxImages: number;
    contextFactSelection?: "ids";
  };
  locations?: {
    id: string;
    name: string;
    description: string;
    exclusions: string[];
  }[];
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
  memories: (PostMemoryEntry & ContextFactEntry)[];
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
  production?: PostProduction;
};
export type PostProduction = {
  format: "single_image" | "carousel";
  location: { id: string | null; description: string };
  shots: { sortOrder: number; content: string }[];
  requirements: string[];
  contextFacts: InputQuote[];
  contextFactIds?: string[];
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
        schemaName: "opod_post_plan_v4",
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
    [
      "status",
      "intent",
      "accountFit",
      "newMemoryCandidates",
      ...(input?.productionCapabilities ? ["production"] : []),
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
    ...(input?.productionCapabilities
      ? { production: parseProduction(value.production, input) }
      : {}),
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

function parseProduction(
  value: unknown,
  input: PostPlannerInput,
): PostProduction {
  if (!isRecord(value)) throw new Error("production is required");
  const selectIds =
    input.productionCapabilities?.contextFactSelection === "ids";
  exactKeys(
    value,
    [
      "format",
      "location",
      "shots",
      "requirements",
      selectIds ? "contextFactIds" : "contextFacts",
    ],
    "production",
  );
  if (
    !input.productionCapabilities?.formats.includes(
      value.format as PostProduction["format"],
    )
  )
    throw new Error("unsupported production format");
  if (!isRecord(value.location))
    throw new Error("production location is required");
  exactKeys(value.location, ["id", "description"], "production location");
  const id =
    value.location.id === null
      ? null
      : requiredText(value.location.id, 200, "location id");
  if (id !== null && !input.locations?.some((location) => location.id === id))
    throw new Error("production selected an unavailable location");
  if (
    !Array.isArray(value.shots) ||
    !value.shots.length ||
    value.shots.length > input.productionCapabilities.maxImages ||
    (value.format === "single_image"
      ? value.shots.length !== 1
      : value.shots.length < 2)
  )
    throw new Error("production format and shot count disagree");
  const shots = value.shots.map((shot, index) => {
    if (!isRecord(shot)) throw new Error("invalid production shot");
    exactKeys(shot, ["sortOrder", "content"], "production shot");
    if (shot.sortOrder !== index)
      throw new Error("production sortOrder must start at zero");
    return {
      sortOrder: index,
      content: requiredText(shot.content, 500, "shot content"),
    };
  });
  if (!Array.isArray(value.requirements) || value.requirements.length > 10)
    throw new Error("invalid production requirements");
  const facts = selectIds
    ? resolveContextFactIds(input, value.contextFactIds)
    : { contextFacts: parseLegacyContextFacts(value.contextFacts, input) };
  return {
    format: value.format as PostProduction["format"],
    location: {
      id,
      description: requiredText(
        value.location.description,
        500,
        "location description",
      ),
    },
    shots,
    requirements: value.requirements.map((item) =>
      requiredText(item, 500, "requirement"),
    ),
    ...facts,
  };
}

function parseLegacyContextFacts(
  value: unknown,
  input: PostPlannerInput,
): InputQuote[] {
  if (!Array.isArray(value) || value.length > 8)
    throw new Error("invalid context facts");
  return value.map((fact) => {
    if (!isRecord(fact)) throw new Error("invalid context fact");
    exactKeys(fact, ["path", "quote"], "context fact");
    const path = requiredText(fact.path, 300, "fact path");
    const quote = requiredText(fact.quote, 2000, "fact quote");
    if (
      !/^(persona|memories)\./.test(path) ||
      !matchesInputQuote(inputValue(input, path), quote)
    )
      throw new Error("context fact is not grounded in the planning input");
    return { path, quote };
  });
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
