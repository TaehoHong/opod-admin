import {
  IMAGE_PROMPT_GENERATOR_SYSTEM_PROMPT,
  PROMPT_SET_JSON_SCHEMA,
} from "../../prompts/image-prompt-generator";
import {
  LLM_LOG_TYPE,
  LlmLogContext,
} from "../domain/llm-logs/llm-log.service";
import { PromptBuildPackage } from "./image-model-policy";
import { StrictJsonAgentClient } from "./strict-json-agent";
import { isRecord } from "./value-utils";

export type PromptSet = {
  shots: { sortOrder: number; prompt: string; negativePrompt: string | null }[];
};

export class ImagePromptGenerationAgent {
  constructor(private readonly client: StrictJsonAgentClient) {}
  async generate(
    input: PromptBuildPackage,
    context?: LlmLogContext,
  ): Promise<{ output: PromptSet; producerLogId: string | null }> {
    const result = await this.client.run({
      logType: LLM_LOG_TYPE.imagePromptV3,
      schemaName: "opod_prompt_set_v1",
      schema: PROMPT_SET_JSON_SCHEMA as unknown as Record<string, unknown>,
      systemPrompt: `${IMAGE_PROMPT_GENERATOR_SYSTEM_PROMPT}\n\nActive model policy\n${input.modelPolicy.instructions}`,
      input,
      context,
    });
    return {
      output: parsePromptSet(result.value, input),
      producerLogId: result.producerLogId,
    };
  }
}

export function parsePromptSet(
  value: unknown,
  input: PromptBuildPackage,
): PromptSet {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    !Array.isArray(value.shots) ||
    value.shots.length !== input.imagePlan.shots.length
  ) {
    throw new Error("prompt set has invalid shots");
  }
  return {
    shots: value.shots.map((raw, index) => {
      if (
        !isRecord(raw) ||
        Object.keys(raw).sort().join(",") !==
          "negativePrompt,prompt,sortOrder" ||
        raw.sortOrder !== index
      ) {
        throw new Error(`prompt set shot ${index} is invalid`);
      }
      if (
        typeof raw.prompt !== "string" ||
        !raw.prompt.trim() ||
        raw.prompt.length > 16_000
      )
        throw new Error(`prompt set shot ${index} has invalid prompt`);
      const negativePrompt =
        raw.negativePrompt === null
          ? null
          : typeof raw.negativePrompt === "string" &&
              raw.negativePrompt.trim() &&
              raw.negativePrompt.length <= 4_000
            ? raw.negativePrompt.trim()
            : undefined;
      if (negativePrompt === undefined)
        throw new Error(`prompt set shot ${index} has invalid negativePrompt`);
      if (input.modelPolicy.usesNegativePrompt !== (negativePrompt !== null))
        throw new Error(
          `prompt set shot ${index} violates negative prompt policy`,
        );
      const slots = input.referenceSlots.filter(
        (slot) => slot.shotSortOrder === index,
      );
      for (const slot of slots) {
        if (!raw.prompt.includes(slot.slot))
          throw new Error(`prompt set shot ${index} omitted ${slot.slot}`);
        if (raw.prompt.includes(slot.bindingId))
          throw new Error(`prompt set shot ${index} exposed bindingId`);
      }
      return { sortOrder: index, prompt: raw.prompt.trim(), negativePrompt };
    }),
  };
}

export function assertProviderReferenceOrder(input: {
  shotSortOrder: number;
  promptPackage: PromptBuildPackage;
  referenceMediaIds: string[];
}): void {
  const expected = input.promptPackage.referenceSlots
    .filter((slot) => slot.shotSortOrder === input.shotSortOrder)
    .map((slot) => slot.referenceId);
  if (
    expected.length !== input.referenceMediaIds.length ||
    expected.some((id, index) => id !== input.referenceMediaIds[index])
  ) {
    throw new Error(
      `shot ${input.shotSortOrder} reference slot/asset order mismatch`,
    );
  }
}
