import {
  LLM_LOG_TYPE,
  LlmLogContext,
  LlmLogHandle,
  LlmLogService,
} from "../domain/llm-logs/llm-log.service";

export type ImageGenerationRequest = {
  idempotencyKey: string;
  profile: "photoreal_identity_v1" | "photoreal_scene_v1";
  prompt: string;
  negativePrompt?: string;
  references: {
    id: string;
    role:
      "identity" | "background" | "outfit" | "pose" | "style" | "composition";
    primary?: boolean;
    url: string;
    description?: string;
  }[];
  candidateCount: number;
  // 프로바이더별 추가 파라미터 (visualProfile.providerConfig ← job.paramsJson
  // 순서로 병합됨). body에 마지막으로 병합되어 모델별 파라미터 이름 차이를
  // 덮어쓸 수 있다 (예: nano-banana의 aspect_ratio, seedream의 image_size).
  extraParams?: Record<string, unknown>;
  metadata?: Record<string, string>;
};

export type GeneratedImage = {
  url: string;
  contentType?: string;
  width?: number;
  height?: number;
  sha256?: string;
  // SSE image 이벤트가 전달한 원본 바이트. 있으면 worker는 output URL을
  // 다시 다운로드하지 않고 이 값을 검증·영구 저장한다.
  dataBase64?: string;
  // opod-flux 복구 polling의 결과 endpoint에 Bearer가 설정된 경우, 결과를
  // 영구 저장하는 worker가 이 헤더로 별도 binary download를 수행한다.
  downloadHeaders?: Record<string, string>;
};

export type ImageGenerationProgress = {
  status: "queued" | "running" | "cancelling";
  phase?: "preparing" | "generating" | "quality_check" | "finalizing";
  stage?: string | null;
  progress?: number;
  updatedAt?: string;
};

export type GenerationPollResult =
  | { status: "pending"; progress?: ImageGenerationProgress }
  | { status: "completed"; images: GeneratedImage[]; costUsd?: number }
  // permanent: 입력 검증 실패(422 등) — 같은 입력으로 재시도해도 항상 실패한다.
  | { status: "failed"; errorMessage: string; permanent?: boolean };

// 제출과 결과 수령이 분리된 비동기 프로바이더 계약.
// submit 직후 requestId를 DB에 기록해야 재시작 후 poll로 이어받을 수 있다.
export type ImageGenerationProvider = {
  readonly name: string;
  setLogContext?(context: LlmLogContext): void;
  // sentPrompt는 프로바이더가 **실제로 보낸** prompt 문자열이다. 네거티브를
  // 본문에 합치는 모델이 있어 request.prompt와 다를 수 있고, 그 차이 때문에
  // 지금까지 DB·화면·연구 로그가 전송본을 못 봤다.
  submit(
    request: ImageGenerationRequest,
  ): Promise<{ requestId: string; sentPrompt: string }>;
  poll(requestId: string): Promise<GenerationPollResult>;
  // SSE처럼 provider가 push 진행률을 제공할 때만 구현한다. 구독 직후 현재
  // 최신값을 한 번 재생하므로 submit/DB 기록 사이에 온 이벤트도 유실되지 않는다.
  subscribeProgress?(
    requestId: string,
    listener: (progress: ImageGenerationProgress) => void,
  ): () => void;
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

const RESERVED_FAL_REQUEST_FIELDS = new Set([
  "prompt",
  "image_urls",
  "num_images",
  "negative_prompt",
]);

function safeFalExtraParams(
  extraParams?: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(extraParams ?? {}).filter(
      ([key]) => !RESERVED_FAL_REQUEST_FIELDS.has(key),
    ),
  );
}

const HTTP_TIMEOUT_MS = 30_000;
const HTTP_OK_STATUS = 200;
const FAL_QUEUE_BASE = "https://queue.fal.run";

