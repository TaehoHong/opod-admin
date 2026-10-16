import sharp from "sharp";
import { createSpicyApiImageProviders } from "./spicyapi-image.provider";
import { ImageGenerationRequest } from "./image-generation.provider";
import { LlmLogService } from "../../llm-logs/llm-log.service";
import {
  LlmLogRepository,
  type LlmLogFinishInput,
} from "../../llm-logs/llm-log.repository";

const config = { apiKey: "test-key", model: "alibaba/qwen-image-3.0-pro/edit" };
const seedream = {
  apiKey: "test-key",
  model: "bytedance/seedream-5.0-pro/edit",
};
const CREATE_URL = "https://api.spicyapi.ai/api/v1/jobs/createTask";

function reference(id: string) {
  return {
    id,
    role: "identity" as const,
    url: `https://media.example/${id}.png?X-Amz-Signature=private-signature`,
  };
}

function request(
  overrides: Partial<ImageGenerationRequest> = {},
): ImageGenerationRequest {
  return {
    idempotencyKey: "job-1-attempt-1",
    profile: "photoreal_identity_v1",
    prompt: "Image 1 woman by a window",
    references: [reference("face"), reference("body")],
    candidateCount: 1,
    extraParams: {
      aspect_ratio: "4:5",
      quality: "high",
      seed: 7,
      model: "wrong",
    },
    metadata: { generation_job_id: "job-1" },
    ...overrides,
  };
}

function accepted() {
  return Response.json(
    { code: 200, msg: "success", data: { taskId: "job_task_1" } },
    { status: 202 },
  );
}

function record(data: Record<string, unknown>) {
  return Response.json({
    code: 200,
    msg: "success",
    data: { taskId: "job_task_1", ...data },
    request_id: "req_1",
  });
}

function succeeded(cost = "0.045") {
  return record({
    state: "succeeded",
    cost,
    settled: true,
    output: {
      assets: [
        {
          key: "result",
          url: "https://r2.example/result.png?X-Amz-Signature=private-signature",
          mime: "image/png",
        },
      ],
    },
  });
}

function logs() {
  const created: unknown[] = [];
  const finished: LlmLogFinishInput[] = [];
  const service = new LlmLogService({
    create: async (value: unknown) => {
      created.push(value);
      return 1n;
    },
    finish: async (_id: bigint, value: LlmLogFinishInput) => {
      finished.push(value);
    },
    findRunning: async () => ({
      id: 1n,
      redactedPaths: [],
      createdAt: new Date(),
    }),
  } as unknown as LlmLogRepository);
  return { service, created, finished };
}

async function png(
  width: number,
  height: number,
  color: (row: number) => [number, number, number] = () => [0, 255, 0],
): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      pixels.set(color(row), (row * width + column) * 3);
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

function imageBytes(result: unknown): Buffer {
  const images = (result as { images: { dataBase64: string }[] }).images;
  return Buffer.from(images[0].dataBase64, "base64");
}

