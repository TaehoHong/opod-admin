import {
  ImageGenerationRequest,
  ImageGenerationRequestError,
} from "./image-generation.contract";
import { requestedImageAspectRatio } from "../../post-production/generated-image-validation";
import {
  spicyApiFamily,
  nearestSupportedAspectRatio,
} from "./spicyapi-image-models";

const PROMPT_MAX_LENGTH = 5_000;
const NEGATIVE_PROMPT_MAX_LENGTH = 2_000;
const MAX_SEED = 2_147_483_647;
const DEFAULT_RESOLUTION = "1k";

export type SpicyApiRequestBody = {
  model: string;
  input: {
    prompt: string;
    image_urls?: string[];
    aspect_ratio?: string;
    resolution: "1k" | "2k";
    // Qwen만 받는 입력
    num_outputs?: 1;
    enable_prompt_expansion?: false;
    negative_prompt?: string;
    seed?: number;
    // Seedream만 받는 입력
    enable_thinking?: false;
  };
};

// 다른 provider의 파라미터와 내부 metadata는 보내지 않는다. 입력 오류는 과금 전
// terminal 실패다. 프롬프트를 다시 쓰는 단계(Qwen 확장, Seedream thinking)는 끈다.
export function spicyApiRequestBody(
  request: ImageGenerationRequest,
  model: string,
  edit: boolean,
  commonNegativePrompt?: string,
): SpicyApiRequestBody {
  const invalid = (message: string): never => {
    throw new ImageGenerationRequestError(message, true);
  };
  const family = spicyApiFamily(model);
  let prompt = request.prompt.trim();
  // 공통 문구는 DB 설정에서만 받는다. 지원하지 않는 Seedream에는 붙이지 않는다.
  const negativeEntries = [
    ...(family.kind === "qwen" ? [commonNegativePrompt] : []),
    request.negativePrompt,
  ].flatMap((value) =>
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  const seen = new Set<string>();
  const negativePrompt = negativeEntries
    .filter((entry) => {
      const key = entry.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(", ");
  const params = request.extraParams ?? {};
  const resolution = params.resolution ?? DEFAULT_RESOLUTION;
  // Seedream에는 seed 입력이 없다. 재현용 힌트라 다른 provider 파라미터처럼 버린다.
  const seed = family.kind === "qwen" ? params.seed : undefined;
  if (!prompt || prompt.length > PROMPT_MAX_LENGTH)
    invalid("SpicyAPI prompt must be 1 to 5,000 characters");
  // 제외 조건을 몰래 버리거나 자르지 않는다. 합산 길이도 과금 전에 검사한다.
  if (negativePrompt && family.kind === "seedream")
    prompt = `${prompt} Do not include: ${negativePrompt}.`;
  if (prompt.length > PROMPT_MAX_LENGTH)
    invalid("SpicyAPI combined prompt must be at most 5,000 characters");
  if (negativePrompt && negativePrompt.length > NEGATIVE_PROMPT_MAX_LENGTH)
    invalid("SpicyAPI negative prompt must be at most 2,000 characters");
  if (request.candidateCount !== 1)
    invalid("SpicyAPI returns one image per request; candidateCount must be 1");
  if (
    edit
      ? request.references.length < 1 ||
        request.references.length > family.maxReferences
      : request.references.length > 0
  )
    invalid(
      edit
        ? `SpicyAPI edit requires 1 to ${family.maxReferences} reference images`
        : "SpicyAPI text-to-image accepts no reference images",
    );
  if (request.references.some((reference) => !httpsUrl(reference.url)))
    invalid("SpicyAPI reference images must be HTTPS URLs");
  if (resolution !== "1k" && resolution !== "2k")
    invalid("SpicyAPI resolution must be 1k or 2k");
  if (
    seed !== undefined &&
    (typeof seed !== "number" ||
      !Number.isInteger(seed) ||
      seed < 0 ||
      seed > MAX_SEED)
  )
    invalid("SpicyAPI seed must be an integer from 0 to 2147483647");
  const requested = requestedImageAspectRatio(params);
  return {
    model,
    input: {
      prompt,
      ...(edit
        ? { image_urls: request.references.map((reference) => reference.url) }
        : {}),
      ...(requested !== null
        ? {
            aspect_ratio: nearestSupportedAspectRatio(
              requested,
              family.aspectRatios,
            ).label,
          }
        : {}),
      resolution: resolution as "1k" | "2k",
      ...(family.kind === "seedream"
        ? { enable_thinking: false as const }
        : {
            num_outputs: 1 as const,
            enable_prompt_expansion: false as const,
            ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
            ...(seed !== undefined ? { seed: seed as number } : {}),
          }),
    },
  };
}

export function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}