// 이미지 생성 설정 누락. 환경 구분 없이 실패시킨다 — 플레이스홀더 이미지를
// 성공으로 처리하면 개발용 결과가 운영 검수 큐에 들어간다
// (docs/02-development-rules.md "필수 설정 누락이나 잘못된 형식은 startup
// failure로 처리한다").
export class ImageGenerationConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageGenerationConfigError";
  }
}

export class ImageGenerationRequestError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = "ImageGenerationRequestError";
  }
}

type ProviderEnv = Record<string, string | undefined>;

// 프로바이더 구성 값 — 출처는 env 또는 admin_settings(DB)이며 이 계층은
// 출처를 모른다. 병합/우선순위는 GenerationSettingsService가 담당한다.
export type GenerationProviderSettings = {
  provider?: "fal" | "opod-flux";
  apiKey?: string;
  editModel?: string;
  t2iModel?: string;
  opodFluxApiBaseUrl?: string;
  opodFluxApiKey?: string;
};

// 설정 → t2i/edit 프로바이더 쌍.
// - apiKey 또는 editModel 없음 → ImageGenerationConfigError.
// - editModel: 레퍼런스 컨디셔닝(edit) 모델. 예: fal-ai/nano-banana/edit
// - t2iModel: 콜드스타트용 text-to-image 모델. 예: fal-ai/nano-banana
//   미설정이면 edit 모델을 그대로 쓴다 — edit 전용 모델(image_urls 필수)을
//   editModel에 넣었다면 반드시 함께 설정해야 콜드스타트가 동작한다.
export function resolveImageGenerationProviders(
  settings: GenerationProviderSettings,
  fetchFn: typeof fetch = fetch,
  llmLogs?: LlmLogService,
): ImageGenerationProviders {
  if (settings.provider === "opod-flux") {
    const provider = createOpodFluxImageGenerationProvider(
      {
        apiBaseUrl: settings.opodFluxApiBaseUrl ?? "",
        apiKey: settings.opodFluxApiKey ?? "",
      },
      fetchFn,
      llmLogs,
    );
    return { t2i: provider, edit: provider };
  }
  const apiKey = settings.apiKey?.trim();
  const editModel = settings.editModel?.trim();
  const t2iModel = settings.t2iModel?.trim();
  if (!apiKey) {
    throw new ImageGenerationConfigError(
      "fal API key is not configured; set it in admin settings or FAL_API_KEY",
    );
  }
  if (!editModel) {
    throw new ImageGenerationConfigError(
      "fal image model is not configured; set it in admin settings or FAL_IMAGE_MODEL",
    );
  }
  const edit = createFalImageGenerationProvider(
    { apiKey, model: editModel },
    fetchFn,
    llmLogs,
  );
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
      provider:
        env.IMAGE_GENERATION_PROVIDER === "opod-flux" ? "opod-flux" : "fal",
      apiKey: env.FAL_API_KEY,
      editModel: env.FAL_IMAGE_MODEL,
      t2iModel: env.FAL_IMAGE_T2I_MODEL,
      opodFluxApiBaseUrl: env.OPOD_FLUX_API_BASE_URL,
      opodFluxApiKey: env.OPOD_FLUX_API_KEY,
    },
    fetchFn,
  );
}

type OpodFluxConfig = { apiBaseUrl: string; apiKey: string };

const OPOD_FLUX_SUBMIT_TIMEOUT_MS = 120_000;

type OpodFluxStreamState = {
  controller: AbortController;
  images: GeneratedImage[];
  progress?: ImageGenerationProgress;
  progressListeners: Set<(progress: ImageGenerationProgress) => void>;
  result?: Exclude<GenerationPollResult, { status: "pending" }>;
  responseJson?: unknown;
  disconnected: boolean;
};

