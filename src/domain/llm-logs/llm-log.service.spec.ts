import { LlmLogService, redactLlmPayload } from "./llm-log.service";
import { PrismaService } from "../database/prisma.service";

function serviceWith(prisma: {
  llmLog: Record<string, jest.Mock>;
}): LlmLogService {
  return new LlmLogService(prisma as unknown as PrismaService);
}

describe("LlmLogService", () => {
  it("does not call the provider when the initial log insert fails", async () => {
    const execute = jest.fn();
    const service = serviceWith({
      llmLog: {
        create: jest.fn().mockRejectedValue(new Error("database unavailable")),
        update: jest.fn(),
      },
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

  it("returns the provider response when only the completion update fails", async () => {
    const service = serviceWith({
      llmLog: {
        create: jest.fn().mockResolvedValue({ id: 1n }),
        update: jest.fn().mockRejectedValue(new Error("database unavailable")),
      },
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

  it("serializes BigInt ids in the read-only list contract", async () => {
    const service = serviceWith({
      llmLog: {
        findMany: jest.fn().mockResolvedValue([
          {
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
          },
        ]),
      },
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
