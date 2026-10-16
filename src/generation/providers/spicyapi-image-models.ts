export const SPICYAPI_API_BASE = "https://api.spicyapi.ai/api/v1";

// 2026-10-15 사용자 결정: Qwen Image 3.0 Pro(기본)와 3.0. 같은 날 Qwen의 사진 결이
// 기대보다 낮아 비교용으로 Seedream 5.0 Pro를 추가했다. 설정·Agent 모델에는 edit
// ID를 저장하고, 레퍼런스 없는 경로는 같은 계열의 text-to-image를 쓴다.
export const SPICYAPI_IMAGE_MODELS = [
  "alibaba/qwen-image-3.0-pro/edit",
  "alibaba/qwen-image-3.0/edit",
  "bytedance/seedream-5.0-pro/edit",
] as const;
export const SPICYAPI_DEFAULT_IMAGE_MODEL = SPICYAPI_IMAGE_MODELS[0];

// 계열마다 입력 schema가 다르다. 둘 다 additionalProperties:false라 schema에 없는
// 필드는 보내지 않는다.
type SpicyApiFamily = {
  kind: "qwen" | "seedream";
  aspectRatios: readonly string[];
  maxReferences: number;
};
// Qwen의 aspect_ratio enum에는 4:5가 없어 가장 가까운 비율로 생성한 뒤 요청
// 비율로 중앙 크롭한다(2026-10-15 사용자 결정).
const QWEN: SpicyApiFamily = {
  kind: "qwen",
  aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"],
  maxReferences: 3,
};
// Seedream은 4:5를 직접 받고 레퍼런스를 10장까지 받는다. seed·negative 입력이 없다.
const SEEDREAM: SpicyApiFamily = {
  kind: "seedream",
  aspectRatios: [
    "1:1",
    "4:3",
    "3:4",
    "16:9",
    "9:16",
    "3:2",
    "2:3",
    "4:5",
    "5:4",
    "21:9",
    "9:21",
    "2:1",
    "1:2",
    "3:1",
    "1:3",
  ],
  maxReferences: 10,
};
export function spicyApiImageModels(
  model: string | undefined,
): { edit: string; t2i: string } | undefined {
  const family = model?.trim().replace(/\/(?:edit|text-to-image)$/, "");
  if (!family || !SPICYAPI_IMAGE_MODELS.some((id) => id === `${family}/edit`))
    return undefined;
  return { edit: `${family}/edit`, t2i: `${family}/text-to-image` };
}

export function spicyApiFamily(model: string): SpicyApiFamily {
  return model.startsWith("bytedance/seedream-") ? SEEDREAM : QWEN;
}

// 로그 비율 거리로 가장 가까운 지원 비율을 고른다. 정확히 같은 비율이면 그 값이다.
export function nearestSupportedAspectRatio(
  ratio: number,
  labels: readonly string[],
): {
  label: string;
  value: number;
} {
  return labels
    .map((label) => {
      const [width, height] = label.split(":").map(Number);
      return { label, value: width / height };
    })
    .reduce((best, candidate) =>
      Math.abs(Math.log(candidate.value / ratio)) <
      Math.abs(Math.log(best.value / ratio))
        ? candidate
        : best,
    );
}
