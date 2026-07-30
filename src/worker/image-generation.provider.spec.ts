import {
  createFalImageGenerationProvider,
  createImageGenerationProviders,
  falQueueUrls,
  falSupportsNegativePrompt,
  ImageGenerationConfigError,
  ImageGenerationRequest,
} from "./image-generation.provider";
import { LlmLogService } from "../domain/llm-logs/llm-log.service";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function baseRequest(
  overrides: Partial<ImageGenerationRequest> = {},
): ImageGenerationRequest {
  return {
    prompt: "film photo of a beach",
    referenceImageUrls: [],
    candidateCount: 2,
    ...overrides,
  };
}

describe("falQueueUrls", () => {
  it("submits to the full model path but polls the appId root", () => {
    // fal 규칙: 서브패스는 제출에만 쓰고 status/result 조회에는 쓰지 않는다.
    const urls = falQueueUrls("fal-ai/nano-banana/edit");
    expect(urls.submitUrl).toBe(
      "https://queue.fal.run/fal-ai/nano-banana/edit",
    );
    expect(urls.requestUrl("req-1", "/status")).toBe(
      "https://queue.fal.run/fal-ai/nano-banana/requests/req-1/status",
    );
    expect(urls.requestUrl("req-1")).toBe(
      "https://queue.fal.run/fal-ai/nano-banana/requests/req-1",
    );
  });

  it("keeps deep subpaths out of the request URLs", () => {
    const urls = falQueueUrls("fal-ai/bytedance/seedream/v4/edit");
    expect(urls.submitUrl).toBe(
      "https://queue.fal.run/fal-ai/bytedance/seedream/v4/edit",
    );
    expect(urls.requestUrl("req-9", "/cancel")).toBe(
      "https://queue.fal.run/fal-ai/bytedance/requests/req-9/cancel",
    );
  });

  it("is a no-op for two-segment model ids", () => {
    const urls = falQueueUrls("fal-ai/fast-sdxl");
    expect(urls.submitUrl).toBe("https://queue.fal.run/fal-ai/fast-sdxl");
    expect(urls.requestUrl("req-2", "/status")).toBe(
      "https://queue.fal.run/fal-ai/fast-sdxl/requests/req-2/status",
    );
  });
});

describe("falSupportsNegativePrompt", () => {
  it("allows only SD-family models", () => {
    expect(falSupportsNegativePrompt("fal-ai/fast-sdxl")).toBe(true);
    expect(falSupportsNegativePrompt("fal-ai/stable-diffusion-v35-large")).toBe(
      true,
    );
    expect(falSupportsNegativePrompt("fal-ai/nano-banana/edit")).toBe(false);
    expect(falSupportsNegativePrompt("fal-ai/bytedance/seedream/v4/edit")).toBe(
      false,
    );
    expect(falSupportsNegativePrompt("fal-ai/flux/dev")).toBe(false);
  });
});

