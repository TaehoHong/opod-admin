import { InvalidPlanningResponseError } from "./pipeline-error";
import { LLM_LOG_TYPE, LlmLogContext } from "../llm-logs/llm-log.service";
import {
  StrictJsonAgentClient,
  requireAgentPromptSettings,
} from "../shared/ai/strict-json-agent";
import { MediaBytesReader, ReferenceImage } from "./reference-captioner";
import { canonicalJsonHash } from "./post-pipeline-v3";
import { parsePhotoReview } from "./natural-post-agent";

export type LabeledPhoto = {
  label: string;
  mediaId: string;
  media: ReferenceImage;
};
export async function photoContent(
  input: unknown,
  images: LabeledPhoto[],
  readBytes: MediaBytesReader,
) {
  const blocks: unknown[] = [{ type: "text", text: JSON.stringify(input) }];
  const audit: {
    label: string;
    mediaId: string;
    contentType: string;
    bytesHash: string;
  }[] = [];
  for (const image of images) {
    const { bytes, contentType } = await readBytes(image.media);
    if (!bytes.length || !contentType.startsWith("image/"))
      throw new Error("photo_review_missing: 이미지 원본을 읽지 못했습니다.");
    blocks.push(
      { type: "text", text: image.label },
      {
        type: "image_url",
        image_url: {
          url: `data:${contentType};base64,${bytes.toString("base64")}`,
          detail: "high",
        },
      },
    );
    audit.push({
      label: image.label,
      mediaId: image.mediaId,
      contentType,
      bytesHash: canonicalJsonHash(bytes.toString("base64")),
    });
  }
  return { blocks, audit };
}
export async function reviewPhotos(
  client: StrictJsonAgentClient,
  input: unknown,
  images: LabeledPhoto[],
  shotOrders: number[],
  readBytes: MediaBytesReader,
  context: LlmLogContext,
) {
  const settings = requireAgentPromptSettings(client.agentSettings);
  const content = await photoContent(input, images, readBytes);
  const result = await client.run({
    logType: LLM_LOG_TYPE.imageEvaluate,
    schemaName: "opod_natural_photo_review_v1",
    schema: settings.outputSchema,
    systemPrompt: settings.systemPrompt,
    input,
    userContent: content.blocks,
    context,
  });
  try {
    return {
      output: parsePhotoReview(result.value, shotOrders),
      producerLogId: result.producerLogId,
      input,
      images: content.audit,
      agentConfig: settings.metadata,
    };
  } catch (error) {
    throw new InvalidPlanningResponseError(
      error instanceof Error ? error.message : "invalid photo review",
      {
        input: { context: input, images: content.audit },
        output: result.value,
        producerLogId: result.producerLogId,
        agentConfig: settings.metadata,
      },
    );
  }
}
