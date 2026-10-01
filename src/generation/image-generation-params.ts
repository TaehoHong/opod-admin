import type { AspectRatioFormat } from "../settings/generation-settings.service";
import { isRecord } from "../shared/utils/value-utils";

export function aspectRatioFormatOf(
  draft: { draftType: string; contentType: string } | null | undefined,
): AspectRatioFormat {
  if (draft?.draftType === "story") return "story";
  return draft?.contentType === "reel" ? "reel" : "feed";
}

// 포맷 기본값 < 프로필(또는 저장된 기획 값) < 명시적 잡 파라미터.
export function resolveImageGenerationParams(
  draft: { draftType: string; contentType: string } | null | undefined,
  aspectRatios: Record<AspectRatioFormat, string>,
  profileParams: unknown,
  jobParams: unknown = {},
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({
      aspect_ratio: aspectRatios[aspectRatioFormatOf(draft)],
      ...(isRecord(profileParams) ? profileParams : {}),
      ...(isRecord(jobParams) ? jobParams : {}),
    }).filter(([key]) => !key.startsWith("_")),
  );
}
