import {
  SPICYAPI_API_BASE,
  spicyApiImageModels,
  spicyApiFamily,
  nearestSupportedAspectRatio,
} from "./spicyapi-image-models";
import {
  SpicyApiRequestBody,
  spicyApiRequestBody,
  httpsUrl,
} from "./spicyapi-image-request";
import sharp from "sharp";
import {
  LLM_LOG_TYPE,
  LlmLogContext,
  LlmLogHandle,
  LlmLogService,
} from "../../llm-logs/llm-log.service";
import {
  GeneratedImage,
  GenerationPollResult,
  ImageGenerationConfigError,
  ImageGenerationRequestError,
  ImageGenerationProvider,
  ImageGenerationProviders,
} from "./image-generation.contract";
import { GeneratedImageValidationError } from "../../post-production/generated-image-validation";
import { isRecord } from "../../shared/utils/value-utils";

export {
  SPICYAPI_API_BASE,
  SPICYAPI_IMAGE_MODELS,
  SPICYAPI_DEFAULT_IMAGE_MODEL,
  spicyApiImageModels,
} from "./spicyapi-image-models";

const HTTP_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const IDEMPOTENCY_CONFLICT_RETRY_MS = 500;
// 조회 자체가 영구히 불가능한 응답. 404는 다른 키의 작업이거나 없는 작업이다.
const PERMANENT_LOOKUP_STATUSES = new Set([400, 401, 403, 404]);

export function createSpicyApiImageProviders(
  config: {
    apiKey: string;
    model: string;
    apiBaseUrl?: string;
    qwenImageNegativePrompt?: string;
  },
  fetchFn: typeof fetch = fetch,
  logs?: LlmLogService,
  options: { retryDelayMs?: number } = {},
): ImageGenerationProviders {
  const models = spicyApiImageModels(config.model);
  const apiKey = config.apiKey.trim();
  if (!apiKey || !models) {
    throw new ImageGenerationConfigError(
      "SpicyAPI configuration is missing or unsupported",
    );
  }
  const shared = {
    apiKey,
    apiBaseUrl: config.apiBaseUrl?.replace(/\/$/, "") ?? SPICYAPI_API_BASE,
    fetchFn,
    logs,
    qwenImageNegativePrompt: config.qwenImageNegativePrompt,
    retryDelayMs: options.retryDelayMs ?? IDEMPOTENCY_CONFLICT_RETRY_MS,
  };
  return {
    edit: createSpicyApiImageProvider({ ...shared, model: models.edit }, true),
    t2i: createSpicyApiImageProvider({ ...shared, model: models.t2i }, false),
  };
}