describe("SpicyAPI image provider", () => {
  it.each([
    ["edit", 2, "alibaba/qwen-image-3.0-pro/edit"],
    ["t2i", 0, "alibaba/qwen-image-3.0-pro/text-to-image"],
  ] as const)(
    "submits the %s route with ordered references, the nearest supported ratio and only allowed parameters",
    async (route, referenceCount, model) => {
      const fetchFn = jest.fn().mockResolvedValue(accepted());
      const provider = createSpicyApiImageProviders(config, fetchFn)[route];
      const references = [reference("face"), reference("body")].slice(
        0,
        referenceCount,
      );

      await expect(provider.submit(request({ references }))).resolves.toEqual({
        requestId: "job_task_1",
        sentPrompt: "Image 1 woman by a window",
      });

      expect(provider.name).toBe(`spicyapi:${model}`);
      const [url, init] = fetchFn.mock.calls[0];
      expect(url).toBe(CREATE_URL);
      expect(init.headers).toEqual({
        authorization: "Bearer test-key",
        "content-type": "application/json",
        "idempotency-key": "job-1-attempt-1",
      });
      expect(JSON.parse(init.body)).toEqual({
        model,
        input: {
          prompt: "Image 1 woman by a window",
          ...(referenceCount
            ? { image_urls: references.map((value) => value.url) }
            : {}),
          aspect_ratio: "3:4",
          resolution: "1k",
          num_outputs: 1,
          enable_prompt_expansion: false,
          seed: 7,
        },
      });
    },
  );

  it.each([
    ["edit", 2, "bytedance/seedream-5.0-pro/edit"],
    ["t2i", 0, "bytedance/seedream-5.0-pro/text-to-image"],
  ] as const)(
    "submits the Seedream %s route with 4:5 directly and only its schema fields",
    async (route, referenceCount, model) => {
      const fetchFn = jest.fn().mockResolvedValue(accepted());
      const provider = createSpicyApiImageProviders(seedream, fetchFn)[route];
      const references = [reference("face"), reference("body")].slice(
        0,
        referenceCount,
      );

      await provider.submit(
        request({
          references,
          extraParams: { ...request().extraParams, resolution: "2k" },
        }),
      );

      expect(provider.name).toBe(`spicyapi:${model}`);
      // seed·후보 수·프롬프트 확장은 Seedream schema에 없다.
      expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({
        model,
        input: {
          prompt: "Image 1 woman by a window",
          ...(referenceCount
            ? { image_urls: references.map((value) => value.url) }
            : {}),
          aspect_ratio: "4:5",
          resolution: "2k",
          enable_thinking: false,
        },
      });
    },
  );

  it("sends up to ten Seedream references and rejects an eleventh or a negative prompt before any paid call", async () => {
    const fetchFn = jest.fn().mockResolvedValue(accepted());
    const provider = createSpicyApiImageProviders(seedream, fetchFn).edit;
    const ten = Array.from({ length: 10 }, (_, index) =>
      reference(`r${index}`),
    );

    await provider.submit(request({ references: ten }));
    expect(
      JSON.parse(fetchFn.mock.calls[0][1].body).input.image_urls,
    ).toHaveLength(10);

    fetchFn.mockClear();
    await expect(
      provider.submit(request({ references: [...ten, reference("r10")] })),
    ).rejects.toMatchObject({
      name: "ImageGenerationRequestError",
      permanent: true,
    });
    await expect(
      provider.submit(request({ negativePrompt: "blurry" })),
    ).rejects.toMatchObject({
      name: "ImageGenerationRequestError",
      permanent: true,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ["two candidates", { candidateCount: 2 }],
    ["four references", { references: ["a", "b", "c", "d"].map(reference) }],
    ["a prompt over 5,000 characters", { prompt: "x".repeat(5_001) }],
    [
      "a non-HTTPS reference",
      {
        references: [{ ...reference("a"), url: "http://media.example/a.png" }],
      },
    ],
    [
      "an unsupported resolution",
      { extraParams: { aspect_ratio: "4:5", resolution: "4k" } },
    ],
  ])("rejects %s before any paid call", async (_name, overrides) => {
    const fetchFn = jest.fn();
    const provider = createSpicyApiImageProviders(config, fetchFn).edit;

    await expect(provider.submit(request(overrides))).rejects.toMatchObject({
      name: "ImageGenerationRequestError",
      permanent: true,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ["accepted", [accepted()]],
    [
      "still in flight (409) and then accepted",
      [
        Response.json({ code: 409, msg: "retry shortly" }, { status: 409 }),
        accepted(),
      ],
    ],
  ])(
    "resends a lost createTask response with the same idempotency key when the retry is %s",
    async (_name, responses) => {
      const fetchFn = jest
        .fn()
        .mockRejectedValueOnce(new TypeError("fetch failed"));
      for (const response of responses) fetchFn.mockResolvedValueOnce(response);
      const provider = createSpicyApiImageProviders(
        config,
        fetchFn,
        undefined,
        {
          retryDelayMs: 0,
        },
      ).edit;

      await expect(provider.submit(request())).resolves.toMatchObject({
        requestId: "job_task_1",
      });
      expect(fetchFn).toHaveBeenCalledTimes(responses.length + 1);
      for (const [url, init] of fetchFn.mock.calls) {
        expect(url).toBe(CREATE_URL);
        expect(init.headers["idempotency-key"]).toBe("job-1-attempt-1");
        expect(init.body).toBe(fetchFn.mock.calls[0][1].body);
      }
    },
  );

  it.each([
    [400, true],
    [402, true],
    [429, false],
    [503, false],
  ])(
    "maps a createTask HTTP %s to permanent=%s without retrying",
    async (status, permanent) => {
      const fetchFn = jest
        .fn()
        .mockResolvedValue(
          Response.json({ code: status, msg: "rejected" }, { status }),
        );
      const provider = createSpicyApiImageProviders(config, fetchFn).edit;

      await expect(provider.submit(request())).rejects.toMatchObject({
        permanent,
      });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["queued", "preparing"],
    ["running", "generating"],
  ])(
    "reports a %s task as running so the worker keeps polling the same task",
    async (state, phase) => {
      const fetchFn = jest.fn().mockResolvedValue(record({ state }));
      const provider = createSpicyApiImageProviders(config, fetchFn).edit;

      await expect(
        provider.poll("job_task_1", { outputAspectRatio: 0.8 }),
      ).resolves.toEqual({
        status: "pending",
        progress: { status: "running", phase },
      });
      expect(fetchFn).toHaveBeenCalledWith(
        "https://api.spicyapi.ai/api/v1/jobs/recordInfo?taskId=job_task_1",
        expect.objectContaining({
          headers: { authorization: "Bearer test-key" },
        }),
      );
    },
  );

  it.each([
    ["failed", "content_rejected"],
    ["expired", "timeout"],
  ])(
    "ends a %s task permanently with %s in the log and never resubmits",
    async (state, errorCode) => {
      const { service, created, finished } = logs();
      const fetchFn = jest
        .fn()
        .mockResolvedValueOnce(accepted())
        .mockResolvedValueOnce(
          record({ state, errorCode, errorMessage: "declined", cost: "0" }),
        );
      const provider = createSpicyApiImageProviders(
        config,
        fetchFn,
        service,
      ).edit;
      provider.setLogContext?.({ generationJobId: "job-1" });

      const { requestId } = await provider.submit(request());
      await expect(
        provider.poll(requestId, { outputAspectRatio: 0.8 }),
      ).resolves.toMatchObject({
        status: "failed",
        permanent: true,
        errorMessage: expect.stringContaining(errorCode),
      });

      expect(finished).toContainEqual(
        expect.objectContaining({
          status: "failed",
          providerRequestId: "job_task_1",
          errorMessage: expect.stringContaining(errorCode),
        }),
      );
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(JSON.stringify([created, finished])).not.toMatch(
        /test-key|private-signature/,
      );
    },
  );

  it("keeps the same task after a transient lookup error and ends a missing task permanently", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(
        Response.json({ code: 503, msg: "busy" }, { status: 503 }),
      )
      .mockResolvedValueOnce(
        Response.json({ code: 404, msg: "not found" }, { status: 404 }),
      );
    const provider = createSpicyApiImageProviders(config, fetchFn).edit;

    await expect(provider.poll("job_task_1")).rejects.toThrow("HTTP 503");
    await expect(provider.poll("job_task_1")).resolves.toMatchObject({
      status: "failed",
      permanent: true,
    });
  });

  it("center-crops a resumed 3:4 result to the requested 4:5 and logs both sizes", async () => {
    // 300x400 → 300x375: 위 12줄(빨강)과 아래 13줄(파랑)만 잘려야 한다.
    const source = await png(300, 400, (row) =>
      row < 12 ? [255, 0, 0] : row >= 387 ? [0, 0, 255] : [0, 255, 0],
    );
    const { service, finished } = logs();
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(succeeded())
      .mockResolvedValueOnce(new Response(new Uint8Array(source)));
    // 새 인스턴스 = 워커 재시작 뒤 저장된 taskId로 이어받는 경우.
    const provider = createSpicyApiImageProviders(
      config,
      fetchFn,
      service,
    ).edit;
    provider.setLogContext?.({ generationJobId: "job-1" });

    const result = await provider.poll("job_task_1", {
      outputAspectRatio: 0.8,
    });

    expect(result).toMatchObject({ status: "completed", costUsd: 0.045 });
    const cropped = sharp(imageBytes(result));
    expect(await cropped.metadata()).toMatchObject({
      format: "png",
      width: 300,
      height: 375,
    });
    const { channels } = await cropped.stats();
    expect(channels.map(({ min, max }) => [min, max])).toEqual([
      [0, 0],
      [255, 255],
      [0, 0],
    ]);
    // 결과 다운로드에는 API 키를 붙이지 않는다.
    expect(fetchFn.mock.calls[1][1].headers).toBeUndefined();
    expect(finished).toContainEqual(
      expect.objectContaining({
        status: "succeeded",
        responseJson: expect.objectContaining({
          opodPostprocess: {
            images: [
              {
                source: { width: 300, height: 400 },
                output: { width: 300, height: 375 },
                providerAspectRatio: "3:4",
                cropped: true,
              },
            ],
          },
        }),
      }),
    );
    expect(JSON.stringify(finished)).not.toContain("private-signature");
  });

  it("returns an exact-ratio result unchanged", async () => {
    const source = await png(360, 640);
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(succeeded())
      .mockResolvedValueOnce(new Response(new Uint8Array(source)));
    const provider = createSpicyApiImageProviders(config, fetchFn).edit;

    const result = await provider.poll("job_task_1", {
      outputAspectRatio: 9 / 16,
    });

    expect(imageBytes(result).equals(source)).toBe(true);
  });

  it("keeps a Seedream 4:5 result unchanged because Seedream generates 4:5 directly", async () => {
    const source = await png(400, 500);
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(succeeded())
      .mockResolvedValueOnce(new Response(new Uint8Array(source)));
    const provider = createSpicyApiImageProviders(seedream, fetchFn).edit;

    const result = await provider.poll("job_task_1", {
      outputAspectRatio: 0.8,
    });

    expect(imageBytes(result).equals(source)).toBe(true);
  });

  it("fails a result outside the requested ratio family instead of cropping it", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(succeeded())
      .mockResolvedValueOnce(new Response(new Uint8Array(await png(400, 300))));
    const provider = createSpicyApiImageProviders(config, fetchFn).edit;

    await expect(
      provider.poll("job_task_1", { outputAspectRatio: 0.8 }),
    ).resolves.toMatchObject({
      status: "failed",
      permanent: true,
      errorMessage: expect.stringContaining("generated_image_invalid"),
    });
  });

  it.each([
    { apiKey: "", model: config.model },
    { apiKey: "test-key", model: "alibaba/qwen-image-2.1/edit" },
  ])("refuses a missing key or unsupported model: %j", (value) => {
    expect(() => createSpicyApiImageProviders(value, jest.fn())).toThrow(
      "SpicyAPI configuration is missing or unsupported",
    );
  });
});
