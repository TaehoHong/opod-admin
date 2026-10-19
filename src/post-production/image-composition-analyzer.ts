import {
  COMPOSITION_SCHEMA,
  COMPOSITION_SYSTEM_PROMPT,
} from "../../prompts/image-composition";
import { LLM_LOG_TYPE, LlmLogContext } from "../llm-logs/llm-log.service";
import {
  COMPOSITION_VERSION,
  CompositionAnalysis,
  parseComposition,
} from "../shared/ai/image-composition";
import { StrictJsonAgentClient } from "../shared/ai/strict-json-agent";
import { MediaBytesReader, ReferenceImage } from "./reference-captioner";

export class ImageCompositionAnalyzer {
  constructor(
    private readonly client: StrictJsonAgentClient,
    private readonly readBytes: MediaBytesReader,
    readonly model: string,
  ) {}

  async analyze(
    image: ReferenceImage,
    context: LlmLogContext,
  ): Promise<CompositionAnalysis> {
    const { bytes, contentType } = await this.readBytes(image);
    const result = await this.client.run({
      logType: LLM_LOG_TYPE.referenceCaption,
      schemaName: "image_person_composition_v1",
      schema: COMPOSITION_SCHEMA,
      systemPrompt: COMPOSITION_SYSTEM_PROMPT,
      input: { version: COMPOSITION_VERSION },
      userContent: [
        {
          type: "text",
          text: "사진 속 인물의 촬영 상태를 지정된 JSON으로 분석하세요.",
        },
        {
          type: "image_url",
          image_url: {
            url: `data:${contentType};base64,${bytes.toString("base64")}`,
            detail: "high",
          },
        },
      ],
      context,
    });
    return {
      version: COMPOSITION_VERSION,
      model: this.model,
      content: parseComposition(result.value),
    };
  }
}
