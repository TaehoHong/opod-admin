import { REFERENCE_VISUAL_SELECTION_PROMPT } from "../../prompts/reference-visual-selection";
import { LLM_LOG_TYPE, LlmLogContext } from "../llm-logs/llm-log.service";
import { CompositionAnalysis } from "../shared/ai/image-composition";
import { StrictJsonAgentClient } from "../shared/ai/strict-json-agent";
import { isRecord } from "../shared/utils/value-utils";
import { MediaBytesReader, ReferenceImage } from "./reference-captioner";

export type VisualSelectionCandidate = {
  mediaId: string;
  description: string;
  composition: CompositionAnalysis;
  score: number;
  media: ReferenceImage;
};

export async function selectCharacterVisuals(input: {
  client: StrictJsonAgentClient;
  readBytes: MediaBytesReader;
  source: ReferenceImage;
  sourceComposition: CompositionAnalysis;
  candidates: VisualSelectionCandidate[];
  maxReferences: number;
  context: LlmLogContext;
}) {
  const textInput = {
    source: input.sourceComposition.content,
    maxReferences: input.maxReferences,
    candidates: input.candidates.map(
      ({ mediaId, description, composition }) => ({
        mediaId,
        description,
        composition: composition.content,
      }),
    ),
  };
  const userContent: unknown[] = [
    { type: "text", text: JSON.stringify(textInput) },
  ];
  for (const image of [
    { label: "SOURCE", media: input.source },
    ...input.candidates.map((candidate) => ({
      label: candidate.mediaId,
      media: candidate.media,
    })),
  ]) {
    const { bytes, contentType } = await input.readBytes(image.media);
    userContent.push(
      { type: "text", text: image.label },
      {
        type: "image_url",
        image_url: {
          url: `data:${contentType};base64,${bytes.toString("base64")}`,
          detail: "high",
        },
      },
    );
  }
  const result = await input.client.run({
    logType: LLM_LOG_TYPE.referencePostSelection,
    schemaName: "reference_character_visual_selection_v1",
    systemPrompt: REFERENCE_VISUAL_SELECTION_PROMPT,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["selections"],
      properties: {
        selections: {
          type: "array",
          maxItems: input.maxReferences,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["mediaId", "reason"],
            properties: {
              mediaId: { type: "string" },
              reason: { type: "string", minLength: 1, maxLength: 1000 },
            },
          },
        },
      },
    },
    input: textInput,
    userContent,
    context: input.context,
  });
  const value = result.value;
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    !Array.isArray(value.selections) ||
    value.selections.length > input.maxReferences
  )
    throw new Error("invalid_character_visual_selection");
  const selected = new Set<string>();
  const selections = value.selections.map((selection: unknown) => {
    if (
      !isRecord(selection) ||
      Object.keys(selection).length !== 2 ||
      typeof selection.mediaId !== "string" ||
      selected.has(selection.mediaId) ||
      !input.candidates.some(
        (candidate) => candidate.mediaId === selection.mediaId,
      ) ||
      typeof selection.reason !== "string" ||
      !selection.reason.trim() ||
      selection.reason.length > 1000
    )
      throw new Error("invalid_character_visual_selection");
    selected.add(selection.mediaId);
    return { mediaId: selection.mediaId, reason: selection.reason };
  });
  if (!selections.length) throw new Error("character_visual_no_match");
  return { selections, producerLogId: result.producerLogId };
}
