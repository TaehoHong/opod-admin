import { TokenUsageService } from "./token-usage.service";

// 집계가 틀리면 오류 없이 운영자에게 잘못된 토큰 수가 표시된다.
// 순수 로직이라 DB나 HTTP를 거치지 않고 확인한다.
describe("TokenUsageService", () => {
  it("aggregates usage by day, provider and model", async () => {
    const rows = [
      {
        createdAt: new Date("2026-07-29T01:00:00.000Z"),
        provider: "openai",
        model: "gpt-5-mini",
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
      {
        createdAt: new Date("2026-07-29T23:00:00.000Z"),
        provider: "openai",
        model: "gpt-5-mini",
        inputTokens: 20,
        outputTokens: 10,
        totalTokens: 30,
      },
      {
        createdAt: new Date("2026-07-30T02:00:00.000Z"),
        provider: "fal",
        model: "nano-banana",
        inputTokens: 1,
        outputTokens: null,
        totalTokens: 1,
      },
    ];
    const service = new TokenUsageService({
      findUsageSince: () => Promise.resolve(rows),
    } as never);

    const summary = await service.summarize({
      now: new Date("2026-07-30T12:00:00.000Z"),
    });

    expect(summary.totals).toEqual({
      inputTokens: 31,
      outputTokens: 15,
      totalTokens: 46,
      calls: 3,
    });
    // 추이는 시간순, 집계는 사용량 내림차순이어야 화면이 그대로 쓸 수 있다.
    expect(summary.daily.map((point) => point.date)).toEqual([
      "2026-07-29",
      "2026-07-30",
    ]);
    expect(summary.daily[0].totalTokens).toBe(45);
    expect(summary.byProvider.map((entry) => entry.key)).toEqual([
      "openai",
      "fal",
    ]);
    expect(summary.byModel[0]).toMatchObject({
      key: "gpt-5-mini",
      totalTokens: 45,
      calls: 2,
    });
  });
});
