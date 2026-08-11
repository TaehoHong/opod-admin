import { IMAGE_EVAL_DIMENSIONS } from "../../prompts/image-evaluator";
import { parseImageEvaluation } from "./image-evaluator";

describe("parseImageEvaluation", () => {
  const scores = Object.fromEntries(
    IMAGE_EVAL_DIMENSIONS.map((dimension) => [
      dimension,
      { score: 4, reason: "문제 없음" },
    ]),
  );

  it("하드 실패 후보를 반려하고 평균 점수를 2점대로 제한한다", () => {
    const result = parseImageEvaluation(
      JSON.stringify({
        shots: [
          {
            sortOrder: 0,
            candidates: [
              {
                candidateIndex: 0,
                scores,
                hardFailures: ["phone_orientation_mismatch"],
                issues: ["휴대폰 방향이 기획과 다름"],
                suggestions: ["세로 방향으로 다시 생성"],
              },
            ],
          },
        ],
        crossShot: {
          score: 4,
          selectedCandidates: [{ sortOrder: 0, candidateIndex: 0 }],
          hardFailures: [],
          issues: [],
        },
      }),
      [{ sortOrder: 0, candidateIndexes: [0] }],
    );

    expect(result.shots[0].candidates[0]).toEqual(
      expect.objectContaining({ verdict: "reject", overallScore: 2.99 }),
    );
    expect(result.overallScore).toBe(2.99);
  });

  it("허용하지 않은 하드 실패 코드는 거절한다", () => {
    expect(() =>
      parseImageEvaluation(
        JSON.stringify({
          shots: [
            {
              sortOrder: 0,
              candidates: [
                {
                  candidateIndex: 0,
                  scores,
                  hardFailures: ["looks_bad"],
                  issues: [],
                  suggestions: [],
                },
              ],
            },
          ],
          crossShot: {
            score: 4,
            selectedCandidates: [{ sortOrder: 0, candidateIndex: 0 }],
            hardFailures: [],
            issues: [],
          },
        }),
        [{ sortOrder: 0, candidateIndexes: [0] }],
      ),
    ).toThrow(/invalid hard failure code/);
  });

  it("예상하지 않은 후보 인덱스를 거절한다", () => {
    expect(() =>
      parseImageEvaluation(
        JSON.stringify({
          shots: [
            {
              sortOrder: 0,
              candidates: [
                {
                  candidateIndex: 1,
                  scores,
                  hardFailures: [],
                  issues: [],
                  suggestions: [],
                },
              ],
            },
          ],
          crossShot: {
            score: 4,
            selectedCandidates: [{ sortOrder: 0, candidateIndex: 0 }],
            hardFailures: [],
            issues: [],
          },
        }),
        [{ sortOrder: 0, candidateIndexes: [0] }],
      ),
    ).toThrow(/invalid candidateIndex/);
  });
});