// 승인된 opod-flux v1 POST SSE 계약을 현재 worker의 submit/poll provider
// 경계로 변환한다. accepted에서 submit을 반환하고 stream 결과는 poll로
// 노출한다. webhook은 쓰지 않으며 단절·재시작은 기존 durable polling이 복구한다.
export function createOpodFluxImageGenerationProvider(
  config: OpodFluxConfig,
  fetchFn: typeof fetch = fetch,
  llmLogs?: LlmLogService,
): ImageGenerationProvider {
  const apiBaseUrl = normalizeOpodFluxBaseUrl(config.apiBaseUrl);
  const apiKey = config.apiKey.trim();
  const generationsUrl = `${apiBaseUrl}/generations`;
  const streamUrl = `${generationsUrl}/stream`;
  const authorization = apiKey ? `Bearer ${apiKey}` : undefined;
  const activeLogs = new Map<string, LlmLogHandle>();
  const activeStreams = new Map<string, OpodFluxStreamState>();
  let logContext: LlmLogContext | undefined;

  const handleFor = async (
    requestId: string,
  ): Promise<LlmLogHandle | undefined> => {
    const active = activeLogs.get(requestId);
    if (active || !llmLogs) return active;
    if (!logContext?.generationJobId) {
      throw new Error(
        "generationJobId is required to resume an opod-flux LLM log",
      );
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
    name: "opod-flux:v1",
    setLogContext(context) {
      logContext = context;
    },

    async submit(request) {
      const requestJson = opodFluxRequestBody(request);
      const handle = llmLogs
        ? await llmLogs.start({
            type: LLM_LOG_TYPE.imageGenerate,
            provider: "opod-flux",
            model: request.profile,
            endpoint: streamUrl,
            requestJson,
            context: { ...logContext },
          })
        : undefined;
      const controller = new AbortController();
      const submitTimeout = setTimeout(
        () => controller.abort(),
        OPOD_FLUX_SUBMIT_TIMEOUT_MS,
      );
      let response: Response;
      try {
        response = await fetchFn(streamUrl, {
          method: "POST",
          headers: {
            ...(authorization ? { authorization } : {}),
            accept: "text/event-stream",
            "content-type": "application/json",
            "idempotency-key": request.idempotencyKey,
            ...(logContext?.requestId
              ? { "x-request-id": logContext.requestId }
              : {}),
          },
          body: JSON.stringify(requestJson),
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(submitTimeout);
        if (handle) await llmLogs?.fail(handle, error);
        throw error;
      }
      if (!response.ok) {
        clearTimeout(submitTimeout);
        const message = await opodFluxHttpError(response, "submit failed");
        if (handle) {
          await llmLogs?.fail(handle, new Error(message), {
            responseJson: await responsePayload(response.clone()),
            httpStatus: response.status,
          });
        }
        throw new ImageGenerationRequestError(
          message,
          opodFluxPermanentHttpStatus(response.status),
        );
      }
      if (!response.body) {
        clearTimeout(submitTimeout);
        const error = new Error("opod-flux stream response has no body");
        if (handle) await llmLogs?.fail(handle, error);
        throw error;
      }

      const state: OpodFluxStreamState = {
        controller,
        images: [],
        progressListeners: new Set(),
        disconnected: false,
      };
      let acceptedId: string | undefined;
      let resolveAccepted: (requestId: string) => void = () => undefined;
      let rejectAccepted: (error: unknown) => void = () => undefined;
      const accepted = new Promise<string>((resolve, reject) => {
        resolveAccepted = resolve;
        rejectAccepted = reject;
      });

      void consumeOpodFluxStream(response.body, (eventName, payload) => {
        if (eventName === "accepted") {
          if (!isRecord(payload) || typeof payload.generation_id !== "string") {
            throw new Error(
              "opod-flux accepted event is missing generation_id",
            );
          }
          if (!acceptedId) {
            acceptedId = payload.generation_id;
            activeStreams.set(acceptedId, state);
            updateOpodFluxProgress(state, payload);
            clearTimeout(submitTimeout);
            resolveAccepted(acceptedId);
          } else if (acceptedId !== payload.generation_id) {
            throw new Error("opod-flux stream changed generation_id");
          }
          return;
        }
        if (eventName === "progress") {
          if (!acceptedId || !isRecord(payload)) {
            throw new Error("opod-flux progress event arrived before accepted");
          }
          assertStreamGenerationId(payload, acceptedId);
          if (!updateOpodFluxProgress(state, payload)) {
            throw new Error("opod-flux progress event is invalid");
          }
          return;
        }
        if (eventName === "image") {
          if (!acceptedId || !isRecord(payload)) {
            throw new Error("opod-flux image event arrived before accepted");
          }
          assertStreamGenerationId(payload, acceptedId);
          const images = opodFluxImages(
            "output" in payload ? [payload.output] : [],
            apiBaseUrl,
            authorization,
          );
          if (images.length !== 1) {
            throw new Error("opod-flux image event has an invalid output");
          }
          if (
            typeof payload.data_base64 === "string" &&
            payload.data_base64.length > 0
          ) {
            images[0].dataBase64 = payload.data_base64;
          }
          state.images.push(images[0]);
          return;
        }
        if (eventName === "complete") {
          if (!acceptedId || !isRecord(payload)) {
            throw new Error("opod-flux complete event arrived before accepted");
          }
          assertStreamGenerationId(payload, acceptedId);
          const images =
            state.images.length > 0
              ? state.images
              : opodFluxImages(payload.outputs, apiBaseUrl, authorization);
          state.responseJson = payload;
          state.result =
            images.length > 0
              ? { status: "completed", images }
              : {
                  status: "failed",
                  errorMessage: "opod-flux result contained no outputs",
                  permanent: true,
                };
          controller.abort();
          return;
        }
        if (eventName === "error") {
          if (!isRecord(payload)) {
            throw new Error("opod-flux error event is invalid");
          }
          const error = isRecord(payload.error) ? payload.error : {};
          const code =
            typeof error.code === "string" ? error.code : "GENERATION_FAILED";
          const detail =
            typeof error.message === "string"
              ? error.message
              : "opod-flux generation failed";
          const message = `${code}: ${detail}`;
          if (!acceptedId) {
            clearTimeout(submitTimeout);
            rejectAccepted(new ImageGenerationRequestError(message, true));
            controller.abort();
            return;
          }
          assertStreamGenerationId(payload, acceptedId);
          state.responseJson = payload;
          state.result = {
            status: "failed",
            errorMessage: message,
            // retryable=true도 새 idempotency key가 필요하므로 현재 admin job은
            // terminal 처리하고 운영자의 regenerate가 새 job id를 만든다.
            permanent: true,
          };
          controller.abort();
          return;
        }
        if (eventName === "cancelled") {
          if (!acceptedId || !isRecord(payload)) {
            throw new Error(
              "opod-flux cancelled event arrived before accepted",
            );
          }
          assertStreamGenerationId(payload, acceptedId);
          state.responseJson = payload;
          state.result = {
            status: "failed",
            errorMessage:
              "GENERATION_CANCELLED: opod-flux generation cancelled",
            permanent: true,
          };
          controller.abort();
        }
      })
        .then(() => {
          if (!acceptedId) {
            clearTimeout(submitTimeout);
            rejectAccepted(
              new Error("opod-flux stream ended before accepted event"),
            );
          } else if (!state.result) {
            state.disconnected = true;
          }
        })
        .catch((error: unknown) => {
          clearTimeout(submitTimeout);
          if (!acceptedId) {
            rejectAccepted(error);
          } else {
            // accepted 이후 연결 오류는 생성 작업을 취소하지 않는다. poll()이
            // 저장된 generation id로 상태 endpoint를 조회해 이어받는다. 여기서
            // abort는 서버 작업이 아니라 이미 열린 로컬 HTTP 연결만 닫는다.
            controller.abort();
            state.disconnected = true;
          }
        });

      let requestId: string;
      try {
        requestId = await accepted;
      } catch (error) {
        if (handle) await llmLogs?.fail(handle, error);
        throw error;
      }
      if (handle) {
        activeLogs.set(requestId, handle);
        await llmLogs?.setProviderRequestId(handle, requestId);
      }
      return {
        requestId,
        sentPrompt: request.prompt,
      };
    },

    async poll(requestId) {
      const handle = await handleFor(requestId);
      const stream = activeStreams.get(requestId);
      if (stream && !stream.disconnected && !stream.result) {
        return {
          status: "pending",
          ...(stream.progress ? { progress: stream.progress } : {}),
        };
      }
      if (stream?.result) {
        activeStreams.delete(requestId);
        if (stream.result.status === "completed") {
          if (handle) {
            await llmLogs?.succeed(handle, {
              responseJson: stream.responseJson,
              providerRequestId: requestId,
              httpStatus: HTTP_OK_STATUS,
            });
          }
        } else if (handle) {
          await llmLogs?.fail(handle, new Error(stream.result.errorMessage), {
            responseJson: stream.responseJson,
            providerRequestId: requestId,
            httpStatus: HTTP_OK_STATUS,
          });
        }
        activeLogs.delete(requestId);
        return stream.result;
      }
      if (stream?.disconnected) {
        activeStreams.delete(requestId);
      }
      const endpoint = `${generationsUrl}/${encodeURIComponent(requestId)}`;
      const response = await fetchFn(endpoint, {
        headers: authorization ? { authorization } : {},
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!response.ok) {
        const message = await opodFluxHttpError(response, "status failed");
        if (!opodFluxPermanentHttpStatus(response.status)) {
          // 429/5xx/timeout은 generation 자체의 terminal failure가 아니다.
          // request id와 running log를 유지해 다음 worker 시도가 같은 리소스를
          // 다시 조회하게 한다.
          throw new Error(message);
        }
        if (handle) {
          await llmLogs?.fail(handle, new Error(message), {
            responseJson: await responsePayload(response.clone()),
            providerRequestId: requestId,
            httpStatus: response.status,
          });
        }
        activeLogs.delete(requestId);
        return {
          status: "failed",
          errorMessage: message,
          permanent: true,
        };
      }
      const payload = (await response.json()) as unknown;
      if (!isRecord(payload) || typeof payload.status !== "string") {
        throw new Error("opod-flux status response is invalid");
      }
      if (
        payload.status === "queued" ||
        payload.status === "running" ||
        payload.status === "cancelling"
      ) {
        const progress = opodFluxProgress(payload);
        return {
          status: "pending",
          ...(progress ? { progress } : {}),
        };
      }
      if (payload.status === "failed" || payload.status === "cancelled") {
        const error = isRecord(payload.error) ? payload.error : {};
        const code =
          typeof error.code === "string"
            ? error.code
            : payload.status === "cancelled"
              ? "GENERATION_CANCELLED"
              : "GENERATION_FAILED";
        const detail =
          typeof error.message === "string"
            ? error.message
            : `opod-flux generation ${payload.status}`;
        const message = `${code}: ${detail}`;
        if (handle) {
          await llmLogs?.fail(handle, new Error(message), {
            responseJson: payload,
            providerRequestId: requestId,
            httpStatus: response.status,
          });
        }
        activeLogs.delete(requestId);
        return {
          status: "failed",
          errorMessage: message,
          // v1의 retryable=true는 새 idempotency key가 필요하다. 현재 admin
          // job id로 재제출하면 같은 실패 리소스가 replay되므로, 기존 수동
          // regenerate가 새 job id를 만들도록 이 행은 terminal 처리한다.
          permanent: true,
        };
      }
      if (payload.status !== "succeeded") {
        throw new Error(`opod-flux returned unknown status ${payload.status}`);
      }
      const images = opodFluxImages(payload.outputs, apiBaseUrl, authorization);
      if (images.length === 0) {
        const error = new Error("opod-flux result contained no outputs");
        if (handle) {
          await llmLogs?.fail(handle, error, {
            responseJson: payload,
            providerRequestId: requestId,
            httpStatus: response.status,
          });
        }
        activeLogs.delete(requestId);
        return {
          status: "failed",
          errorMessage: error.message,
          permanent: true,
        };
      }
      if (handle) {
        await llmLogs?.succeed(handle, {
          responseJson: payload,
          providerRequestId: requestId,
          httpStatus: response.status,
        });
      }
      activeLogs.delete(requestId);
      return { status: "completed", images };
    },

    subscribeProgress(requestId, listener) {
      const stream = activeStreams.get(requestId);
      if (!stream) return () => undefined;
      stream.progressListeners.add(listener);
      if (stream.progress) {
        try {
          listener(stream.progress);
        } catch {
          // 관측 listener 실패가 생성 stream을 끊지 않게 격리한다.
        }
      }
      return () => stream.progressListeners.delete(listener);
    },

    async cancel(requestId) {
      activeStreams.get(requestId)?.controller.abort();
      activeStreams.delete(requestId);
      try {
        await fetchFn(
          `${generationsUrl}/${encodeURIComponent(requestId)}/cancel`,
          {
            method: "POST",
            headers: authorization ? { authorization } : {},
            signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
          },
        );
      } catch {
        // 취소는 기존 provider 계약과 같이 best effort다.
      }
    },

    async fail(requestId, error) {
      activeStreams.get(requestId)?.controller.abort();
      activeStreams.delete(requestId);
      const handle = await handleFor(requestId);
      if (handle) await llmLogs?.fail(handle, error);
      activeLogs.delete(requestId);
    },
  };
}

function updateOpodFluxProgress(
  state: OpodFluxStreamState,
  payload: Record<string, unknown>,
): ImageGenerationProgress | undefined {
  const progress = opodFluxProgress(payload);
  if (!progress) return undefined;
  state.progress = progress;
  for (const listener of state.progressListeners) {
    try {
      listener(progress);
    } catch {
      // 비동기 저장 실패는 worker가 로그하며, 동기 listener 실패도 생성 결과와
      // 분리한다.
    }
  }
  return progress;
}

function opodFluxProgress(
  payload: Record<string, unknown>,
): ImageGenerationProgress | undefined {
  const status = payload.status;
  if (status !== "queued" && status !== "running" && status !== "cancelling") {
    return undefined;
  }
  const phase = payload.phase;
  const validPhase =
    phase === "preparing" ||
    phase === "generating" ||
    phase === "quality_check" ||
    phase === "finalizing"
      ? phase
      : undefined;
  const stage =
    typeof payload.stage === "string" || payload.stage === null
      ? payload.stage
      : undefined;
  const progress =
    typeof payload.progress === "number" &&
    Number.isFinite(payload.progress) &&
    payload.progress >= 0 &&
    payload.progress <= 1
      ? payload.progress
      : undefined;
  return {
    status,
    ...(validPhase ? { phase: validPhase } : {}),
    ...(stage !== undefined ? { stage } : {}),
    ...(progress !== undefined ? { progress } : {}),
    ...(typeof payload.updated_at === "string"
      ? { updatedAt: payload.updated_at }
      : {}),
  };
}

async function consumeOpodFluxStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (eventName: string, payload: unknown) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consumeBlocks = (flush: boolean) => {
    const blocks = buffer.split(/\r?\n\r?\n/);
    const trailing = blocks.pop() ?? "";
    for (const block of blocks) {
      parseOpodFluxEventBlock(block, onEvent);
    }
    if (flush) {
      buffer = "";
      if (trailing.trim()) {
        parseOpodFluxEventBlock(trailing, onEvent);
      }
    } else {
      buffer = trailing;
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    consumeBlocks(false);
  }
  buffer += decoder.decode();
  consumeBlocks(true);
}

function parseOpodFluxEventBlock(
  block: string,
  onEvent: (eventName: string, payload: unknown) => void,
): void {
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      const data = line.slice(5);
      dataLines.push(data.startsWith(" ") ? data.slice(1) : data);
    }
  }
  if (dataLines.length === 0) return;
  onEvent(eventName, JSON.parse(dataLines.join("\n")));
}

function assertStreamGenerationId(
  payload: Record<string, unknown>,
  acceptedId: string,
): void {
  if (payload.generation_id !== acceptedId) {
    throw new Error(
      "opod-flux stream event generation_id does not match accepted",
    );
  }
}

function normalizeOpodFluxBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ImageGenerationConfigError("opod-flux API base URL is invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new ImageGenerationConfigError(
      "opod-flux API base URL must use HTTPS without URL credentials",
    );
  }
  return url.toString().replace(/\/$/, "");
}

