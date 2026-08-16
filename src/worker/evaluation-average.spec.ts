import { evaluationAverage } from "./evaluation-worker.service";

// V3 생성 이미지 평가는 점수가 `shots[].dimensions.<차원>.score`와
// `setDimensions.<차원>.score`에 있다. 수집기가 거기까지 못 내려가서 화면에
// `이미지 심사 0.0/5`가 떴다 — 실제 평균은 4.8이었다.
describe("evaluationAverage", () => {
  it("collects V3 generated-image scores nested under shots and setDimensions", () => {
    const result = {
      shots: [
        {
          sortOrder: 0,
          issues: [{ dimension: "reference_adherence", severity: "minor" }],
          dimensions: {
            scene_fidelity: { applicable: true, score: 5 },
            reference_adherence: { applicable: true, score: 4 },
            text_fidelity: { applicable: false },
          },
        },
        {
          sortOrder: 1,
          issues: [],
          dimensions: {
            scene_fidelity: { applicable: true, score: 5 },
            reference_adherence: { applicable: true, score: 5 },
          },
        },
      ],
      setDimensions: { set_continuity: { applicable: true, score: 5 } },
      setIssues: [],
    };

    expect(evaluationAverage(result)).toBeCloseTo((5 + 4 + 5 + 5 + 5) / 5, 5);
  });

  // 고칠 때의 함정: 전 계층을 순회하면 sortOrder를 점수로 줍는다. 위 케이스에
  // sortOrder 0·1이 있으므로 평균이 오염되면 값이 달라진다 — 그걸 못 잡게
  // 여기서 한 번 더 못 박는다.
  it("never harvests sortOrder or other non-score numbers", () => {
    expect(
      evaluationAverage({
        shots: [
          { sortOrder: 7, candidateIndex: 3, dimensions: { a: { score: 5 } } },
        ],
      }),
    ).toBe(5);
  });

  // 텍스트 평가 3종은 result.scores가 평면 {차원: 숫자}다. 이 경로를 깨면
  // 게시글·이미지 기획·프롬프트 평가 총점이 전부 0이 된다.
  it("keeps the flat text-evaluation shape working", () => {
    expect(
      evaluationAverage({ scores: { status_validity: 5, intent_quality: 4 } }),
    ).toBe(4.5);
    expect(
      evaluationAverage({
        scores: { a: { score: 4, reason: "x" }, b: { score: 5, reason: "y" } },
      }),
    ).toBe(4.5);
  });

  it("returns 0 only when there is genuinely nothing to score", () => {
    expect(evaluationAverage({ shots: [], setDimensions: {} })).toBe(0);
  });
});
