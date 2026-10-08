import { BadRequestException } from "@nestjs/common";
import {
  NATURAL_STAGES,
  NaturalStage,
  naturalSchemas,
} from "../../prompts/natural-post-agent";
export {
  NATURAL_STAGES,
  NaturalStage,
  naturalSchemas,
} from "../../prompts/natural-post-agent";
import { canonicalJsonHash, generationSetHash } from "./post-pipeline-v3";
import { isRecord } from "../shared/utils/value-utils";

export const NATURAL_AGENT = "natural-v1" as const;
export type NaturalModel = {
  aiModelId: string;
  provider: string;
  model: string;
};
export type NaturalAgentBundle = {
  version: 1;
  schedulerDefault: boolean;
  revision: string;
  planningModel: NaturalModel;
  reviewModel: NaturalModel;
  generation: {
    id: string;
    revision: number;
    aiModelId: string;
    provider: string;
    effectiveModel: string;
  };
  prompts: Record<NaturalStage, string>;
  schemas: Record<NaturalStage, Record<string, unknown>>;
};
export function isNaturalAgent(
  value: unknown,
): value is Record<string, unknown> & { postGenerationAgent: "natural-v1" } {
  return isRecord(value) && value.postGenerationAgent === NATURAL_AGENT;
}
export function validateNaturalBundle(value: unknown): NaturalAgentBundle {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.schedulerDefault !== "boolean" ||
    !isRecord(value.prompts) ||
    !isRecord(value.schemas) ||
    !isRecord(value.planningModel) ||
    !isRecord(value.reviewModel) ||
    !isRecord(value.generation)
  )
    throw new BadRequestException("새 Agent 설정을 먼저 저장해 주세요.");
  for (const stage of NATURAL_STAGES) {
    const text = value.prompts[stage];
    if (typeof text !== "string" || !text.trim() || text.length > 50000)
      throw new BadRequestException(`${stage} 지침을 확인하세요.`);
  }
  for (const model of [value.planningModel, value.reviewModel]) {
    if (
      typeof model.aiModelId !== "string" ||
      model.provider !== "openai-compatible" ||
      typeof model.model !== "string" ||
      !model.model.trim()
    )
      throw new BadRequestException("새 Agent 모델 설정을 확인하세요.");
  }
  if (
    typeof value.generation.id !== "string" ||
    typeof value.generation.provider !== "string" ||
    typeof value.generation.effectiveModel !== "string"
  )
    throw new BadRequestException(
      "이미지 생성 모델 버전을 먼저 저장해 주세요.",
    );
  const { revision, ...content } = value;
  if (
    canonicalJsonHash(content) !== revision ||
    canonicalJsonHash(value.schemas) !== canonicalJsonHash(naturalSchemas())
  )
    throw new BadRequestException(
      "새 Agent 설정 버전 또는 출력 계약이 유효하지 않습니다. 설정을 다시 저장하세요.",
    );
  return value as unknown as NaturalAgentBundle;
}
export type PhotoReviewResult = {
  shots: {
    sortOrder: number;
    verdict: "accept" | "reject";
    observations: string[];
  }[];
};
export function parsePhotoReview(
  value: unknown,
  shotOrders: number[],
): PhotoReviewResult {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    !Array.isArray(value.shots) ||
    value.shots.length !== shotOrders.length
  )
    throw new Error(
      "photo_review_invalid: every generated image must be reviewed",
    );
  const seen = new Set<number>();
  for (const raw of value.shots) {
    if (
      !isRecord(raw) ||
      Object.keys(raw).length !== 3 ||
      typeof raw.sortOrder !== "number" ||
      !shotOrders.includes(raw.sortOrder) ||
      seen.has(raw.sortOrder) ||
      !["accept", "reject"].includes(String(raw.verdict)) ||
      !Array.isArray(raw.observations) ||
      !raw.observations.length ||
      raw.observations.length > 12 ||
      raw.observations.some(
        (item) =>
          typeof item !== "string" || !item.trim() || item.length > 2000,
      )
    )
      throw new Error(
        "photo_review_invalid: missing, duplicate or invalid photo verdict",
      );
    seen.add(raw.sortOrder);
  }
  return value as PhotoReviewResult;
}
export function assertNaturalPublishable(
  concept: unknown,
  images: { sortOrder: number; jobId: string; mediaId: string }[],
): void {
  if (!isNaturalAgent(concept)) return;
  const bundle = validateNaturalBundle(concept.naturalAgentConfig);
  const review = concept.photoReview;
  const caption = concept.captionBuild;
  if (
    !isRecord(review) ||
    !isRecord(caption) ||
    !isRecord(caption.source) ||
    review.status !== "accepted" ||
    review.configRevision !== bundle.revision ||
    review.operatorRequest !==
      (typeof concept.operatorRequest === "string"
        ? concept.operatorRequest.trim() || null
        : null) ||
    review.generationSetHash !== generationSetHash(images) ||
    caption.source.generationSetHash !== review.generationSetHash ||
    review.imagePlanningHash !==
      (isRecord(concept.imagePlanning)
        ? concept.imagePlanning.hash
        : undefined) ||
    review.promptBuildHash !==
      (isRecord(concept.promptBuild) ? concept.promptBuild.hash : undefined)
  )
    throw new Error(
      "photo_review_required: 현재 이미지에 대한 검수와 캡션을 다시 실행하세요.",
    );
  for (const pass of [review.naturalness, review.requirements]) {
    if (
      !isRecord(pass) ||
      parsePhotoReview(
        pass.output,
        images.map((image) => image.sortOrder),
      ).shots.some((shot) => shot.verdict !== "accept")
    )
      throw new Error(
        "photo_review_rejected: 검수를 통과한 사진만 게시할 수 있습니다.",
      );
  }
}
