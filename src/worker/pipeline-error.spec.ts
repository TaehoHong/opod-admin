import { pipelineFailure } from "./pipeline-error";

describe("pipelineFailure", () => {
  const at = new Date("2026-08-20T00:00:00.000Z");

  it("keeps the provider status and response in a structured operator error", () => {
    expect(
      pipelineFailure(
        new Error("structured agent failed (429): quota exhausted"),
        "post_plan",
        at,
      ),
    ).toEqual({
      code: "provider_http_error",
      stage: "post_plan",
      problem: "AI 제공자가 요청을 거부했습니다.",
      cause: "AI 제공자가 HTTP 429 오류를 반환했습니다.",
      nextAction:
        "접힌 기술 상세에서 제공자 응답을 확인하고 설정 또는 입력을 수정한 뒤 다시 실행하세요.",
      technicalDetail: "structured agent failed (429): quota exhausted",
      occurredAt: "2026-08-20T00:00:00.000Z",
      retryable: true,
    });
  });

  it("includes the fetch cause chain in connection failures", () => {
    const cause = new Error("ENOTFOUND llm.example.com");
    const error = new Error("fetch failed") as Error & { cause?: Error };
    error.cause = cause;

    expect(pipelineFailure(error, "caption", at)).toMatchObject({
      code: "provider_connection_failed",
      technicalDetail: "fetch failed ← ENOTFOUND llm.example.com",
    });
  });
});