function opodFluxRequestBody(
  request: ImageGenerationRequest,
): Record<string, unknown> {
  if (
    request.idempotencyKey.length < 8 ||
    request.idempotencyKey.length > 128
  ) {
    throw opodFluxValidationError(
      "idempotency key must contain 8 to 128 characters",
    );
  }
  if (request.prompt.length < 1 || request.prompt.length > 8_000) {
    throw opodFluxValidationError("prompt must contain 1 to 8000 characters");
  }
  if ((request.negativePrompt?.length ?? 0) > 2_000) {
    throw opodFluxValidationError(
      "negative_prompt must contain at most 2000 characters",
    );
  }
  if (
    !Number.isInteger(request.candidateCount) ||
    request.candidateCount < 1 ||
    request.candidateCount > 4
  ) {
    throw opodFluxValidationError(
      "output.count must be an integer from 1 to 4",
    );
  }

  const identityReferences = request.references.filter(
    (reference) => reference.role === "identity",
  );
  const primaryReferences = request.references.filter(
    (reference) => reference.primary === true,
  );
  if (request.profile === "photoreal_identity_v1") {
    if (identityReferences.length < 1 || identityReferences.length > 3) {
      throw opodFluxValidationError(
        "photoreal_identity_v1 requires 1 to 3 identity references",
      );
    }
    if (
      primaryReferences.length !== 1 ||
      primaryReferences[0].role !== "identity"
    ) {
      throw opodFluxValidationError(
        "photoreal_identity_v1 requires exactly one primary identity reference",
      );
    }
  } else if (identityReferences.length > 0 || primaryReferences.length > 0) {
    throw opodFluxValidationError(
      "photoreal_scene_v1 does not allow identity or primary references",
    );
  }

  const extra = request.extraParams ?? {};
  const aspectRatio = extra.aspect_ratio;
  if (
    typeof aspectRatio !== "string" ||
    !OPOD_FLUX_ASPECT_RATIOS.has(aspectRatio)
  ) {
    throw opodFluxValidationError("output.aspect_ratio is unsupported");
  }
  const longEdge = extra.long_edge ?? 2048;
  if (
    !Number.isInteger(longEdge) ||
    (longEdge as number) < 512 ||
    (longEdge as number) > 4096
  ) {
    throw opodFluxValidationError(
      "output.long_edge must be an integer from 512 to 4096",
    );
  }
  const format = extra.format ?? "jpeg";
  if (!OPOD_FLUX_FORMATS.has(format)) {
    throw opodFluxValidationError("output.format is unsupported");
  }
  const quality = extra.quality ?? 95;
  if (
    !Number.isInteger(quality) ||
    (quality as number) < 70 ||
    (quality as number) > 100
  ) {
    throw opodFluxValidationError(
      "output.quality must be an integer from 70 to 100",
    );
  }
  const output: Record<string, unknown> = {
    count: request.candidateCount,
    aspect_ratio: aspectRatio,
    long_edge: longEdge,
    format,
    quality,
  };

  const seed = extra.seed ?? null;
  if (
    seed !== null &&
    (!Number.isInteger(seed) ||
      (seed as number) < 0 ||
      (seed as number) > 4_294_967_295)
  ) {
    throw opodFluxValidationError(
      "controls.seed must be null or an integer from 0 to 4294967295",
    );
  }
  const controls: Record<string, unknown> = { seed };
  if (request.profile === "photoreal_identity_v1") {
    controls.identity_strict =
      typeof extra.identity_strict === "boolean" ? extra.identity_strict : true;
  }

  return {
    profile: request.profile,
    prompt: request.prompt,
    negative_prompt: request.negativePrompt ?? null,
    references: request.references.map((reference) => ({
      id: reference.id,
      role: reference.role,
      ...(reference.primary === true ? { primary: true } : {}),
      source: { type: "url", url: reference.url },
      ...(reference.description ? { description: reference.description } : {}),
    })),
    output,
    controls,
    webhook_id: null,
    metadata: request.metadata ?? {},
  };
}

