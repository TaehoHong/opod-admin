import {
  StrictJsonAgentClient,
  rememberedTokenField,
  resetTokenFieldMemory,
} from "./strict-json-agent";

const config = {
  apiUrl: "https://llm.test/v1/chat/completions",
  apiKey: "key",
  model: "gpt-5.6-terra",
};

function ok(content: unknown) {
  return Response.json({
    choices: [{ message: { content: JSON.stringify(content) } }],
  });
}

function rejectsMaxTokens() {
  return new Response(
    JSON.stringify({
      error: {
        message:
          "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
      },
    }),
    { status: 400 },
  );
}

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as { body: string }).body) as Record<
    string,
    unknown
  >;
}

const request = {
  logType: "admin.v3.post.plan" as never,
  schemaName: "s",
  schema: { type: "object", properties: {}, additionalProperties: false },
  systemPrompt: "sys",
  input: { a: 1 },
};

describe("StrictJsonAgentClient token-limit field", () => {
  beforeEach(() => resetTokenFieldMemory());

  // 기억이 없으면 종전대로 max_tokens → 400 → max_completion_tokens.
  // 기억이 생기면 다음 호출부터 바로 max_completion_tokens로 나가야 한다 —
  // 그렇지 않으면 모든 호출이 두 번 나가고 이미지는 두 번 올라간다.
  it("learns the accepted field after one rejection and stops sending the rejected one", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(rejectsMaxTokens())
      .mockResolvedValueOnce(ok({ v: 1 }))
      .mockResolvedValueOnce(ok({ v: 2 }));
    const client = new StrictJsonAgentClient(config, fetchMock as never);

    await expect(client.run(request)).resolves.toMatchObject({
      value: { v: 1 },
    });
    expect(bodyOf(fetchMock.mock.calls[0])).toHaveProperty("max_tokens");
    expect(bodyOf(fetchMock.mock.calls[1])).toHaveProperty(
      "max_completion_tokens",
    );
    expect(rememberedTokenField(config)).toBe("max_completion_tokens");

    await expect(client.run(request)).resolves.toMatchObject({
      value: { v: 2 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(bodyOf(fetchMock.mock.calls[2])).toHaveProperty(
      "max_completion_tokens",
    );
    expect(bodyOf(fetchMock.mock.calls[2])).not.toHaveProperty("max_tokens");
  });

  // 기억은 (엔드포인트, 모델) 단위다 — 다른 모델은 다시 max_tokens부터.
  it("keeps the memory per endpoint and model", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(rejectsMaxTokens())
      .mockResolvedValueOnce(ok({ v: 1 }))
      .mockResolvedValueOnce(ok({ v: 2 }));
    await new StrictJsonAgentClient(config, fetchMock as never).run(request);
    const other = { ...config, model: "legacy-compatible" };
    await new StrictJsonAgentClient(other, fetchMock as never).run(request);

    expect(bodyOf(fetchMock.mock.calls[2])).toHaveProperty("max_tokens");
    expect(rememberedTokenField(other)).toBe("max_tokens");
  });

  // 기억이 max_completion_tokens인데 모델을 옛 호환 서버로 바꾸면 반대 방향
  // 400이 난다 — 그때도 한 번 뒤집고 다시 기억해야 한다.
  it("flips back when the remembered field is the one being rejected", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(rejectsMaxTokens())
      .mockResolvedValueOnce(ok({ v: 1 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message:
                "Unrecognized request argument supplied: max_completion_tokens",
            },
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(ok({ v: 3 }));
    const client = new StrictJsonAgentClient(config, fetchMock as never);
    await client.run(request);
    expect(rememberedTokenField(config)).toBe("max_completion_tokens");

    await expect(client.run(request)).resolves.toMatchObject({
      value: { v: 3 },
    });
    expect(bodyOf(fetchMock.mock.calls[3])).toHaveProperty("max_tokens");
    expect(rememberedTokenField(config)).toBe("max_tokens");
  });

  it("surfaces unrelated 400s instead of retrying", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { message: "Invalid schema for response_format" },
        }),
        { status: 400 },
      ),
    );
    const client = new StrictJsonAgentClient(config, fetchMock as never);

    await expect(client.run(request)).rejects.toThrow(
      "structured agent failed (400)",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
