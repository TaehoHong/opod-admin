import { randomUUID } from "node:crypto";

export type ImageGenerationRequest = {
  prompt: string;
  negativePrompt?: string;
  // 캐릭터 비주얼 프로필의 레퍼런스 이미지 URL (일관성 컨디셔닝).
  referenceImageUrls: string[];
  candidateCount: number;
  // 프로바이더별 추가 파라미터 (visualProfile.providerConfig ← job.paramsJson
  // 순서로 병합됨). body에 마지막으로 병합되어 모델별 파라미터 이름 차이를
  // 덮어쓸 수 있다 (예: nano-banana의 aspect_ratio, seedream의 image_size).
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
  // 폴링 데드라인 초과 등으로 결과를 포기할 때의 베스트에포트 취소.
  // 큐에서 아직 시작 전인 요청만 실제로 취소되며, 실패는 무시한다.
  cancel?(requestId: string): Promise<void>;
};

// 레퍼런스 유무에 따라 워커가 라우팅하는 프로바이더 쌍 (D4).
// - t2i: 레퍼런스가 없는 잡(비주얼 프로필 콜드스타트 테스트 생성) 담당.
// - edit: 레퍼런스 컨디셔닝 모델. nano-banana/edit·seedream v4 edit 등
//   image_urls가 "필수"인 모델 계열이므로 레퍼런스 없는 잡을 보내면 안 된다.
export type ImageGenerationProviders = {
  t2i: ImageGenerationProvider;
  edit: ImageGenerationProvider;
};

const HTTP_TIMEOUT_MS = 30_000;
const FAL_QUEUE_BASE = "https://queue.fal.run";

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

// 프로바이더 구성 값 — 출처는 env 또는 admin_settings(DB)이며 이 계층은
// 출처를 모른다. 병합/우선순위는 GenerationSettingsService가 담당한다.
export type GenerationProviderSettings = {
  apiKey?: string;
  editModel?: string;
  t2iModel?: string;
};

// 설정 → t2i/edit 프로바이더 쌍.
// - apiKey 없음 → 둘 다 로컬 플레이스홀더.
// - editModel: 레퍼런스 컨디셔닝(edit) 모델. 예: fal-ai/nano-banana/edit
// - t2iModel: 콜드스타트용 text-to-image 모델. 예: fal-ai/nano-banana
//   미설정이면 edit 모델을 그대로 쓴다 — edit 전용 모델(image_urls 필수)을
//   editModel에 넣었다면 반드시 함께 설정해야 콜드스타트가 동작한다.
export function resolveImageGenerationProviders(
  settings: GenerationProviderSettings,
  fetchFn: typeof fetch = fetch,
): ImageGenerationProviders {
  const apiKey = settings.apiKey?.trim();
  const editModel = settings.editModel?.trim();
  const t2iModel = settings.t2iModel?.trim();
  if (!apiKey) {
    const local = createLocalImageGenerationProvider();
    return { t2i: local, edit: local };
  }
  const edit = editModel
    ? createFalImageGenerationProvider({ apiKey, model: editModel }, fetchFn)
    : createLocalImageGenerationProvider();
  const t2i = t2iModel
    ? createFalImageGenerationProvider({ apiKey, model: t2iModel }, fetchFn)
    : edit;
  return { t2i, edit };
}

// env 전용 진입점 (DB 설정 없이 쓰는 테스트/스크립트용).
export function createImageGenerationProviders(
  env: ProviderEnv = process.env,
  fetchFn: typeof fetch = fetch,
): ImageGenerationProviders {
  return resolveImageGenerationProviders(
    {
      apiKey: env.FAL_API_KEY,
      editModel: env.FAL_IMAGE_MODEL,
      t2iModel: env.FAL_IMAGE_T2I_MODEL,
    },
    fetchFn,
  );
}

// fal 모델 ID는 "{owner}/{alias}[/{subpath...}]" 형태다. 제출은 전체 경로로
// 하지만 status/result/cancel 조회는 appId(owner/alias) 기준이어야 한다 —
// 서브패스를 붙이면 404가 난다. (fal queue 규칙: "The subpath should be used
// when making the request, but not when getting request status or results.")
export function falQueueUrls(model: string): {
  submitUrl: string;
  requestUrl: (requestId: string, suffix?: string) => string;
} {
  const appId = model.split("/").slice(0, 2).join("/");
  return {
    submitUrl: `${FAL_QUEUE_BASE}/${model}`,
    requestUrl: (requestId, suffix = "") =>
      `${FAL_QUEUE_BASE}/${appId}/requests/${encodeURIComponent(requestId)}${suffix}`,
  };
}

// negative prompt를 입력 스키마로 받는 모델 계열만 전달한다.
// nano-banana·seedream·flux 계열은 스키마에 없으므로 전달하지 않는다
// (필요하면 paramsJson에 negative_prompt를 직접 넣어 강제할 수 있다).
export function falSupportsNegativePrompt(model: string): boolean {
  return /stable-diffusion|sdxl|sd3/i.test(model);
}

export function createFalImageGenerationProvider(
  config: { apiKey: string; model: string },
  fetchFn: typeof fetch = fetch,
): ImageGenerationProvider {
  const urls = falQueueUrls(config.model);
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
        ...(request.negativePrompt && falSupportsNegativePrompt(config.model)
          ? { negative_prompt: request.negativePrompt }
          : {}),
        ...(request.referenceImageUrls.length > 0
          ? { image_urls: request.referenceImageUrls }
          : {}),
        ...request.extraParams,
      };
      const response = await fetchFn(urls.submitUrl, {
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
        urls.requestUrl(requestId, "/status"),
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

      // 앱이 검증/런타임 오류를 낸 요청도 status는 COMPLETED다.
      // 실패 내용은 result 조회가 4xx/5xx + detail로 돌려준다.
      const resultResponse = await fetchFn(urls.requestUrl(requestId), {
        headers,
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
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

    async cancel(requestId) {
      try {
        await fetchFn(urls.requestUrl(requestId, "/cancel"), {
          method: "PUT",
          headers,
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });
      } catch {
        // 베스트에포트 — 취소 실패는 무시한다.
      }
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
