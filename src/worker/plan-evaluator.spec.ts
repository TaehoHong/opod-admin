import { parsePlanEvaluation } from "./plan-evaluator";
import { PLAN_EVAL_DIMENSIONS } from "../../prompts/plan-evaluator";

// 파서가 느슨하면 오염된 평가(차원 누락·범위 밖 점수·사유 없는 점수)가
// DB와 오프라인 집계에 유입된다 — 거절 규칙이 보호 대상 행동이다.
describe("parsePlanEvaluation", () => {
  const validScores = Object.fromEntries(
    PLAN_EVAL_DIMENSIONS.map((dimension) => [
      dimension,
      { score: 4, reason: "적절함" },
    ]),
  );

  it("정상 출력을 파싱하고 총점을 평균으로 계산한다", () => {
    const result = parsePlanEvaluation(
      JSON.stringify({
        scores: {
          ...validScores,
          ai_tell_free: { score: 2, reason: "상투적 마무리 멘트" },
        },
        issues: [{ dimension: "ai_tell_free", detail: "마무리 문장" }],
        suggestions: ["마무리 멘트를 캐릭터 습관으로 교체"],
      }),
    );
    expect(result.scores.ai_tell_free.score).toBe(2);
    expect(result.issues).toHaveLength(1);
    // (4*7 + 2) / 8 = 3.75
    expect(result.overallScore).toBe(3.75);
  });

  it("마크다운 펜스로 감싼 JSON을 허용한다", () => {
    const result = parsePlanEvaluation(
      "```json\n" + JSON.stringify({ scores: validScores }) + "\n```",
    );
    expect(result.overallScore).toBe(4);
  });

  it("차원이 누락되면 거절한다", () => {
    const { persona_fit: _omitted, ...partial } = validScores;
    expect(() =>
      parsePlanEvaluation(JSON.stringify({ scores: partial })),
    ).toThrow(/persona_fit/);
  });

  it("범위 밖·비정수 점수를 거절한다", () => {
    expect(() =>
      parsePlanEvaluation(
        JSON.stringify({
          scores: { ...validScores, caption_quality: { score: 6, reason: "x" } },
        }),
      ),
    ).toThrow(/invalid score/);
    expect(() =>
      parsePlanEvaluation(
        JSON.stringify({
          scores: {
            ...validScores,
            caption_quality: { score: 3.5, reason: "x" },
          },
        }),
      ),
    ).toThrow(/invalid score/);
  });

  it("사유 없는 점수를 거절한다", () => {
    expect(() =>
      parsePlanEvaluation(
        JSON.stringify({
          scores: { ...validScores, persona_fit: { score: 4, reason: " " } },
        }),
      ),
    ).toThrow(/missing a reason/);
  });

  it("JSON이 아니면 거절한다", () => {
    expect(() => parsePlanEvaluation("평가 결과: 좋음")).toThrow(
      /not valid JSON/,
    );
  });
});
