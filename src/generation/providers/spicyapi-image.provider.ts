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
  ImageGenerationProvider,
  ImageGenerationProviders,
  ImageGenerationRequest,
  ImageGenerationRequestError,
} from "./image-generation.provider";
import {
  GeneratedImageValidationError,
  requestedImageAspectRatio,
} from "../../post-production/generated-image-validation";
import { isRecord } from "../../shared/utils/value-utils";

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
const PROMPT_MAX_LENGTH = 5_000;
const NEGATIVE_PROMPT_MAX_LENGTH = 2_000;
const MAX_SEED = 2_147_483_647;
const DEFAULT_RESOLUTION = "1k";
const HTTP_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const IDEMPOTENCY_CONFLICT_RETRY_MS = 500;
// 조회 자체가 영구히 불가능한 응답. 404는 다른 키의 작업이거나 없는 작업이다.
const PERMANENT_LOOKUP_STATUSES = new Set([400, 401, 403, 404]);

export function spicyApiImageModels(
  model: string | undefined,
): { edit: string; t2i: string } | undefined {
  const family = model?.trim().replace(/\/(?:edit|text-to-image)$/, "");
  if (!family || !SPICYAPI_IMAGE_MODELS.some((id) => id === `${family}/edit`))
    return undefined;
  return { edit: `${family}/edit`, t2i: `${family}/text-to-image` };
}

function spicyApiFamily(model: string): SpicyApiFamily {
  return model.startsWith("bytedance/seedream-") ? SEEDREAM : QWEN;
}

export function createSpicyApiImageProviders(
  config: { apiKey: string; model: string },
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
    fetchFn,
    logs,
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
    retryDelayMs: number;
  },
  edit: boolean,
): ImageGenerationProvider {
  const { model, fetchFn, logs } = config;
  const family = spicyApiFamily(model);
  const createUrl = `${SPICYAPI_API_BASE}/jobs/createTask`;
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
      const body = spicyApiRequestBody(request, model, edit);
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
      const endpoint = `${SPICYAPI_API_BASE}/jobs/recordInfo?taskId=${encodeURIComponent(requestId)}`;
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

type SpicyApiRequestBody = {
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
function spicyApiRequestBody(
  request: ImageGenerationRequest,
  model: string,
  edit: boolean,
): SpicyApiRequestBody {
  const invalid = (message: string): never => {
    throw new ImageGenerationRequestError(message, true);
  };
  const family = spicyApiFamily(model);
  const prompt = request.prompt.trim();
  const negativePrompt = request.negativePrompt?.trim();
  const params = request.extraParams ?? {};
  const resolution = params.resolution ?? DEFAULT_RESOLUTION;
  // Seedream에는 seed 입력이 없다. 재현용 힌트라 다른 provider 파라미터처럼 버린다.
  const seed = family.kind === "qwen" ? params.seed : undefined;
  if (!prompt || prompt.length > PROMPT_MAX_LENGTH)
    invalid("SpicyAPI prompt must be 1 to 5,000 characters");
  // 제외 조건을 몰래 버리지 않는다. 지금 정책은 negativePrompt를 만들지 않는다.
  if (negativePrompt && family.kind === "seedream")
    invalid("SpicyAPI Seedream accepts no negative prompt");
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

// 로그 비율 거리로 가장 가까운 지원 비율을 고른다. 정확히 같은 비율이면 그 값이다.
function nearestSupportedAspectRatio(
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

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
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
