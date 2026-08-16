import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppProviders } from "../../app/providers";
import { EvaluationChips } from "./EvaluationChips";
import type { DraftEvaluation } from "./api";

// V3는 평가 본문을 scoresJson.result에 두고 차원 점수를 숫자로 저장하고, V2는
// scoresJson 최상위에 { score, reason }으로 저장한다. 2026-08-13에 V3 모양을
// 읽지 못해 만점 평가가 화면에서 통째로 사라졌으므로 두 세대를 함께 고정한다.
function evaluation(overrides: Partial<DraftEvaluation>): DraftEvaluation {
  return {
    id: "evaluation-1",
    draftId: "draft-1",
    kind: "plan",
    attempt: 1,
    status: "completed",
    rubricVersion: "v1",
    contentLanguage: "ko",
    createdAt: "2026-08-13T01:15:18.000Z",
    ...overrides,
  };
}

function renderChips(
  value: DraftEvaluation,
  props: { shotSortOrder?: number; candidateIndex?: number } = {},
) {
  render(
    <AppProviders>
      <EvaluationChips evaluation={value} {...props} />
    </AppProviders>,
  );
}

// V3 생성 이미지 평가는 컷마다 선택된 한 장을 보고, 차원을
// { applicable, score }로 저장한다 — 텍스트 평가 3종과도, V2 후보 평가와도
// 모양이 다르다.
const v3ImageEvaluation = evaluation({
  kind: "image",
  overallScore: 4,
  scoresJson: {
    _meta: { evaluatorVersion: "generated-image-evaluator-v1" },
    result: {
      status: "evaluated_generated_images",
      verdict: "issues_found",
      shots: [
        {
          sortOrder: 0,
          dimensions: {
            scene_fidelity: { applicable: true, score: 4 },
            identity_and_appearance: { applicable: true, score: 2 },
            text_fidelity: { applicable: false, score: null },
          },
          issues: [
            {
              dimension: "identity_and_appearance",
              severity: "major",
              detail: "턱선이 레퍼런스와 다르다",
            },
          ],
        },
      ],
      setDimensions: {
        set_continuity: { applicable: true, score: 5 },
        set_distinctness: { applicable: false, score: null },
      },
      setIssues: [],
    },
  },
});

