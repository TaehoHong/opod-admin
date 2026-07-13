import { randomUUID } from "node:crypto";

export type ImageGenerationRequest = {
  prompt: string;
  negativePrompt?: string;
  // 캐릭터 비주얼 프로필의 레퍼런스 이미지 URL (일관성 컨디셔닝).
  referenceImageUrls: string[];
  candidateCount: number;
  // 프로바이더별 추가 파라미터 (GenerationJob.paramsJson). 마지막에 병합되어
  // 모델별 파라미터 이름 차이를 덮어쓸 수 있다.
  extraParams?: Record<string, unknown>;
};

export type GeneratedImage = {
  url: string;
  contentType?: string;
  width?: number;
  height?: number;
};

export type GenerationPollResult =
  | { status: "pending" }
  | { status: "completed"; images: GeneratedImage[]; costUsd?: number }
  | { status: "failed"; errorMessage: string };

// 제출과 결과 수령이 분리된 비동기 프로바이더 계약.
// submit 직후 requestId를 DB에 기록해야 재시작 후 poll로 이어받을 수 있다.
export type ImageGenerationProvider = {
  readonly name: string;
  submit(request: ImageGenerationRequest): Promise<{ requestId: string }>;
  poll(requestId: string): Promise<GenerationPollResult>;
};

const HTTP_TIMEOUT_MS = 30_000;

// 1x1 회색 PNG. 로컬 개발용 플레이스홀더.
const PLACEHOLDER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mOsqan5DwAFCAJS0worfgAAAABJRU5ErkJggg==";

export function createLocalImageGenerationProvider(): ImageGenerationProvider {
  const pendingRequests = new Map<string, ImageGenerationRequest>();
  return {
    name: "local",
    submit(request) {
      const requestId = `local-${randomUUID()}`;
      pendingRequests.set(requestId, request);
      return Promise.resolve({ requestId });
    },
    poll(requestId) {
      const request = pendingRequests.get(requestId);
      if (!request) {
        // 프로세스 재시작으로 인메모리 상태가 사라진 경우. 재제출을 유도한다.
        return Promise.resolve({
          status: "failed",
          errorMessage: "Local provider state lost; resubmit required",
        });
      }
      pendingRequests.delete(requestId);
      const images = Array.from(
        { length: Math.max(1, request.candidateCount) },
        () => ({
          url: `data:image/png;base64,${PLACEHOLDER_PNG_BASE64}`,
          contentType: "image/png",
          width: 1,
          height: 1,
        }),
      );
      return Promise.resolve({ status: "completed", images, costUsd: 0 });
    },
  };
}

type ProviderEnv = Record<string, string | undefined>;

// fal.ai queue API 어댑터. FAL_API_KEY + FAL_IMAGE_MODEL이 없으면 로컬 fallback.
export function createImageGenerationProvider(
  env: ProviderEnv = process.env,
  fetchFn: typeof fetch = fetch,
): ImageGenerationProvider {
  const apiKey = env.FAL_API_KEY?.trim();
  const model = env.FAL_IMAGE_MODEL?.trim();
  if (!apiKey || !model) {
    return createLocalImageGenerationProvider();
  }
  return createFalImageGenerationProvider({ apiKey, model }, fetchFn);
}

export function createFalImageGenerationProvider(
  config: { apiKey: string; model: string },
  fetchFn: typeof fetch = fetch,
): ImageGenerationProvider {
  const baseUrl = `https://queue.fal.run/${config.model}`;
  const headers = {
    authorization: `Key ${config.apiKey}`,
    "content-type": "application/json",
  };

  return {
    name: `fal:${config.model}`,

    async submit(request) {
      const body: Record<string, unknown> = {
        prompt: request.prompt,
        num_images: request.candidateCount,
        ...(request.negativePrompt
          ? { negative_prompt: request.negativePrompt }
          : {}),
        ...(request.referenceImageUrls.length > 0
          ? { image_urls: request.referenceImageUrls }
          : {}),
        ...request.extraParams,
      };
      const response = await fetchFn(baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(
          `fal submit failed (${response.status}): ${await safeText(response)}`,
        );
      }
      const payload = (await response.json()) as { request_id?: string };
      if (!payload.request_id) {
        throw new Error("fal submit response is missing request_id");
      }
      return { requestId: payload.request_id };
    },

    async poll(requestId) {
      const statusResponse = await fetchFn(
        `${baseUrl}/requests/${encodeURIComponent(requestId)}/status`,
        { headers, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) },
      );
      if (!statusResponse.ok) {
        return {
          status: "failed",
          errorMessage: `fal status failed (${statusResponse.status}): ${await safeText(statusResponse)}`,
        };
      }
      const statusPayload = (await statusResponse.json()) as {
        status?: string;
      };
      if (
        statusPayload.status === "IN_QUEUE" ||
        statusPayload.status === "IN_PROGRESS"
      ) {
        return { status: "pending" };
      }
      if (statusPayload.status !== "COMPLETED") {
        return {
          status: "failed",
          errorMessage: `fal request ended with status ${statusPayload.status ?? "unknown"}`,
        };
      }

      const resultResponse = await fetchFn(
        `${baseUrl}/requests/${encodeURIComponent(requestId)}`,
        { headers, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) },
      );
      if (!resultResponse.ok) {
        return {
          status: "failed",
          errorMessage: `fal result failed (${resultResponse.status}): ${await safeText(resultResponse)}`,
        };
      }
      const images = imagesFromFalResult(await resultResponse.json());
      if (images.length === 0) {
        return {
          status: "failed",
          errorMessage: "fal result contained no images",
        };
      }
      return { status: "completed", images };
    },
  };
}

function imagesFromFalResult(value: unknown): GeneratedImage[] {
  if (!isRecord(value)) {
    return [];
  }
  const rawImages = Array.isArray(value.images)
    ? value.images
    : isRecord(value.image)
      ? [value.image]
      : [];
  const images: GeneratedImage[] = [];
  for (const raw of rawImages) {
    if (!isRecord(raw) || typeof raw.url !== "string" || !raw.url) {
      continue;
    }
    images.push({
      url: raw.url,
      ...(typeof raw.content_type === "string"
        ? { contentType: raw.content_type }
        : {}),
      ...(typeof raw.width === "number" ? { width: raw.width } : {}),
      ...(typeof raw.height === "number" ? { height: raw.height } : {}),
    });
  }
  return images;
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "<unreadable body>";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
