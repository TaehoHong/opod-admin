import { randomUUID } from "node:crypto";
import {
  LLM_LOG_TYPE,
  LlmLogContext,
  LlmLogService,
} from "../../llm-logs/llm-log.service";
import {
  ImageGenerationConfigError,
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageGenerationRequestError,
  GenerationPollResult,
} from "./image-generation.provider";
import { requestedImageAspectRatio } from "../../post-production/generated-image-validation";
import { isRecord } from "../../shared/utils/value-utils";

export const SUNBURST_MODEL = "gpt-image-2.5-sunburst";
const BASE = "https://api.openai.com/v1/images";

// Images API has no request-result retrieval endpoint. Record the local receipt
// before starting the paid call; a lost process must fail, never silently regenerate.
export function createOpenAiImageProvider(
  config: { apiKey: string; model: string },
  fetchFn: typeof fetch = fetch,
  logs?: LlmLogService,
): ImageGenerationProvider {
  if (!config.apiKey.trim() || config.model !== SUNBURST_MODEL) {
    throw new ImageGenerationConfigError(
      "OpenAI Sunburst configuration is missing or unsupported",
    );
  }
  let context: LlmLogContext | undefined;
  const requests = new Map<
    string,
    {
      body: Record<string, unknown>;
      edit: boolean;
      controller: AbortController;
      started: boolean;
      result?: GenerationPollResult;
    }
  >();
  return {
    name: `openai:${config.model}`,
    setLogContext(value) {
      context = value;
    },
    async submit(request) {
      const prompt = [
        request.prompt,
        request.negativePrompt?.trim()
          ? `Exclude: ${request.negativePrompt.trim()}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      if (
        !prompt.trim() ||
        prompt.length > 32000 ||
        request.references.length > 16 ||
        !Number.isInteger(request.candidateCount) ||
        request.candidateCount < 1 ||
        request.candidateCount > 10
      ) {
        throw new ImageGenerationRequestError(
          "Invalid OpenAI image input",
          true,
        );
      }
      const params = request.extraParams ?? {};
      const quality =
        typeof params.quality === "string" ? params.quality : "auto";
      if (
        !["auto", "low", "medium", "high", "xhigh", "max"].includes(quality)
      ) {
        throw new ImageGenerationRequestError(
          "Unsupported OpenAI image quality",
          true,
        );
      }
      const body = {
        model: config.model,
        prompt,
        n: request.candidateCount,
        size: imageSize(request),
        quality,
        output_format: "png",
        ...(request.references.length
          ? { images: request.references.map((r) => ({ image_url: r.url })) }
          : {}),
      };
      const requestId = randomUUID();
      requests.set(requestId, {
        body,
        edit: request.references.length > 0,
        controller: new AbortController(),
        started: false,
      });
      return { requestId, sentPrompt: prompt };
    },
    async poll(requestId) {
      const state = requests.get(requestId);
      if (!state)
        return {
          status: "failed",
          permanent: true,
          errorMessage:
            "OpenAI image result cannot be recovered after restart; manually regenerate if needed",
        };
      if (state.result) return state.result;
      if (!state.started) {
        state.started = true;
        const endpoint = `${BASE}/${state.edit ? "edits" : "generations"}`;
        void (async () => {
          const handle = await logs?.start({
            type: LLM_LOG_TYPE.imageGenerate,
            provider: "openai",
            model: config.model,
            endpoint,
            requestJson: state.body,
            context,
          });
          try {
            const response = await fetchFn(endpoint, {
              method: "POST",
              headers: {
                authorization: `Bearer ${config.apiKey}`,
                "content-type": "application/json",
              },
              body: JSON.stringify(state.body),
              signal: AbortSignal.any([
                state.controller.signal,
                AbortSignal.timeout(600_000),
              ]),
            });
            if (!response.ok)
              throw new Error(
                `OpenAI image API failed (HTTP ${response.status}); automatic resubmission disabled`,
              );
            const json: unknown = await response.json();
            if (
              !isRecord(json) ||
              !Array.isArray(json.data) ||
              json.data.length !== state.body.n ||
              json.data.some(
                (x) =>
                  !isRecord(x) || typeof x.b64_json !== "string" || !x.b64_json,
              )
            ) {
              throw new Error("OpenAI returned an incomplete image result");
            }
            if (handle)
              await logs?.succeed(handle, {
                responseJson: {
                  ...json,
                  data: json.data.map(() => ({ image: "[binary omitted]" })),
                },
                providerRequestId: requestId,
                httpStatus: response.status,
              });
            state.result = {
              status: "completed",
              ...(imageCost(json.usage) !== undefined
                ? { costUsd: imageCost(json.usage) }
                : {}),
              images: json.data.map((x) => ({
                url: "",
                dataBase64: (x as { b64_json: string }).b64_json,
                contentType: "image/png",
              })),
            };
          } catch (error) {
            if (handle)
              await logs?.fail(handle, error, { providerRequestId: requestId });
            throw error;
          }
        })().catch((error) => {
          state.result = {
            status: "failed",
            permanent: true,
            errorMessage:
              error instanceof Error &&
              /^(OpenAI image API failed|OpenAI returned)/.test(error.message)
                ? error.message
                : "OpenAI image request interrupted; automatic resubmission disabled",
          };
        });
      }
      return {
        status: "pending",
        progress: { status: "running", phase: "generating" },
      };
    },
    async cancel(requestId) {
      requests.get(requestId)?.controller.abort();
    },
  };
}

function imageSize(request: ImageGenerationRequest): string {
  const params = request.extraParams ?? {};
  if (
    isRecord(params.image_size) &&
    typeof params.image_size.width === "number" &&
    typeof params.image_size.height === "number"
  ) {
    return checkedSize(params.image_size.width, params.image_size.height);
  }
  if (typeof params.size === "string" && params.size !== "auto") {
    const parts = /^(\d+)x(\d+)$/.exec(params.size);
    if (!parts)
      throw new ImageGenerationRequestError("Invalid OpenAI image size", true);
    return checkedSize(Number(parts[1]), Number(parts[2]));
  }
  if (params.size === "auto") return "auto";
  const ratio = requestedImageAspectRatio(params);
  if (!ratio) return "auto";
  const longEdge = Math.max(
    1280,
    Math.ceil(Math.sqrt(655360 * Math.max(ratio, 1 / ratio)) / 16) * 16,
  );
  const width =
    Math.round((ratio >= 1 ? longEdge : longEdge * ratio) / 16) * 16;
  const height =
    Math.round((ratio >= 1 ? longEdge / ratio : longEdge) / 16) * 16;
  return checkedSize(width, height);
}
function checkedSize(width: number, height: number): string {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width % 16 ||
    height % 16 ||
    Math.max(width, height) > 3840 ||
    Math.max(width / height, height / width) > 3 ||
    width * height < 655360 ||
    width * height > 8294400
  ) {
    throw new ImageGenerationRequestError(
      "OpenAI image size is outside supported limits",
      true,
    );
  }
  return `${width}x${height}`;
}

// Official Sunburst token rates; no mainline model is used by the Images API.
function imageCost(usage: unknown): number | undefined {
  if (!isRecord(usage) || !isRecord(usage.input_tokens_details))
    return undefined;
  const text = usage.input_tokens_details.text_tokens;
  const image = usage.input_tokens_details.image_tokens;
  const output = usage.output_tokens;
  if (
    ![text, image, output].every(
      (value) =>
        typeof value === "number" && Number.isFinite(value) && value >= 0,
    )
  )
    return undefined;
  return (
    ((text as number) * 5 + (image as number) * 8 + (output as number) * 30) /
    1_000_000
  );
}