const OPOD_FLUX_ASPECT_RATIOS = new Set([
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
]);
const OPOD_FLUX_FORMATS = new Set<unknown>(["jpeg", "png", "webp"]);

function opodFluxValidationError(message: string): ImageGenerationRequestError {
  return new ImageGenerationRequestError(`opod-flux ${message}`, true);
}

function opodFluxImages(
  value: unknown,
  apiBaseUrl: string,
  authorization?: string,
): GeneratedImage[] {
  if (!Array.isArray(value)) return [];
  const apiBase = new URL(apiBaseUrl);
  const generationPath = `${apiBase.pathname.replace(/\/$/, "")}/generations/`;
  return value.flatMap((output) => {
    if (!isRecord(output) || typeof output.download_url !== "string") {
      return [];
    }
    let downloadUrl: URL;
    try {
      downloadUrl = new URL(output.download_url);
    } catch {
      return [];
    }
    // Bearer 키가 서비스 밖으로 전달되지 않도록 인증 다운로드는 설정된
    // opod-flux origin과 generation 경로 안에서만 허용한다.
    if (
      downloadUrl.protocol !== "https:" ||
      downloadUrl.username ||
      downloadUrl.password ||
      downloadUrl.origin !== apiBase.origin ||
      !downloadUrl.pathname.startsWith(generationPath)
    ) {
      return [];
    }
    return [
      {
        url: downloadUrl.toString(),
        ...(typeof output.content_type === "string"
          ? { contentType: output.content_type }
          : {}),
        ...(typeof output.width === "number" ? { width: output.width } : {}),
        ...(typeof output.height === "number" ? { height: output.height } : {}),
        ...(typeof output.sha256 === "string" ? { sha256: output.sha256 } : {}),
        ...(authorization ? { downloadHeaders: { authorization } } : {}),
      },
    ];
  });
}

