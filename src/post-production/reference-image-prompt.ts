import { createHash } from "node:crypto";
import { LLM_LOG_TYPE, LlmLogContext } from "../llm-logs/llm-log.service";
import {
  StrictJsonAgentClient,
  requireAgentPromptSettings,
} from "../shared/ai/strict-json-agent";
import { isRecord } from "../shared/utils/value-utils";
import { MediaBytesReader, ReferenceImage } from "./reference-captioner";
import { ReferenceSelectionInput } from "./reference-selection-agent";

export type ReferencePromptImage = {
  id: string;
  role: "source" | "character_identity";
  inputOrder: number;
  promptLabel: string;
  sha256?: string;
  media: ReferenceImage;
};
export type ReferenceImagePromptInput = ReferenceSelectionInput & {
  shots: { shotId: string; references: ReferencePromptImage[] }[];
};
export type ReferencePromptShot = {
  shotId: string;
  referenceIds: string[];
  preserve: string;
  adjust: string;
  prompt: string;
  negativePrompt: string;
};
export type ReferenceImagePromptDecision =
  | { status: "ready"; blockedReason: null; shots: ReferencePromptShot[] }
  | { status: "blocked"; blockedReason: string; shots: [] };

export class ReferenceImagePromptAgent {
  constructor(
    private readonly client: StrictJsonAgentClient,
    private readonly readBytes: MediaBytesReader,
  ) {}

  async build(input: ReferenceImagePromptInput, context?: LlmLogContext) {
    const settings = requireAgentPromptSettings(this.client.agentSettings);
    if (
      input.shots.length < 1 ||
      input.shots.length > 3 ||
      new Set(input.shots.map((s) => s.shotId)).size !== input.shots.length
    )
      throw new Error("invalid requested shots");
    const textInput = {
      ...input,
      shots: input.shots.map((shot) => ({
        shotId: shot.shotId,
        references: shot.references.map((reference) => ({
          id: reference.id,
          role: reference.role,
          inputOrder: reference.inputOrder,
          promptLabel: reference.promptLabel,
        })),
      })),
    };
    const userContent: unknown[] = [
      { type: "text", text: JSON.stringify(textInput) },
    ];
    for (const shot of input.shots) {
      if (
        !shot.references.some((r) => r.role === "source") ||
        !shot.references.some((r) => r.role === "character_identity") ||
        new Set(shot.references.map((r) => r.id)).size !==
          shot.references.length
      )
        throw new Error("invalid shot references");
      for (const [index, reference] of shot.references.entries()) {
        if (
          reference.inputOrder !== index + 1 ||
          !reference.promptLabel.trim() ||
          (reference.role === "source" && !reference.sha256)
        )
          throw new Error("invalid reference mapping");
        const { bytes, contentType } = await this.readBytes(reference.media);
        if (
          reference.sha256 &&
          createHash("sha256").update(bytes).digest("hex") !== reference.sha256
        )
          throw new Error(`reference image hash mismatch: ${reference.id}`);
        userContent.push(
          {
            type: "text",
            text: `${shot.shotId} / ${reference.id} / ${reference.promptLabel} / ${reference.role}`,
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${contentType};base64,${bytes.toString("base64")}`,
              detail: "high",
            },
          },
        );
      }
    }
    const result = await this.client.run({
      logType: LLM_LOG_TYPE.referencePostImagePrompt,
      schemaName: "opod_reference_image_prompt_v1",
      schema: settings.outputSchema,
      systemPrompt: settings.systemPrompt,
      input: textInput,
      userContent,
      context,
    });
    return {
      output: parseReferenceImagePrompt(result.value, input),
      producerLogId: result.producerLogId,
    };
  }
}

export function parseReferenceImagePrompt(
  value: unknown,
  input: ReferenceImagePromptInput,
): ReferenceImagePromptDecision {
  if (
    !isRecord(value) ||
    !Array.isArray(value.shots) ||
    !exactKeys(value, ["status", "blockedReason", "shots"])
  )
    throw new Error("invalid reference prompt response");
  if (
    value.status === "blocked" &&
    typeof value.blockedReason === "string" &&
    value.blockedReason.trim() &&
    value.shots.length === 0
  )
    return { status: "blocked", blockedReason: value.blockedReason, shots: [] };
  if (
    value.status !== "ready" ||
    value.blockedReason !== null ||
    value.shots.length !== input.shots.length
  )
    throw new Error("invalid reference prompt status or shots");
  const seen = new Set<string>();
  const shots = value.shots.map((shot: unknown): ReferencePromptShot => {
    if (
      !isRecord(shot) ||
      !exactKeys(shot, [
        "shotId",
        "referenceIds",
        "preserve",
        "adjust",
        "prompt",
        "negativePrompt",
      ]) ||
      typeof shot.shotId !== "string" ||
      seen.has(shot.shotId)
    )
      throw new Error("invalid prompt shot");
    const requested = input.shots.find((s) => s.shotId === shot.shotId);
    if (
      !requested ||
      !Array.isArray(shot.referenceIds) ||
      shot.referenceIds.length !== requested.references.length ||
      shot.referenceIds.some((id, i) => id !== requested.references[i].id)
    )
      throw new Error("prompt reference order mismatch");
    if (
      typeof shot.preserve !== "string" ||
      typeof shot.adjust !== "string" ||
      typeof shot.prompt !== "string" ||
      !shot.prompt.trim() ||
      typeof shot.negativePrompt !== "string"
    )
      throw new Error("invalid prompt text");
    seen.add(shot.shotId);
    return {
      shotId: shot.shotId,
      referenceIds: shot.referenceIds as string[],
      preserve: shot.preserve,
      adjust: shot.adjust,
      prompt: shot.prompt,
      negativePrompt: shot.negativePrompt,
    };
  });
  return {
    status: "ready",
    blockedReason: null,
    shots: input.shots.map((s) =>
      shots.find((shot) => shot.shotId === s.shotId)!,
    ),
  };
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}