describe("EvaluationChips", () => {
  it("renders V3 scores, verdict and overall score", () => {
    renderChips(
      evaluation({
        overallScore: 5,
        scoresJson: {
          _meta: { evaluatorVersion: "post-evaluator-v1" },
          result: {
            status: "evaluated_ready",
            verdict: "pass",
            scores: { voice_fit: 5, ai_tell_free: 4, caption_quality: 3 },
            issues: [],
          },
        },
      }),
    );

    expect(screen.getByText("LLM 심사 5.0/5")).toBeInTheDocument();
    expect(screen.getByText("통과")).toBeInTheDocument();
    expect(screen.getByText("말투 5/5")).toBeInTheDocument();
    expect(screen.getByText("AI 티 4/5")).toBeInTheDocument();
    expect(screen.getByText("캡션 3/5")).toBeInTheDocument();
  });

  it("uses the V3 issue detail as the reason for its dimension", () => {
    renderChips(
      evaluation({
        overallScore: 3,
        scoresJson: {
          result: {
            verdict: "issues_found",
            scores: { caption_quality: 3 },
            issues: [
              {
                dimension: "caption_quality",
                severity: "minor",
                detail: "마무리 문장이 어색하다",
                evidence: ["오늘도 화이팅"],
              },
            ],
          },
        },
      }),
    );

    expect(
      screen.getByRole("button", { name: "캡션 3점 사유" }),
    ).toBeInTheDocument();
    expect(screen.getByText("지적 있음")).toBeInTheDocument();
  });

  it("still renders the legacy V2 payload", () => {
    renderChips(
      evaluation({
        overallScore: 4,
        scoresJson: {
          scores: {
            persona_fit: { score: 5, reason: "페르소나에 부합" },
            caption_quality: { score: 4, reason: "자연스럽다" },
          },
        },
      }),
    );

    expect(screen.getByText("LLM 심사 4.0/5")).toBeInTheDocument();
    expect(screen.getByText("페르소나 5/5")).toBeInTheDocument();
    expect(screen.getByText("캡션 4/5")).toBeInTheDocument();
  });

  it("keeps the overall score visible when no dimension scores parse", () => {
    renderChips(
      evaluation({ overallScore: 5, scoresJson: { result: { scores: {} } } }),
    );

    expect(screen.getByText("LLM 심사 5.0/5")).toBeInTheDocument();
  });

  // 기획 평가에서 겪은 것과 같은 종류의 결함이다 — 저장 모양을 못 읽으면
  // 검수 화면에서 이미지 평가가 통째로 사라진다.
  it("renders V3 generated-image dimensions for one shot", () => {
    renderChips(v3ImageEvaluation, { shotSortOrder: 0 });

    expect(screen.getByText("장면 충실도 4/5")).toBeInTheDocument();
    expect(screen.getByText("정체성·외모 2/5")).toBeInTheDocument();
    // 계약이 없어 평가 대상이 아닌 차원과 낮은 점수를 받은 차원은 다르다.
    expect(screen.queryByText(/텍스트 정확도/)).not.toBeInTheDocument();
    // 컷 카드는 이미지 바로 옆이다 — 지적을 접어두지 않고 심각도·차원·내용을
    // 그대로 편다("중대 지적 N건" 배지를 눌러야 보이던 것을 대체).
    expect(
      screen.getByText(/중대 · 정체성·외모 · 턱선이 레퍼런스와 다르다/),
    ).toBeInTheDocument();
    expect(screen.queryByText("중대 지적 1건")).not.toBeInTheDocument();
    // 컷 번호와 칩은 이 자리에 이미 있으므로 다시 그리지 않는다.
    expect(screen.queryByText("컷 1")).not.toBeInTheDocument();
  });

  it("renders V3 set dimensions and the verdict at the set level", () => {
    renderChips(v3ImageEvaluation);

    // 저장된 overallScore(4)가 아니라 화면이 보여주는 차원 점수의 평균을 쓴다
    // — (4 + 2 + 5) / 3. 저장값이 0인 옛 행(수집기 버그)도 이 경로로 올바르게
    // 보이고, 배지와 칩이 같은 데이터를 말한다.
    expect(screen.getByText("이미지 심사 3.7/5")).toBeInTheDocument();
    expect(screen.getByText("지적 있음")).toBeInTheDocument();
    expect(screen.getByText("세트 연속성 5/5")).toBeInTheDocument();
    expect(screen.queryByText(/세트 구별성/)).not.toBeInTheDocument();
  });

  // 지적은 컷 안에 들어 있어서, 이 블록에서는 총점·판정만 보이고 실제 내용은
  // "평가 원문 보기"를 열어야 나왔다. 운영자가 무엇이 잘못됐는지 보려고 매번
  // JSON을 펴야 했다.
  it("shows each shot's flagged dimensions and issue details without opening the raw output", () => {
    renderChips(v3ImageEvaluation);

    expect(screen.getByText("컷 1")).toBeInTheDocument();
    // 만점이 아닌 차원만 — 만점 차원은 말할 게 없다.
    expect(screen.getByText("정체성·외모 2/5")).toBeInTheDocument();
    expect(screen.queryByText("장면 충실도 4/5")).toBeInTheDocument();
    expect(
      screen.getByText(/중대 · 정체성·외모 · 턱선이 레퍼런스와 다르다/),
    ).toBeInTheDocument();
  });

  it("says so explicitly when a shot has no findings", () => {
    renderChips(
      evaluation({
        kind: "image",
        overallScore: 0,
        scoresJson: {
          result: {
            verdict: "pass",
            shots: [
              {
                sortOrder: 0,
                dimensions: { scene_fidelity: { applicable: true, score: 5 } },
                issues: [],
              },
            ],
            setDimensions: {},
            setIssues: [],
          },
        },
      }),
    );

    expect(screen.getByText("컷 1")).toBeInTheDocument();
    expect(screen.getByText("전 차원 5/5 · 지적 없음")).toBeInTheDocument();
    // 저장값 0을 그대로 보여주면 만점 평가가 0점으로 보인다.
    expect(screen.getByText("이미지 심사 5.0/5")).toBeInTheDocument();
  });

  // V3 evaluator는 컷마다 선택된 한 장만 본다. 후보마다 같은 점수를 반복하면
  // 후보 간 품질 차이로 오독된다.
  it("does not attach V3 image scores to individual candidates", () => {
    renderChips(v3ImageEvaluation, { shotSortOrder: 0, candidateIndex: 1 });

    expect(screen.queryByText(/장면 충실도/)).not.toBeInTheDocument();
    expect(screen.queryByText(/정체성·외모/)).not.toBeInTheDocument();
    expect(screen.queryByText(/중대 지적/)).not.toBeInTheDocument();
  });

  it("reports a pending evaluation instead of scores", () => {
    renderChips(evaluation({ status: "pending", scoresJson: null }));

    expect(screen.getByText("평가 대기")).toBeInTheDocument();
  });
});
