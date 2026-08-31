import { LlmLogRepository, type LlmLogListRow } from "./llm-log.repository";
import { LlmLogService, redactLlmPayload } from "./llm-log.service";

// Drizzle를 흉내내지 않고 repository를 대신 세운다
// (docs/02-development-rules.md "Module and Repository Rules").
function serviceWith(repository: Partial<LlmLogRepository>): LlmLogService {
  return new LlmLogService(repository as LlmLogRepository);
}

describe("LlmLogService", () => {
  // 로그를 남기지 못하면 호출 자체를 하지 않는다 — 과금되는 provider 요청이
  // 기록 없이 나가는 것을 막는다.
  it("does not call the provider when the initial log insert fails", async () => {
    const execute = jest.fn();
    const service = serviceWith({
      create: jest.fn().mockRejectedValue(new Error("database unavailable")),
      finish: jest.fn(),
    });

    await expect(
      service.runJsonFetch({
        type: "admin.content.plan",
        provider: "openai-compatible",
        model: "model",
        endpoint: "https://llm.example/v1/chat/completions",
        requestJson: { model: "model", messages: [] },
        execute,
      }),
    ).rejects.toThrow("database unavailable");
    expect(execute).not.toHaveBeenCalled();
  });

  // 반대로 기록에 실패했다고 이미 받은 응답을 버리면 안 된다.
  it("returns the provider response when only the completion update fails", async () => {
    const service = serviceWith({
      create: jest.fn().mockResolvedValue(1n),
      finish: jest.fn().mockRejectedValue(new Error("database unavailable")),
    });

    await expect(
      service.runJsonFetch({
        type: "admin.content.plan",
        provider: "openai-compatible",
        model: "model",
        endpoint: "https://llm.example/v1/chat/completions",
        requestJson: { model: "model", messages: [] },
        execute: () =>
          Promise.resolve(
            Response.json({
              id: "req-1",
              choices: [{ message: { content: "ok" } }],
            }),
          ),
      }),
    ).resolves.toMatchObject({ status: 200 });
  });

  it("returns the persisted attempt id with a V3 JSON response", async () => {
    const service = serviceWith({
      create: jest.fn().mockResolvedValue(42n),
      finish: jest.fn().mockResolvedValue(undefined),
    });

    await expect(
      service.runJsonFetchWithLog({
        type: "admin.v3.post.plan",
        provider: "openai-compatible",
        model: "model",
        endpoint: "https://llm.example/v1/chat/completions",
        requestJson: { model: "model", messages: [] },
        execute: () => Promise.resolve(Response.json({ ok: true })),
      }),
    ).resolves.toMatchObject({ response: { status: 200 }, logId: "42" });
  });

  it("normalizes provider usage while preserving the full usage object", async () => {
    const finish = jest.fn().mockResolvedValue(undefined);
    const service = serviceWith({
      create: jest.fn().mockResolvedValue(1n),
      finish,
    });

    await service.runJsonFetch({
      type: "admin.content.plan",
      provider: "openai-compatible",
      model: "requested-model",
      endpoint: "https://llm.example/v1/chat/completions",
      requestJson: { model: "requested-model", messages: [] },
      execute: () =>
        Promise.resolve(
          Response.json({
            model: "response-model",
            choices: [{ finish_reason: "stop", message: { content: "ok" } }],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 4,
              total_tokens: 14,
              prompt_tokens_details: {
                cached_tokens: 8,
                cache_write_tokens: 2,
              },
              completion_tokens_details: { reasoning_tokens: 1 },
              cost: 0.001,
              cost_details: { upstream_inference_cost: 0.0008 },
            },
          }),
        ),
    });

    expect(finish).toHaveBeenLastCalledWith(
      1n,
      expect.objectContaining({
        responseModel: "response-model",
        finishReason: "stop",
        cachedInputTokens: 8,
        cacheWriteTokens: 2,
        reasoningTokens: 1,
        cost: 0.001,
        upstreamCost: 0.0008,
        usageJson: expect.objectContaining({ total_tokens: 14 }),
      }),
    );
  });

  // id가 BigInt라 그대로 내보내면 JSON 직렬화가 터진다.
  it("serializes BigInt ids in the read-only list contract", async () => {
    const row: LlmLogListRow = {
      id: 12n,
      type: "agent.chat",
      provider: "openai-compatible",
      model: "model",
      status: "succeeded",
      isStreaming: false,
      requestId: "req-1",
      providerRequestId: "provider-1",
      userId: null,
      characterId: null,
      generationJobId: null,
      httpStatus: 200,
      errorType: null,
      durationMs: 10,
      inputTokens: 2,
      outputTokens: 3,
      totalTokens: 5,
      responseModel: "response-model",
      finishReason: "stop",
      timeToFirstTokenMs: 2,
      cachedInputTokens: 1,
      cacheWriteTokens: 0,
      reasoningTokens: 1,
      cost: { toString: () => "0.001" } as never,
      upstreamCost: null,
      createdAt: new Date("2026-07-29T00:00:00.000Z"),
      completedAt: new Date("2026-07-29T00:00:00.010Z"),
      _count: { media: 1 },
    };
    const service = serviceWith({
      findManyForList: jest.fn().mockResolvedValue([row]),
    });

    await expect(service.list({ limit: 50 })).resolves.toMatchObject({
      items: [
        {
          id: "12",
          mediaCount: 1,
          totalTokens: 5,
          displayModel: "response-model",
          cost: "0.001",
        },
      ],
    });
  });
});

describe("redactLlmPayload", () => {
  it("removes secret, image base64, and signed URL values", () => {
    const result = redactLlmPayload({
      apiKey: "secret",
      image: "data:image/png;base64,AAAA",
      url: "https://bucket.example/a.png?X-Amz-Signature=sig&width=100",
    });

    expect(result.value).toEqual({
      apiKey: "[REDACTED]",
      image: "[REDACTED]",
      url: "https://bucket.example/a.png?width=100",
    });
    expect(result.redactedPaths).toEqual([
      "$.apiKey",
      "$.image",
      "$.url.query.X-Amz-Signature",
    ]);
  });
});
