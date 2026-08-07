import { parsePromptEvaluation } from "./prompt-evaluator";
import { PROMPT_EVAL_SHOT_DIMENSIONS } from "../../prompts/prompt-evaluator";

describe("parsePromptEvaluation", () => {
  const shotScores = Object.fromEntries(
    PROMPT_EVAL_SHOT_DIMENSIONS.map((dimension) => [
      dimension,
      { score: 4, reason: "적절함" },
    ]),
  );
  const validShot = (sortOrder: number) => ({
    sortOrder,
    scores: shotScores,
    issues: [],
    suggestions: [],
  });

  it("정상 출력을 파싱하고 crossShot 포함 평균 총점을 계산한다", () => {
    const result = parsePromptEvaluation(
      JSON.stringify({
        shots: [validShot(0), validShot(1)],
        crossShot: { score: 2, issues: ["1컷은 노을, 2컷은 대낮"] },
      }),
      [0, 1],
    );
    expect(result.shots).toHaveLength(2);
    expect(result.crossShot.issues).toHaveLength(1);
    // (4*10 + 2) / 11 = 3.82
    expect(result.overallScore).toBe(3.82);
  });

  it("컷 수가 다르면 거절한다 — 누락된 컷이 무평가로 통과하면 안 된다", () => {
    expect(() =>
      parsePromptEvaluation(
        JSON.stringify({
          shots: [validShot(0)],
          crossShot: { score: 4, issues: [] },
        }),
        [0, 1],
      ),
    ).toThrow(/returned 1 shot/);
  });

  it("sortOrder가 어긋나면 거절한다", () => {
    expect(() =>
      parsePromptEvaluation(
        JSON.stringify({
          shots: [validShot(1), validShot(0)],
          crossShot: { score: 4, issues: [] },
        }),
        [0, 1],
      ),
    ).toThrow(/invalid sortOrder/);
  });

  it("crossShot 누락·범위 밖 점수를 거절한다", () => {
    expect(() =>
      parsePromptEvaluation(JSON.stringify({ shots: [validShot(0)] }), [0]),
    ).toThrow(/missing crossShot/);
    expect(() =>
      parsePromptEvaluation(
        JSON.stringify({
          shots: [validShot(0)],
          crossShot: { score: 0, issues: [] },
        }),
        [0],
      ),
    ).toThrow(/invalid score/);
  });
});