describe("createFalImageGenerationProvider", () => {
  const config = { apiKey: "secret", model: "fal-ai/nano-banana/edit" };

  it("submits prompt, candidates, and references with auth", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue(jsonResponse({ request_id: "req-1" }));
    const provider = createFalImageGenerationProvider(config, fetchFn);

    const submitted = await provider.submit(
      baseRequest({
        negativePrompt: "blurry",
        referenceImageUrls: ["https://cdn.local/ref.png"],
        extraParams: { aspect_ratio: "4:5" },
      }),
    );

    expect(submitted).toEqual({ requestId: "req-1" });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://queue.fal.run/fal-ai/nano-banana/edit");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Key secret",
    );
    // nano-banana는 negative_prompt를 받지 않아 prompt 본문에 합친다.
    expect(JSON.parse(init.body as string)).toEqual({
      prompt: "film photo of a beach Do not include: blurry.",
      num_images: 2,
      image_urls: ["https://cdn.local/ref.png"],
      aspect_ratio: "4:5",
    });
  });

  it("keeps submit and polling in one LLM log row", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ request_id: "req-1" }))
      .mockResolvedValueOnce(jsonResponse({ status: "IN_QUEUE" }))
      .mockResolvedValueOnce(jsonResponse({ status: "COMPLETED" }))
      .mockResolvedValueOnce(
        jsonResponse({ images: [{ url: "https://cdn.fal/a.png" }] }),
      );
    const handle = { id: 1n, redactedPaths: [], startedAt: Date.now() };
    const llmLogs = {
      start: jest.fn().mockResolvedValue(handle),
      setProviderRequestId: jest.fn().mockResolvedValue(undefined),
      findRunning: jest.fn(),
      succeed: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
    } as unknown as LlmLogService;
    const provider = createFalImageGenerationProvider(config, fetchFn, llmLogs);
    provider.setLogContext?.({
      requestId: "job-1",
      characterId: "character-1",
      generationJobId: "job-1",
      inputMediaIds: ["media-1"],
    });

    await expect(provider.submit(baseRequest())).resolves.toEqual({
      requestId: "req-1",
    });
    await expect(provider.poll("req-1")).resolves.toEqual({
      status: "pending",
    });
    await expect(provider.poll("req-1")).resolves.toMatchObject({
      status: "completed",
    });

    expect(llmLogs.start).toHaveBeenCalledTimes(1);
    expect(llmLogs.succeed).toHaveBeenCalledTimes(1);
    expect(llmLogs.findRunning).not.toHaveBeenCalled();
  });

  it("passes negative_prompt for SD-family models and omits empty references", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue(jsonResponse({ request_id: "req-1" }));
    const provider = createFalImageGenerationProvider(
      { apiKey: "secret", model: "fal-ai/fast-sdxl" },
      fetchFn,
    );

    await provider.submit(baseRequest({ negativePrompt: "blurry" }));

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.negative_prompt).toBe("blurry");
    expect(body).not.toHaveProperty("image_urls");
  });

  it("does not let extraParams override reserved request fields", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue(jsonResponse({ request_id: "req-1" }));
    const provider = createFalImageGenerationProvider(config, fetchFn);

    await provider.submit(
      baseRequest({
        referenceImageUrls: ["https://cdn.local/ref.png"],
        extraParams: {
          prompt: "wrong prompt",
          image_urls: ["https://wrong.local/ref.png"],
          num_images: 4,
          negative_prompt: "wrong negative",
          aspect_ratio: "4:5",
        },
      }),
    );

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.prompt).toBe("film photo of a beach");
    expect(body.image_urls).toEqual(["https://cdn.local/ref.png"]);
    expect(body.num_images).toBe(2);
    expect(body).not.toHaveProperty("negative_prompt");
    expect(body.aspect_ratio).toBe("4:5");
  });

  it("polls status on the appId root and maps queue states", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "IN_QUEUE" }))
      .mockResolvedValueOnce(jsonResponse({ status: "IN_PROGRESS" }));
    const provider = createFalImageGenerationProvider(config, fetchFn);

    await expect(provider.poll("req-1")).resolves.toEqual({
      status: "pending",
    });
    await expect(provider.poll("req-1")).resolves.toEqual({
      status: "pending",
    });
    expect(fetchFn.mock.calls[0][0]).toBe(
      "https://queue.fal.run/fal-ai/nano-banana/requests/req-1/status",
    );
  });

  it("fetches the result once completed", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "COMPLETED" }))
      .mockResolvedValueOnce(
        jsonResponse({
          images: [
            {
              url: "https://cdn.fal/a.png",
              content_type: "image/png",
              width: 1024,
              height: 1280,
            },
            { url: "https://cdn.fal/b.png" },
          ],
        }),
      );
    const provider = createFalImageGenerationProvider(config, fetchFn);

    await expect(provider.poll("req-1")).resolves.toEqual({
      status: "completed",
      images: [
        {
          url: "https://cdn.fal/a.png",
          contentType: "image/png",
          width: 1024,
          height: 1280,
        },
        { url: "https://cdn.fal/b.png" },
      ],
    });
    expect(fetchFn.mock.calls[1][0]).toBe(
      "https://queue.fal.run/fal-ai/nano-banana/requests/req-1",
    );
  });

  it("marks a 422 result as a permanent provider failure", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "COMPLETED" }))
      .mockResolvedValueOnce(
        jsonResponse({ detail: "unsafe prompt rejected" }, 422),
      );
    const provider = createFalImageGenerationProvider(config, fetchFn);

    // 422 = 입력 검증 실패 — 같은 입력 재시도가 무의미하므로 permanent.
    await expect(provider.poll("req-1")).resolves.toEqual({
      status: "failed",
      errorMessage: expect.stringContaining("422"),
      permanent: true,
    });
  });

  it("keeps non-422 result failures retryable", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "COMPLETED" }))
      .mockResolvedValueOnce(jsonResponse({ detail: "internal" }, 500));
    const provider = createFalImageGenerationProvider(config, fetchFn);

    await expect(provider.poll("req-1")).resolves.toEqual({
      status: "failed",
      errorMessage: expect.stringContaining("500"),
    });
  });

  it("cancels via PUT on the appId root and swallows errors", async () => {
    const fetchFn = jest
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(jsonResponse({}, 202));
    const provider = createFalImageGenerationProvider(config, fetchFn);

    await expect(provider.cancel?.("req-1")).resolves.toBeUndefined();
    await expect(provider.cancel?.("req-1")).resolves.toBeUndefined();
    expect(fetchFn.mock.calls[1][0]).toBe(
      "https://queue.fal.run/fal-ai/nano-banana/requests/req-1/cancel",
    );
    expect((fetchFn.mock.calls[1][1] as RequestInit).method).toBe("PUT");
  });
});

describe("createImageGenerationProviders", () => {
  // 설정이 빠진 채로 성공하면 플레이스홀더 이미지가 completed 잡으로 검수
  // 큐에 들어간다. 환경 구분 없이 실패해야 한다.
  it("fails without an API key instead of returning a placeholder provider", () => {
    expect(() => createImageGenerationProviders({})).toThrow(
      ImageGenerationConfigError,
    );
  });

  it("fails when the API key is set but the image model is missing", () => {
    expect(() =>
      createImageGenerationProviders({ FAL_API_KEY: "secret" }),
    ).toThrow(ImageGenerationConfigError);
  });

  it("uses the edit model for both routes when t2i is not set", () => {
    const providers = createImageGenerationProviders({
      FAL_API_KEY: "secret",
      FAL_IMAGE_MODEL: "fal-ai/nano-banana/edit",
    });
    expect(providers.edit.name).toBe("fal:fal-ai/nano-banana/edit");
    expect(providers.t2i).toBe(providers.edit);
  });

  it("splits t2i and edit models when both are set", () => {
    const providers = createImageGenerationProviders({
      FAL_API_KEY: "secret",
      FAL_IMAGE_MODEL: "fal-ai/nano-banana/edit",
      FAL_IMAGE_T2I_MODEL: "fal-ai/nano-banana",
    });
    expect(providers.edit.name).toBe("fal:fal-ai/nano-banana/edit");
    expect(providers.t2i.name).toBe("fal:fal-ai/nano-banana");
  });
});
