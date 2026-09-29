import sharp from "sharp";
import { isRecord } from "../shared/utils/value-utils";

export class GeneratedImageValidationError extends Error {
  constructor(reason: string) {
    super(`generated_image_invalid: ${reason}`);
  }
}

// 명시적 모델별 크기 설정이 있으면 포맷 기본 비율보다 우선한다.
// 이름으로 된 provider 전용 size/auto는 비율을 추측하지 않는다.
export function requestedImageAspectRatio(
  params: Record<string, unknown> = {},
): number | null {
  if (params.image_size !== undefined) {
    const size = params.image_size;
    return isRecord(size) &&
      typeof size.width === "number" &&
      typeof size.height === "number" &&
      Number.isFinite(size.width) &&
      Number.isFinite(size.height) &&
      size.width > 0 &&
      size.height > 0
      ? size.width / size.height
      : null;
  }
  if (params.size !== undefined) {
    const parts =
      typeof params.size === "string"
        ? /^(\d+)x(\d+)$/.exec(params.size)
        : null;
    return parts && Number(parts[1]) > 0 && Number(parts[2]) > 0
      ? Number(parts[1]) / Number(parts[2])
      : null;
  }
  if (typeof params.aspect_ratio !== "string") return null;
  const parts = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(params.aspect_ratio);
  if (!parts) return null;
  const ratio = Number(parts[1]) / Number(parts[2]);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

export async function validateGeneratedImage(
  bytes: Buffer,
  expectedAspectRatio: number | null,
): Promise<{ width: number; height: number; contentType: string }> {
  if (bytes.length === 0) {
    throw new GeneratedImageValidationError("image file is empty");
  }
  const image = sharp(bytes, { failOn: "warning" });
  let metadata: Awaited<ReturnType<typeof image.metadata>>;
  try {
    metadata = await image.metadata();
    // 헤더만 정상인 잘린 이미지도 검출한다. 원본 바이트는 변환하지 않는다.
    await image.stats();
  } catch {
    throw new GeneratedImageValidationError("image cannot be fully decoded");
  }
  const contentTypes: Record<string, string> = {
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    tiff: "image/tiff",
    heif: metadata.compression === "av1" ? "image/avif" : "image/heif",
  };
  const contentType = contentTypes[metadata.format ?? ""];
  const { width, height } = metadata.autoOrient;
  if (!contentType || !width || !height) {
    throw new GeneratedImageValidationError(
      "unsupported image format or dimensions",
    );
  }
  // 이미지 모델의 정수 해상도 반올림 오차는 1%까지 허용한다.
  if (
    expectedAspectRatio &&
    Math.abs(width / height / expectedAspectRatio - 1) > 0.01
  ) {
    throw new GeneratedImageValidationError(
      `aspect ratio mismatch: received ${width}x${height}, expected ${expectedAspectRatio}`,
    );
  }
  return { width, height, contentType };
}
