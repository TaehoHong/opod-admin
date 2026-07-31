import { LlmLogRepository, type LlmLogListRow } from "./llm-log.repository";
import { LlmLogService, redactLlmPayload } from "./llm-log.service";

// Prisma를 흉내내지 않고 repository를 대신 세운다
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
      createdAt: new Date("2026-07-29T00:00:00.000Z"),
      completedAt: new Date("2026-07-29T00:00:00.010Z"),
      _count: { media: 1 },
    };
    const service = serviceWith({
      findManyForList: jest.fn().mockResolvedValue([row]),
    });

    await expect(service.list({ limit: 50 })).resolves.toMatchObject({
      items: [{ id: "12", mediaCount: 1, totalTokens: 5 }],
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
