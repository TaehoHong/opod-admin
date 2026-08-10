import { BadRequestException, NotFoundException } from "@nestjs/common";
import { EvaluationRepository } from "../../worker/evaluation.repository";
import { EvaluationsService } from "./evaluations.service";

function repositoryFake() {
  return {
    findByDraft: jest.fn(),
    findCompletedInPeriod: jest.fn(),
    createReport: jest.fn(async (input) => ({ id: "report-1", ...input })),
    listReports: jest.fn(),
    findReport: jest.fn(),
  } as unknown as jest.Mocked<EvaluationRepository>;
}

describe("EvaluationsService", () => {
  it("언어별 점수와 휴먼 시그널·루브릭 불일치를 집계한다", async () => {
    const repository = repositoryFake();
    repository.findCompletedInPeriod.mockResolvedValue([
      {
        id: "eval-plan",
        draftId: "draft-rejected",
        kind: "plan",
        status: "completed",
        contentLanguage: "ko",
        overallScore: 4.5,
        scoresJson: {
          scores: { persona_fit: { score: 2, reason: "낮음" } },
        },
        draft: {
          id: "draft-rejected",
          status: "rejected",
          caption: "수정된 캡션",
          conceptJson: { plan: { caption: "원래 캡션" } },
          publishedPostId: null,
          jobs: [
            {
              id: "job-1",
              sortOrder: 0,
              originJobId: "old-job",
              status: "completed",
              outputs: [{ selected: true }],
            },
          ],
        },
      },
      {
        id: "eval-prompt",
        draftId: "draft-approved",
        kind: "prompt",
        status: "completed",
        contentLanguage: "ko",
        overallScore: 2,
        scoresJson: {
          shots: [
            {
              scores: {
                plan_fidelity: { score: 1, reason: "낮음" },
              },
            },
          ],
          crossShot: { score: 2, issues: [] },
        },
        draft: {
          id: "draft-approved",
          status: "approved",
          caption: "같은 캡션",
          conceptJson: { plan: { caption: "같은 캡션" } },
          publishedPostId: null,
          jobs: [],
        },
      },
    ] as never);

    const service = new EvaluationsService(repository);
    await service.createReport({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-08T00:00:00.000Z",
    });

    expect(repository.createReport).toHaveBeenCalledWith(
      expect.objectContaining({
        summaryJson: expect.objectContaining({
          evaluationCount: 2,
          languages: expect.objectContaining({
            ko: expect.objectContaining({
              humanSignals: {
                approvedDrafts: 1,
                rejectedDrafts: 1,
                regeneratedShots: 1,
                selectedOutputs: 1,
                captionEditedDrafts: 1,
              },
              mismatches: {
                highScoreRejected: ["draft-rejected"],
                lowScoreApproved: ["draft-approved"],
              },
            }),
          }),
        }),
        failurePatternsJson: expect.arrayContaining([
          expect.objectContaining({
            language: "ko",
            kind: "prompt",
            dimension: "plan_fidelity",
            lowScoreCount: 1,
          }),
        ]),
      }),
    );
  });

  it("역전된 집계 기간을 거절한다", async () => {
    const service = new EvaluationsService(repositoryFake());
    await expect(
      service.createReport({
        from: "2026-08-08T00:00:00.000Z",
        to: "2026-08-01T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("없는 리포트를 404로 정규화한다", async () => {
    const repository = repositoryFake();
    repository.findReport.mockResolvedValue(null);
    await expect(
      new EvaluationsService(repository).getReport("missing"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