// 접수된 SpicyAPI 작업은 취소할 수 없고 성공하면 과금된다. 그래서 taskId를 끝까지
// 조회하고, 실패·만료·거부는 자동 재제출 없이 terminal로 끝낸다.
function createSpicyApiImageProvider(
  config: {
    apiKey: string;
    model: string;
    fetchFn: typeof fetch;
    logs?: LlmLogService;
    qwenImageNegativePrompt?: string;
    retryDelayMs: number;
    apiBaseUrl: string;
  },
  edit: boolean,
): ImageGenerationProvider {
  const { model, fetchFn, logs } = config;
  const family = spicyApiFamily(model);
  const createUrl = `${config.apiBaseUrl}/jobs/createTask`;
  const authorization = `Bearer ${config.apiKey}`;
  const activeLogs = new Map<string, LlmLogHandle>();
  let logContext: LlmLogContext | undefined;

  // 이미 끝났거나 없는 로그 행 때문에 유료 작업의 조회를 멈추지 않는다.
  const handleFor = async (
    requestId: string,
  ): Promise<LlmLogHandle | undefined> => {
    const active = activeLogs.get(requestId);
    if (active || !logs || !logContext?.generationJobId) return active;
    try {
      const handle = await logs.findRunning({
        type: LLM_LOG_TYPE.imageGenerate,
        generationJobId: logContext.generationJobId,
        providerRequestId: requestId,
      });
      activeLogs.set(requestId, handle);
      return handle;
    } catch {
      return undefined;
    }
  };

  const terminalFailure = async (
    requestId: string,
    message: string,
    responseJson: unknown,
    httpStatus: number,
  ): Promise<GenerationPollResult> => {
    const handle = await handleFor(requestId);
    if (handle) {
      await logs?.fail(handle, new Error(message), {
        responseJson,
        providerRequestId: requestId,
        httpStatus,
      });
    }
    activeLogs.delete(requestId);
    return { status: "failed", permanent: true, errorMessage: message };
  };

  const createTask = async (
    body: SpicyApiRequestBody,
    idempotencyKey: string,
  ): Promise<Response> => {
    const send = () =>
      fetchFn(createUrl, {
        method: "POST",
        headers: {
          authorization,
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    try {
      return await send();
    } catch {
      // 응답만 유실됐을 수 있다. 같은 키로 한 번 더 보내면 이미 접수된 작업을
      // 돌려받으므로 같은 유료 작업이 두 번 생기지 않는다. 이때 409는 첫 요청이
      // 아직 처리 중이라는 뜻이라 잠시 뒤 같은 키로 마지막으로 확인한다.
      const retried = await send();
      if (retried.status !== 409) return retried;
      await delay(config.retryDelayMs);
      return send();
    }
  };

  const download = async (url: string): Promise<Buffer> => {
    // 결과는 서명된 URL이다. API 키를 붙이지 않는다.
    const response = await fetchFn(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(
        `SpicyAPI result download failed (HTTP ${response.status})`,
      );
    }
    return Buffer.from(await response.arrayBuffer());
  };

  return {
    name: `spicyapi:${model}`,
    setLogContext(context) {
      logContext = context;
    },

    async submit(request) {
      const body = spicyApiRequestBody(
        request,
        model,
        edit,
        config.qwenImageNegativePrompt,
      );
      const handle = logs
        ? await logs.start({
            type: LLM_LOG_TYPE.imageGenerate,
            provider: "spicyapi",
            model,
            endpoint: createUrl,
            requestJson: body,
            context: { ...logContext },
          })
        : undefined;
      let response: Response;
      try {
        response = await createTask(body, request.idempotencyKey);
      } catch (error) {
        if (handle) await logs?.fail(handle, error);
        throw error;
      }
      const payload = await responsePayload(response);
      if (!response.ok) {
        const code =
          isRecord(payload) && typeof payload.code === "number"
            ? `, code ${payload.code}`
            : "";
        const message = `SpicyAPI createTask failed (HTTP ${response.status}${code})`;
        if (handle) {
          await logs?.fail(handle, new Error(message), {
            responseJson: payload,
            httpStatus: response.status,
          });
        }
        // 오류 응답은 작업을 만들지 않는다. 429·5xx만 다음 시도에서 다시 제출한다.
        throw new ImageGenerationRequestError(
          message,
          response.status >= 400 &&
            response.status < 500 &&
            response.status !== 429,
        );
      }
      const data =
        isRecord(payload) && isRecord(payload.data) ? payload.data : {};
      if (typeof data.taskId !== "string" || !data.taskId) {
        const message =
          "SpicyAPI createTask response is missing taskId; automatic resubmission disabled";
        if (handle) {
          await logs?.fail(handle, new Error(message), {
            responseJson: payload,
            httpStatus: response.status,
          });
        }
        throw new ImageGenerationRequestError(message, true);
      }
      if (handle) {
        activeLogs.set(data.taskId, handle);
        await logs?.setProviderRequestId(handle, data.taskId);
      }
      return { requestId: data.taskId, sentPrompt: body.input.prompt };
    },

    async poll(requestId, options) {
      const handle = await handleFor(requestId);
      const endpoint = `${config.apiBaseUrl}/jobs/recordInfo?taskId=${encodeURIComponent(requestId)}`;
      // 네트워크 오류는 그대로 던진다. 워커가 같은 taskId로 다음 시도에서 이어 조회한다.
      const response = await fetchFn(endpoint, {
        headers: { authorization },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        if (PERMANENT_LOOKUP_STATUSES.has(response.status)) {
          return terminalFailure(
            requestId,
            `SpicyAPI task lookup failed (HTTP ${response.status}); automatic resubmission disabled`,
            payload,
            response.status,
          );
        }
        throw new Error(
          `SpicyAPI task lookup failed (HTTP ${response.status})`,
        );
      }
      const data =
        isRecord(payload) && isRecord(payload.data) ? payload.data : {};
      // 상태가 없는 응답은 판단할 수 없다. 유료 작업을 버리지 않고 다시 조회한다.
      if (typeof data.state !== "string") {
        throw new Error("SpicyAPI task lookup returned no task state");
      }
      if (data.state === "queued" || data.state === "running") {
        // queued도 running으로 보고한다. 취소할 수 없는 작업을 로컬 마감으로 버리면
        // 비용만 나가고 결과를 잃는다. 원격 deadlineAt이 지나면 expired로 끝난다.
        return {
          status: "pending",
          progress: {
            status: "running",
            phase: data.state === "queued" ? "preparing" : "generating",
          },
        };
      }
      if (data.state !== "succeeded") {
        const state = data.state;
        const errorCode =
          typeof data.errorCode === "string" && data.errorCode
            ? data.errorCode
            : "unknown";
        const detail =
          typeof data.errorMessage === "string" && data.errorMessage.trim()
            ? `: ${data.errorMessage.trim().slice(0, 200)}`
            : "";
        return terminalFailure(
          requestId,
          `SpicyAPI task ${state} (${errorCode})${detail}; automatic resubmission disabled`,
          payload,
          response.status,
        );
      }
      const output = isRecord(data.output) ? data.output : {};
      const assets = Array.isArray(output.assets)
        ? output.assets.filter(isRecord)
        : [];
      if (
        assets.some(
          (asset) => asset.pending === true && asset.unavailable !== true,
        )
      ) {
        return {
          status: "pending",
          progress: { status: "running", phase: "finalizing" },
        };
      }
      const urls = assets.map((asset) =>
        asset.unavailable === true ? undefined : httpsUrl(asset.url),
      );
      if (urls.length === 0 || urls.some((url) => url === undefined)) {
        return terminalFailure(
          requestId,
          "SpicyAPI result has no downloadable image; automatic resubmission disabled",
          payload,
          response.status,
        );
      }
      const images: GeneratedImage[] = [];
      const traces: FitTrace[] = [];
      for (const url of urls as string[]) {
        // 다운로드 오류는 일시 오류다. 다음 조회가 새 서명 URL을 준다.
        const bytes = await download(url);
        let fitted: FittedImage;
        try {
          fitted = await fitToAspectRatio(
            bytes,
            options?.outputAspectRatio ?? null,
            family.aspectRatios,
          );
        } catch (error) {
          if (!(error instanceof GeneratedImageValidationError)) throw error;
          return terminalFailure(
            requestId,
            error.message,
            payload,
            response.status,
          );
        }
        images.push({ url: "", dataBase64: fitted.bytes.toString("base64") });
        traces.push(fitted.trace);
      }
      if (handle) {
        await logs?.succeed(handle, {
          responseJson: isRecord(payload)
            ? { ...payload, opodPostprocess: { images: traces } }
            : payload,
          providerRequestId: requestId,
          httpStatus: response.status,
        });
      }
      activeLogs.delete(requestId);
      const cost = data.settled === true ? Number(data.cost) : Number.NaN;
      return {
        status: "completed",
        images,
        ...(Number.isFinite(cost) && cost >= 0 ? { costUsd: cost } : {}),
      };
    },

    async fail(requestId, error) {
      const handle = await handleFor(requestId);
      if (handle) {
        await logs?.fail(handle, error, { providerRequestId: requestId });
      }
      activeLogs.delete(requestId);
    },
  };
}

type FitTrace = {
  source: { width: number; height: number };
  output: { width: number; height: number };
  providerAspectRatio: string | null;
  cropped: boolean;
};

type FittedImage = { bytes: Buffer; trace: FitTrace };

// 요청 비율보다 넘치는 축만 가운데에서 잘라낸다. 결과가 요청한 지원 비율 범주가
// 아니면(예: 세로 요청에 가로 결과) 자르지 않고 terminal 실패로 남긴다.
async function fitToAspectRatio(
  bytes: Buffer,
  requested: number | null,
  supported: readonly string[],
): Promise<FittedImage> {
  const image = sharp(bytes, { failOn: "warning" });
  let metadata: Awaited<ReturnType<typeof image.metadata>>;
  try {
    metadata = await image.metadata();
  } catch {
    throw new GeneratedImageValidationError("image cannot be fully decoded");
  }
  const { width, height } = metadata.autoOrient;
  if (!metadata.format || !width || !height) {
    throw new GeneratedImageValidationError(
      "unsupported image format or dimensions",
    );
  }
  const source = { width, height };
  if (!requested) {
    return {
      bytes,
      trace: {
        source,
        output: source,
        providerAspectRatio: null,
        cropped: false,
      },
    };
  }
  const provider = nearestSupportedAspectRatio(requested, supported);
  if (
    nearestSupportedAspectRatio(width / height, supported).label !==
    provider.label
  ) {
    throw new GeneratedImageValidationError(
      `provider aspect ratio mismatch: received ${width}x${height}, requested ${provider.label}`,
    );
  }
  const output =
    width / height > requested
      ? { width: Math.round(height * requested), height }
      : { width, height: Math.round(width / requested) };
  if (output.width === width && output.height === height) {
    return {
      bytes,
      trace: {
        source,
        output,
        providerAspectRatio: provider.label,
        cropped: false,
      },
    };
  }
  const region = {
    left: Math.floor((width - output.width) / 2),
    top: Math.floor((height - output.height) / 2),
    ...output,
  };
  let cropped: Buffer;
  try {
    const extracted = sharp(bytes, { failOn: "warning" })
      .rotate()
      .extract(region);
    // 원본 형식을 유지한다. 손실 형식은 추가 손실을 줄이는 설정으로 다시 저장한다.
    cropped = await (
      metadata.format === "jpeg"
        ? extracted.jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
        : metadata.format === "webp"
          ? extracted.webp({ lossless: true })
          : extracted.png()
    ).toBuffer();
  } catch {
    throw new GeneratedImageValidationError("image cannot be fully decoded");
  }
  return {
    bytes: cropped,
    trace: {
      source,
      output,
      providerAspectRatio: provider.label,
      cropped: true,
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
