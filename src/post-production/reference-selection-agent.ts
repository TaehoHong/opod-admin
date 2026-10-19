import { createHash } from "node:crypto";
import { LLM_LOG_TYPE, LlmLogContext } from "../llm-logs/llm-log.service";
import {
  StrictJsonAgentClient,
  requireAgentPromptSettings,
} from "../shared/ai/strict-json-agent";
import { MediaBytesReader, ReferenceImage } from "./reference-captioner";
import {
  ReferenceCandidate,
  parseReferenceSelectionDecision,
} from "./reference-selection";

export type ReferenceSelectionInput = {
  character: { concept: string; imageStyle: string; constraints: string };
  operatorRequest?: string;
};
export type ReferenceSelectionImage = ReferenceCandidate & {
  media: ReferenceImage;
};

export class ReferenceSelectionAgent {
  constructor(
    private readonly client: StrictJsonAgentClient,
    private readonly readBytes: MediaBytesReader,
  ) {}

  async select(
    input: ReferenceSelectionInput,
    candidates: readonly ReferenceSelectionImage[],
    context?: LlmLogContext,
  ) {
    const settings = requireAgentPromptSettings(this.client.agentSettings);
    if (candidates.length < 1 || candidates.length > 12)
      throw new Error("selection requires 1 to 12 candidates");
    const textInput = {
      ...input,
      shotCountRange: { min: 1, max: 3 },
      candidates: candidates.map(({ mediaId }) => ({ mediaId })),
    };
    const userContent: unknown[] = [
      { type: "text", text: JSON.stringify(textInput) },
    ];
    for (const candidate of candidates) {
      const { bytes, contentType } = await this.readBytes(candidate.media);
      if (createHash("sha256").update(bytes).digest("hex") !== candidate.sha256)
        throw new Error(`source image hash mismatch: ${candidate.mediaId}`);
      userContent.push(
        { type: "text", text: `Candidate mediaId ${candidate.mediaId}` },
        {
          type: "image_url",
          image_url: {
            url: `data:${contentType};base64,${bytes.toString("base64")}`,
            detail: "high",
          },
        },
      );
    }
    const result = await this.client.run({
      logType: LLM_LOG_TYPE.referencePostSelection,
      schemaName: "opod_reference_selection_v1",
      schema: settings.outputSchema,
      systemPrompt: settings.systemPrompt,
      input: textInput,
      userContent,
      context,
    });
    return {
      output: parseReferenceSelectionDecision(result.value, candidates),
      producerLogId: result.producerLogId,
    };
  }
}