async function opodFluxHttpError(
  response: Response,
  fallback: string,
): Promise<string> {
  const payload = await responsePayload(response.clone());
  const error =
    isRecord(payload) && isRecord(payload.error) ? payload.error : {};
  const code = typeof error.code === "string" ? error.code : "HTTP_ERROR";
  const message = typeof error.message === "string" ? error.message : fallback;
  return `opod-flux ${response.status} ${code}: ${message}`.slice(0, 500);
}

function opodFluxPermanentHttpStatus(status: number): boolean {
  return status >= 400 && status < 500 && ![408, 425, 429].includes(status);
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
      const extraParams = safeFalExtraParams(request.extraParams);
      // 별도 필드를 지원하지 않는 모델도 캐릭터의 제외 조건을 잃지 않도록
      // 자연어 지시로 합친다.
      const sentPrompt =
        negativePrompt && !falSupportsNegativePrompt(config.model)
          ? `${request.prompt.trim()} Do not include: ${negativePrompt}.`
          : request.prompt;
      const body: Record<string, unknown> = {
        prompt: sentPrompt,
        num_images: request.candidateCount,
        ...(negativePrompt && falSupportsNegativePrompt(config.model)
          ? { negative_prompt: negativePrompt }
          : {}),
        ...(request.references.length > 0
          ? { image_urls: request.references.map((reference) => reference.url) }
          : {}),
        ...extraParams,
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
      return { requestId: payload.request_id, sentPrompt };
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
