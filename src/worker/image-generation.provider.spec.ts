import {
  createFalImageGenerationProvider,
  createImageGenerationProviders,
  createOpodFluxImageGenerationProvider,
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

function sseResponse(...events: string[]): Response {
  return new Response(`${events.join("\n\n")}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function baseRequest(
  overrides: Partial<ImageGenerationRequest> = {},
): ImageGenerationRequest {
  return {
    idempotencyKey: "job-0001",
    profile: "photoreal_scene_v1",
    prompt: "film photo of a beach",
    references: [],
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
        references: [
          {
            id: "ref-1",
            role: "identity",
            primary: true,
            url: "https://cdn.local/ref.png",
          },
        ],
        extraParams: { aspect_ratio: "4:5" },
      }),
    );

    // 전송본(네거티브가 합쳐진 최종 문자열)을 그대로 돌려줘야 잡에 기록된다.
    expect(submitted).toEqual({
      requestId: "req-1",
      sentPrompt: "film photo of a beach Do not include: blurry.",
    });
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

    await expect(provider.submit(baseRequest())).resolves.toMatchObject({
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
        references: [
          {
            id: "ref-1",
            role: "identity",
            primary: true,
            url: "https://cdn.local/ref.png",
          },
        ],
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

describe("createOpodFluxImageGenerationProvider", () => {
  const config = {
    apiBaseUrl: "https://opod-flux.internal/v1",
    apiKey: "flux-secret",
  };

  it("submits the approved v1 request with caller auth and idempotency", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue(
        sseResponse(
          'id: 1\nevent: connected\ndata: {"request_id":"req-1","status":"connecting"}',
          'id: 2\nevent: accepted\ndata: {"generation_id":"gen-1","status":"queued","replayed":false}',
          'id: 3\nevent: complete\ndata: {"generation_id":"gen-1","status":"succeeded","outputs":[{"id":"out-0","index":0,"content_type":"image/jpeg","width":1365,"height":2048,"sha256":"abcd","download_url":"https://opod-flux.internal/v1/generations/gen-1/outputs/out-0"}],"images_sent":1}',
        ),
      );
    const provider = createOpodFluxImageGenerationProvider(config, fetchFn);

    await expect(
      provider.submit({
        idempotencyKey: "generation-job-1",
        profile: "photoreal_identity_v1",
        prompt: "film photo of a beach",
        negativePrompt: "blurry",
        references: [
          {
            id: "face-front",
            role: "identity",
            primary: true,
            url: "https://cdn.local/ref.png",
          },
        ],
        candidateCount: 2,
        extraParams: {
          aspect_ratio: "4:5",
          long_edge: 2048,
          format: "jpeg",
          quality: 95,
          seed: 1729,
        },
        metadata: { character_id: "character-1" },
      }),
    ).resolves.toEqual({
      requestId: "gen-1",
      sentPrompt: "film photo of a beach",
    });

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://opod-flux.internal/v1/generations/stream");
    expect(init.headers).toMatchObject({
      authorization: "Bearer flux-secret",
      accept: "text/event-stream",
      "content-type": "application/json",
      "idempotency-key": "generation-job-1",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      profile: "photoreal_identity_v1",
      prompt: "film photo of a beach",
      negative_prompt: "blurry",
      references: [
        {
          id: "face-front",
          role: "identity",
          primary: true,
          source: { type: "url", url: "https://cdn.local/ref.png" },
        },
      ],
      output: {
        count: 2,
        aspect_ratio: "4:5",
        long_edge: 2048,
        format: "jpeg",
        quality: 95,
      },
      controls: { seed: 1729, identity_strict: true },
      webhook_id: null,
      metadata: { character_id: "character-1" },
    });
    await expect(provider.poll("gen-1")).resolves.toEqual({
      status: "completed",
      images: [
        {
          url: "https://opod-flux.internal/v1/generations/gen-1/outputs/out-0",
          contentType: "image/jpeg",
          width: 1365,
          height: 2048,
          sha256: "abcd",
          downloadHeaders: { authorization: "Bearer flux-secret" },
        },
      ],
    });
  });

  it("sends explicit scene defaults and validates the public request contract", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue(
        sseResponse(
          'event: accepted\ndata: {"generation_id":"gen-scene","status":"queued"}',
          'event: complete\ndata: {"generation_id":"gen-scene","status":"succeeded","outputs":[{"download_url":"https://opod-flux.internal/v1/generations/gen-scene/outputs/out-0"}],"images_sent":1}',
        ),
      );
    const provider = createOpodFluxImageGenerationProvider(config, fetchFn);

    await provider.submit(
      baseRequest({ extraParams: { aspect_ratio: "16:9" } }),
    );

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      profile: "photoreal_scene_v1",
      prompt: "film photo of a beach",
      negative_prompt: null,
      references: [],
      output: {
        count: 2,
        aspect_ratio: "16:9",
        long_edge: 2048,
        format: "jpeg",
        quality: 95,
      },
      controls: { seed: null },
      webhook_id: null,
      metadata: {},
    });

    await expect(
      provider.submit(
        baseRequest({
          profile: "photoreal_identity_v1",
          references: [],
          extraParams: { aspect_ratio: "4:5" },
        }),
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining("1 to 3 identity references"),
      permanent: true,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["short idempotency key", { idempotencyKey: "short" }],
    ["empty prompt", { prompt: "" }],
    ["long negative prompt", { negativePrompt: "x".repeat(2_001) }],
    ["candidate count", { candidateCount: 5 }],
    ["aspect ratio", { extraParams: { aspect_ratio: "7:8" } }],
    ["long edge", { extraParams: { aspect_ratio: "4:5", long_edge: 500 } }],
    ["format", { extraParams: { aspect_ratio: "4:5", format: "gif" } }],
    ["quality", { extraParams: { aspect_ratio: "4:5", quality: 69 } }],
    ["seed", { extraParams: { aspect_ratio: "4:5", seed: -1 } }],
    [
      "scene identity reference",
      {
        references: [
          {
            id: "identity-front",
            role: "identity" as const,
            primary: true,
            url: "https://cdn.local/reference.jpg",
          },
        ],
      },
    ],
  ])("rejects an invalid %s before fetch", async (_label, overrides) => {
    const fetchFn = jest.fn();
    const provider = createOpodFluxImageGenerationProvider(config, fetchFn);

    await expect(
      provider.submit(
        baseRequest({
          extraParams: { aspect_ratio: "4:5" },
          ...(overrides as Partial<ImageGenerationRequest>),
        }),
      ),
    ).rejects.toMatchObject({ permanent: true });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("returns after accepted, then consumes chunked image and complete events", async () => {
    const encoder = new TextEncoder();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        controller.enqueue(encoder.encode(": keep-alive\n\n"));
        controller.enqueue(
          encoder.encode(
            'event: accepted\ndata: {"generation_id":"gen-chunk","status":"queued",',
          ),
        );
        controller.enqueue(encoder.encode('"replayed":false}\n\n'));
      },
    });
    const fetchFn = jest.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const provider = createOpodFluxImageGenerationProvider(config, fetchFn);

    await expect(
      provider.submit(baseRequest({ extraParams: { aspect_ratio: "4:5" } })),
    ).resolves.toMatchObject({ requestId: "gen-chunk" });
    await expect(provider.poll("gen-chunk")).resolves.toEqual({
      status: "pending",
      progress: { status: "queued" },
    });

    streamController.enqueue(
      encoder.encode(
        'event: image\ndata: {"generation_id":"gen-chunk","output":{"id":"out-0","index":0,"content_type":"image/jpeg","sha256":"abcd","download_url":"https://opod-flux.internal/v1/generations/gen-chunk/outputs/out-0"},"data_base64":"aW1hZ2U="}\n\n',
      ),
    );
    streamController.enqueue(
      encoder.encode(
        'event: complete\ndata: {"generation_id":"gen-chunk","status":"succeeded","outputs":[],"images_sent":1}\n\n',
      ),
    );
    streamController.close();
    await new Promise((resolve) => setImmediate(resolve));

    await expect(provider.poll("gen-chunk")).resolves.toEqual({
      status: "completed",
      images: [
        {
          url: "https://opod-flux.internal/v1/generations/gen-chunk/outputs/out-0",
          contentType: "image/jpeg",
          sha256: "abcd",
          dataBase64: "aW1hZ2U=",
          downloadHeaders: { authorization: "Bearer flux-secret" },
        },
      ],
    });
  });

  it("publishes the latest accepted and progress events to a subscriber", async () => {
    const encoder = new TextEncoder();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        controller.enqueue(
          encoder.encode(
            'event: accepted\ndata: {"generation_id":"gen-progress","status":"queued"}\n\n',
          ),
        );
      },
    });
    const fetchFn = jest.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const provider = createOpodFluxImageGenerationProvider(config, fetchFn);

    await provider.submit(
      baseRequest({ extraParams: { aspect_ratio: "4:5" } }),
    );
    const progressEvents: unknown[] = [];
    const subscribeProgress = (
      provider as unknown as {
        subscribeProgress?: (
          requestId: string,
          listener: (progress: unknown) => void,
        ) => () => void;
      }
    ).subscribeProgress;
    expect(subscribeProgress).toBeDefined();
    const unsubscribe = subscribeProgress?.("gen-progress", (progress) =>
      progressEvents.push(progress),
    );

    streamController.enqueue(
      encoder.encode(
        'event: progress\ndata: {"generation_id":"gen-progress","status":"running","phase":"generating","stage":"face","progress":0.58,"updated_at":"2026-08-20T10:00:20Z"}\n\n',
      ),
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(progressEvents).toEqual([
      { status: "queued" },
      {
        status: "running",
        phase: "generating",
        stage: "face",
        progress: 0.58,
        updatedAt: "2026-08-20T10:00:20Z",
      },
    ]);
    unsubscribe?.();
    streamController.close();
  });

  it("omits Authorization when the Tailnet deployment has authentication disabled", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue(
        sseResponse(
          'event: accepted\ndata: {"generation_id":"gen-open","status":"queued"}',
          'event: complete\ndata: {"generation_id":"gen-open","status":"succeeded","outputs":[{"id":"out-0","index":0,"content_type":"image/jpeg","download_url":"https://opod-flux.internal/v1/generations/gen-open/outputs/out-0"}],"images_sent":1}',
        ),
      );
    const provider = createOpodFluxImageGenerationProvider(
      { ...config, apiKey: "" },
      fetchFn,
    );

    await provider.submit(
      baseRequest({ extraParams: { aspect_ratio: "4:5" } }),
    );

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("authorization");
    await expect(provider.poll("gen-open")).resolves.toEqual({
      status: "completed",
      images: [
        {
          url: "https://opod-flux.internal/v1/generations/gen-open/outputs/out-0",
          contentType: "image/jpeg",
        },
      ],
    });
  });

  it("falls back to durable status polling when the stream ends after accepted", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(
        sseResponse(
          'event: accepted\ndata: {"generation_id":"gen-resume","status":"running"}',
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          generation_id: "gen-resume",
          status: "succeeded",
          outputs: [
            {
              id: "out-0",
              index: 0,
              content_type: "image/jpeg",
              download_url:
                "https://opod-flux.internal/v1/generations/gen-resume/outputs/out-0",
            },
          ],
        }),
      );
    const provider = createOpodFluxImageGenerationProvider(config, fetchFn);

    await provider.submit(
      baseRequest({ extraParams: { aspect_ratio: "4:5" } }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    await expect(provider.poll("gen-resume")).resolves.toMatchObject({
      status: "completed",
    });
    expect(fetchFn.mock.calls[1][0]).toBe(
      "https://opod-flux.internal/v1/generations/gen-resume",
    );
  });

  it("closes a malformed accepted stream before falling back to status polling", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(
        sseResponse(
          'event: accepted\ndata: {"generation_id":"gen-malformed","status":"running"}',
          'event: progress\ndata: {"generation_id":"gen-malformed","status":"succeeded"}',
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          generation_id: "gen-malformed",
          status: "running",
          phase: "generating",
          progress: 0.25,
        }),
      );
    const provider = createOpodFluxImageGenerationProvider(config, fetchFn);

    await provider.submit(
      baseRequest({ extraParams: { aspect_ratio: "4:5" } }),
    );
    await new Promise((resolve) => setImmediate(resolve));

    const [, streamRequest] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect((streamRequest.signal as AbortSignal).aborted).toBe(true);
    await expect(provider.poll("gen-malformed")).resolves.toEqual({
      status: "pending",
      progress: {
        status: "running",
        phase: "generating",
        progress: 0.25,
      },
    });
  });

  it("maps an SSE error event to a terminal admin job failure", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue(
        sseResponse(
          'event: accepted\ndata: {"generation_id":"gen-failed","status":"running"}',
          'event: error\ndata: {"generation_id":"gen-failed","error":{"code":"IDENTITY_THRESHOLD_NOT_MET","message":"identity check failed","retryable":true}}',
        ),
      );
    const provider = createOpodFluxImageGenerationProvider(config, fetchFn);

    await provider.submit(
      baseRequest({ extraParams: { aspect_ratio: "4:5" } }),
    );

    await expect(provider.poll("gen-failed")).resolves.toEqual({
      status: "failed",
      errorMessage: "IDENTITY_THRESHOLD_NOT_MET: identity check failed",
      permanent: true,
    });
  });

  it("surfaces a registration error event before accepted", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue(
        sseResponse(
          'event: connected\ndata: {"request_id":"req-1","status":"connecting"}',
          'event: error\ndata: {"request_id":"req-1","error":{"code":"QUEUE_FULL","message":"try later","retryable":true}}',
        ),
      );
    const provider = createOpodFluxImageGenerationProvider(config, fetchFn);

    await expect(
      provider.submit(baseRequest({ extraParams: { aspect_ratio: "4:5" } })),
    ).rejects.toMatchObject({
      message: "QUEUE_FULL: try later",
      permanent: true,
    });
  });

  it("maps a cancelled event to a terminal admin job failure", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue(
        sseResponse(
          'event: accepted\ndata: {"generation_id":"gen-cancelled","status":"running"}',
          'event: cancelled\ndata: {"generation_id":"gen-cancelled","status":"cancelled","progress":0.4}',
        ),
      );
    const provider = createOpodFluxImageGenerationProvider(config, fetchFn);

    await provider.submit(
      baseRequest({ extraParams: { aspect_ratio: "4:5" } }),
    );

    await expect(provider.poll("gen-cancelled")).resolves.toEqual({
      status: "failed",
      errorMessage: "GENERATION_CANCELLED: opod-flux generation cancelled",
      permanent: true,
    });
  });

  it("marks semantic create failures as permanent without consuming a job", async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "identity primary is required",
          },
        },
        422,
      ),
    );
    const provider = createOpodFluxImageGenerationProvider(config, fetchFn);

    await expect(
      provider.submit({
        ...baseRequest({
          profile: "photoreal_identity_v1",
          extraParams: { aspect_ratio: "4:5" },
        }),
        references: [
          {
            id: "identity-front",
            role: "identity",
            primary: true,
            url: "https://cdn.local/reference.jpg",
          },
        ],
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("VALIDATION_FAILED"),
      permanent: true,
    });
  });

  it("maps status and authenticated output downloads", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "running" }))
      .mockResolvedValueOnce(
        jsonResponse({
          generation_id: "gen-1",
          status: "succeeded",
          outputs: [
            {
              id: "out-0",
              index: 0,
              content_type: "image/jpeg",
              width: 1365,
              height: 2048,
              sha256: "abcd",
              download_url:
                "https://opod-flux.internal/v1/generations/gen-1/outputs/out-0",
            },
          ],
        }),
      );
    const provider = createOpodFluxImageGenerationProvider(config, fetchFn);

    await expect(provider.poll("gen-1")).resolves.toEqual({
      status: "pending",
      progress: { status: "running" },
    });
    await expect(provider.poll("gen-1")).resolves.toEqual({
      status: "completed",
      images: [
        {
          url: "https://opod-flux.internal/v1/generations/gen-1/outputs/out-0",
          contentType: "image/jpeg",
          width: 1365,
          height: 2048,
          sha256: "abcd",
          downloadHeaders: { authorization: "Bearer flux-secret" },
        },
      ],
    });
  });

  it("treats a succeeded response without outputs as a permanent protocol failure", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue(jsonResponse({ status: "succeeded", outputs: [] }));
    const provider = createOpodFluxImageGenerationProvider(config, fetchFn);

    await expect(provider.poll("gen-1")).resolves.toEqual({
      status: "failed",
      errorMessage: "opod-flux result contained no outputs",
      permanent: true,
    });
  });

  it("rejects output URLs that would send the API key to another origin", async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse({
        status: "succeeded",
        outputs: [
          {
            download_url: "https://attacker.example/collect",
          },
        ],
      }),
    );
    const provider = createOpodFluxImageGenerationProvider(config, fetchFn);

    await expect(provider.poll("gen-1")).resolves.toEqual({
      status: "failed",
      errorMessage: "opod-flux result contained no outputs",
      permanent: true,
    });
  });

  it("maps terminal retryability and sends best-effort cancellation", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          status: "failed",
          error: {
            code: "IDENTITY_THRESHOLD_NOT_MET",
            message: "identity check failed",
            retryable: false,
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: "cancelling" }, 202));
    const provider = createOpodFluxImageGenerationProvider(config, fetchFn);

    await expect(provider.poll("gen-1")).resolves.toEqual({
      status: "failed",
      errorMessage: "IDENTITY_THRESHOLD_NOT_MET: identity check failed",
      permanent: true,
    });
    await expect(provider.cancel?.("gen-1")).resolves.toBeUndefined();
    expect(fetchFn.mock.calls[1][0]).toBe(
      "https://opod-flux.internal/v1/generations/gen-1/cancel",
    );
    expect((fetchFn.mock.calls[1][1] as RequestInit).method).toBe("POST");
  });

  it("keeps transient status HTTP failures on the same generation id", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "BUSY" } }, 503));
    const provider = createOpodFluxImageGenerationProvider(config, fetchFn);

    await expect(provider.poll("gen-1")).rejects.toThrow("opod-flux 503 BUSY");
  });

  it("ends the current admin job for a retryable terminal generation", async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse({
        status: "failed",
        error: {
          code: "IDENTITY_THRESHOLD_NOT_MET",
          message: "try a new generation",
          retryable: true,
        },
      }),
    );
    const provider = createOpodFluxImageGenerationProvider(config, fetchFn);

    // opod-flux의 retryable은 "새 idempotency key로 새 generation 생성 가능"이다.
    // 같은 admin job id 재제출은 기존 실패를 replay하므로 현재 job은 끝낸다.
    await expect(provider.poll("gen-1")).resolves.toEqual({
      status: "failed",
      errorMessage: "IDENTITY_THRESHOLD_NOT_MET: try a new generation",
      permanent: true,
    });
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
