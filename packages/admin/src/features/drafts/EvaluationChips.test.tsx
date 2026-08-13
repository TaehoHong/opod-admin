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

function renderChips(value: DraftEvaluation) {
  render(
    <AppProviders>
      <EvaluationChips evaluation={value} />
    </AppProviders>,
  );
}

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

  it("reports a pending evaluation instead of scores", () => {
    renderChips(evaluation({ status: "pending", scoresJson: null }));

    expect(screen.getByText("평가 대기")).toBeInTheDocument();
  });
});
