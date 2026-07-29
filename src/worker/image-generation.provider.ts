import { randomUUID } from "node:crypto";
import {
  LLM_LOG_TYPE,
  LlmLogContext,
  LlmLogHandle,
  LlmLogService,
} from "../domain/llm-logs/llm-log.service";

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
  // permanent: 입력 검증 실패(422 등) — 같은 입력으로 재시도해도 항상 실패한다.
  | { status: "failed"; errorMessage: string; permanent?: boolean };

// 제출과 결과 수령이 분리된 비동기 프로바이더 계약.
// submit 직후 requestId를 DB에 기록해야 재시작 후 poll로 이어받을 수 있다.
export type ImageGenerationProvider = {
  readonly name: string;
  setLogContext?(context: LlmLogContext): void;
  submit(request: ImageGenerationRequest): Promise<{ requestId: string }>;
  poll(requestId: string): Promise<GenerationPollResult>;
  // 폴링 데드라인 초과 등으로 결과를 포기할 때의 베스트에포트 취소.
  // 큐에서 아직 시작 전인 요청만 실제로 취소되며, 실패는 무시한다.
  cancel?(requestId: string): Promise<void>;
  fail?(requestId: string, error: unknown): Promise<void>;
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
  llmLogs?: LlmLogService,
): ImageGenerationProviders {
  const apiKey = settings.apiKey?.trim();
  const editModel = settings.editModel?.trim();
  const t2iModel = settings.t2iModel?.trim();
  if (!apiKey) {
    const local = createLocalImageGenerationProvider();
    return { t2i: local, edit: local };
  }
  const edit = editModel
    ? createFalImageGenerationProvider(
        { apiKey, model: editModel },
        fetchFn,
        llmLogs,
      )
    : createLocalImageGenerationProvider();
  const t2i = t2iModel
    ? createFalImageGenerationProvider(
        { apiKey, model: t2iModel },
        fetchFn,
        llmLogs,
      )
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

// negative prompt를 입력 스키마로 받는 모델 계열만 별도 필드로 전달한다.
export function falSupportsNegativePrompt(model: string): boolean {
  return /stable-diffusion|sdxl|sd3/i.test(model);
}

export function createFalImageGenerationProvider(
  config: { apiKey: string; model: string },
  fetchFn: typeof fetch = fetch,
  llmLogs?: LlmLogService,
): ImageGenerationProvider {
  const urls = falQueueUrls(config.model);
  const headers = {
    authorization: `Key ${config.apiKey}`,
    "content-type": "application/json",
  };
  const activeLogs = new Map<string, LlmLogHandle>();
  let logContext: LlmLogContext | undefined;

  const handleFor = async (
    requestId: string,
  ): Promise<LlmLogHandle | undefined> => {
    const active = activeLogs.get(requestId);
    if (active || !llmLogs) return active;
    if (!logContext?.generationJobId) {
      throw new Error("generationJobId is required to resume a fal LLM log");
    }
    const handle = await llmLogs.findRunning({
      type: LLM_LOG_TYPE.imageGenerate,
      generationJobId: logContext.generationJobId,
      providerRequestId: requestId,
    });
    activeLogs.set(requestId, handle);
    return handle;
  };

  return {
    name: `fal:${config.model}`,
    setLogContext(context) {
      logContext = context;
    },

    async submit(request) {
      const negativePrompt = request.negativePrompt?.trim();
      const body: Record<string, unknown> = {
        // 별도 필드를 지원하지 않는 모델도 캐릭터의 제외 조건을 잃지 않도록
        // 자연어 지시로 합친다.
        prompt:
          negativePrompt && !falSupportsNegativePrompt(config.model)
            ? `${request.prompt.trim()} Do not include: ${negativePrompt}.`
            : request.prompt,
        num_images: request.candidateCount,
        ...(negativePrompt && falSupportsNegativePrompt(config.model)
          ? { negative_prompt: negativePrompt }
          : {}),
        ...(request.referenceImageUrls.length > 0
          ? { image_urls: request.referenceImageUrls }
          : {}),
        ...request.extraParams,
      };
      const handle = llmLogs
        ? await llmLogs.start({
            type: LLM_LOG_TYPE.imageGenerate,
            provider: "fal",
            model: config.model,
            endpoint: urls.submitUrl,
            requestJson: body,
            context: {
              ...logContext,
            },
          })
        : undefined;
      let response: Response;
      try {
        response = await fetchFn(urls.submitUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });
      } catch (error) {
        if (handle) await llmLogs?.fail(handle, error);
        throw error;
      }
      if (!response.ok) {
        const payload = await responsePayload(response.clone());
        if (handle) {
          await llmLogs?.fail(
            handle,
            new Error(`fal submit failed (${response.status})`),
            { responseJson: payload, httpStatus: response.status },
          );
        }
        throw new Error(
          `fal submit failed (${response.status}): ${await safeText(response)}`,
        );
      }
      const payload = (await response.json()) as { request_id?: string };
      if (!payload.request_id) {
        if (handle) {
          await llmLogs?.fail(
            handle,
            new Error("fal submit response is missing request_id"),
            { responseJson: payload, httpStatus: response.status },
          );
        }
        throw new Error("fal submit response is missing request_id");
      }
      if (handle) {
        activeLogs.set(payload.request_id, handle);
        await llmLogs?.setProviderRequestId(handle, payload.request_id);
      }
      return { requestId: payload.request_id };
    },

    async poll(requestId) {
      const handle = await handleFor(requestId);
      let statusResponse: Response;
      try {
        statusResponse = await fetchFn(urls.requestUrl(requestId, "/status"), {
          headers,
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });
      } catch (error) {
        // 네트워크/타임아웃은 fal 실행 자체의 실패가 아니다. 같은 requestId로
        // 다음 worker 시도가 polling을 이어가므로 로그도 running을 유지한다.
        throw error;
      }
      if (!statusResponse.ok) {
        const payload = await responsePayload(statusResponse.clone());
        if (handle) {
          await llmLogs?.fail(
            handle,
            new Error(`fal status failed (${statusResponse.status})`),
            {
              responseJson: payload,
              providerRequestId: requestId,
              httpStatus: statusResponse.status,
            },
          );
        }
        activeLogs.delete(requestId);
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
        if (handle) {
          await llmLogs?.fail(
            handle,
            new Error(
              `fal request ended with status ${statusPayload.status ?? "unknown"}`,
            ),
            {
              responseJson: statusPayload,
              providerRequestId: requestId,
              httpStatus: statusResponse.status,
            },
          );
        }
        activeLogs.delete(requestId);
        return {
          status: "failed",
          errorMessage: `fal request ended with status ${statusPayload.status ?? "unknown"}`,
        };
      }

      // 앱이 검증/런타임 오류를 낸 요청도 status는 COMPLETED다.
      // 실패 내용은 result 조회가 4xx/5xx + detail로 돌려준다.
      let resultResponse: Response;
      try {
        resultResponse = await fetchFn(urls.requestUrl(requestId), {
          headers,
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });
      } catch (error) {
        // 결과 수신 실패도 동일 실행을 재조회할 수 있으므로 running 유지.
        throw error;
      }
      if (!resultResponse.ok) {
        const payload = await responsePayload(resultResponse.clone());
        if (handle) {
          await llmLogs?.fail(
            handle,
            new Error(`fal result failed (${resultResponse.status})`),
            {
              responseJson: payload,
              providerRequestId: requestId,
              httpStatus: resultResponse.status,
            },
          );
        }
        activeLogs.delete(requestId);
        return {
          status: "failed",
          errorMessage: `fal result failed (${resultResponse.status}): ${await safeText(resultResponse)}`,
          // 422 = 입력 검증 실패(레퍼런스 수 초과, 금지 프롬프트 등).
          // 같은 입력을 다시 보내도 항상 실패하므로 재시도하지 않는다.
          ...(resultResponse.status === 422 ? { permanent: true } : {}),
        };
      }
      const resultPayload = await resultResponse.json();
      const images = imagesFromFalResult(resultPayload);
      if (images.length === 0) {
        if (handle) {
          await llmLogs?.fail(
            handle,
            new Error("fal result contained no images"),
            {
              responseJson: resultPayload,
              providerRequestId: requestId,
              httpStatus: resultResponse.status,
            },
          );
        }
        activeLogs.delete(requestId);
        return {
          status: "failed",
          errorMessage: "fal result contained no images",
        };
      }
      if (handle) {
        await llmLogs?.succeed(handle, {
          responseJson: resultPayload,
          providerRequestId: requestId,
          httpStatus: resultResponse.status,
        });
      }
      activeLogs.delete(requestId);
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

    async fail(requestId, error) {
      const handle = await handleFor(requestId);
      if (handle) await llmLogs?.fail(handle, error);
      activeLogs.delete(requestId);
    },
  };
}

async function responsePayload(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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
