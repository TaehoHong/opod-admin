import { DraftsRepository } from "./drafts.repository";
import { DraftsService } from "./drafts.service";

type RepositoryFake = jest.Mocked<DraftsRepository>;

function repositoryFake(overrides: Partial<DraftsRepository> = {}) {
  return {
    cursorMatchesFilter: jest.fn().mockResolvedValue(true),
    findMany: jest.fn().mockResolvedValue([]),
    findDraft: jest.fn().mockResolvedValue(null),
    findDraftJobs: jest.fn().mockResolvedValue([]),
    findMediaUrls: jest.fn().mockResolvedValue([]),
    characterExists: jest.fn().mockResolvedValue(true),
    createDraft: jest.fn(),
    findPlanEditDraft: jest.fn().mockResolvedValue(null),
    updatePlan: jest.fn().mockResolvedValue(true),
    updatePrompts: jest.fn().mockResolvedValue(true),
    markManual: jest.fn().mockResolvedValue(undefined),
    findDraftConcept: jest.fn().mockResolvedValue(null),
    updateEditableDraft: jest.fn().mockResolvedValue(true),
    approveDraft: jest.fn().mockResolvedValue(true),
    rejectDraft: jest.fn().mockResolvedValue(true),
    draftExists: jest.fn().mockResolvedValue(true),
    findDraftShotPrompt: jest.fn().mockResolvedValue(null),
    queueDraftShot: jest.fn().mockResolvedValue(true),
    findShotIdentity: jest.fn().mockResolvedValue(null),
    findRegenerationSource: jest.fn().mockResolvedValue(null),
    regenerateShot: jest.fn().mockResolvedValue("regenerated"),
    findCompletedShotCandidates: jest.fn().mockResolvedValue(null),
    selectShotOutput: jest.fn().mockResolvedValue(undefined),
    findEditableOutput: jest.fn().mockResolvedValue(null),
    updateOutputFilter: jest.fn().mockResolvedValue(undefined),
    recordActionLog: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as RepositoryFake;
}

function makeService(repository: RepositoryFake, pipelineV3Enabled = false) {
  return new DraftsService(repository, {
    resolvePipelineV3: jest.fn().mockResolvedValue({
      enabled: pipelineV3Enabled,
      source: pipelineV3Enabled ? "db" : "none",
    }),
  } as never);
}

const draftRow = {
  id: "draft-1",
  characterId: "ai-1",
  draftType: "post",
  contentType: "feed",
  caption: "노을 산책",
  hashtags: ["필름사진"],
  status: "needs_review",
  attemptCount: 1,
  errorMessage: null,
  scheduledAt: new Date("2026-07-13T10:00:00.000Z"),
  publishedPostId: null,
  conceptJson: { plan: {} },
  createdAt: new Date("2026-07-12T00:00:00.000Z"),
  updatedAt: new Date("2026-07-12T00:00:00.000Z"),
} as const;

const selectedJob = {
  id: "job-1",
  sortOrder: 0,
  status: "completed",
  prompt: "p",
  paramsJson: null,
  candidateCount: 1,
  provider: null,
  costUsd: null,
  errorMessage: null,
  attemptCount: 1,
  createdAt: new Date("2026-07-12T02:00:00.000Z"),
  updatedAt: new Date("2026-07-12T02:00:12.000Z"),
  outputs: [
    {
      mediaId: "media-1",
      candidateIndex: 0,
      selected: true,
      filterPreset: "film",
      media: { url: "https://cdn.local/a.png" },
    },
  ],
} as const;

describe("DraftsService", () => {
  // 운영자 요청은 평가 지적을 재실행에 되먹이는 유일한 통로다(러너는 평가를
  // 읽지 않는다). 그래서 "언제 바꿀 수 있는가"가 계약의 핵심이다.
  describe("updateOperatorRequest", () => {
    const v3Concept = {
      conceptJson: {
        pipelineVersion: "post-pipeline-v3",
        mode: "manual",
        operatorRequest: "이전 요청",
      },
    };

    // 워커가 옛 입력으로 산출물을 만드는 중에 요청이 바뀌면, 저장된 요청과 실제
    // 사용된 입력이 어긋난다. 운영자는 "요청대로 안 나왔다"고 오판하게 된다.
    it("refuses to change the request while a stage is running", async () => {
      const repository = repositoryFake({
        findDraftConcept: jest.fn().mockResolvedValue(v3Concept),
        // status 조건에 걸리지 않으면 updateMany가 0건을 반환한다.
        updateEditableDraft: jest.fn().mockResolvedValue(false),
      });
      const service = makeService(repository);

      await expect(
        service.updateOperatorRequest({
          draftId: "draft-1",
          operatorRequest: "거울 셀카는 후면 카메라로",
        }),
      ).rejects.toThrow("Only drafts waiting for a stage run");
      expect(repository.markManual).not.toHaveBeenCalled();
    });

    it("only allows planned or failed drafts to be edited", async () => {
      const repository = repositoryFake({
        findDraftConcept: jest.fn().mockResolvedValue(v3Concept),
        findDraft: jest.fn().mockResolvedValue(draftRow),
      });
      const service = makeService(repository);

      await service.updateOperatorRequest({
        draftId: "draft-1",
        operatorRequest: "거울 셀카는 후면 카메라로",
      });

      expect(repository.updateEditableDraft).toHaveBeenCalledWith(
        "draft-1",
        ["planned", "failed"],
        {
          conceptJson: expect.objectContaining({
            operatorRequest: "거울 셀카는 후면 카메라로",
          }),
        },
      );
    });

    // V2 플래너는 sceneHint를 읽는다. operatorRequest를 저장하고 성공을 보고하면
    // 운영자는 반영됐다고 믿고 재실행하지만 아무것도 달라지지 않는다.
    it("refuses V2 drafts instead of storing a value nothing reads", async () => {
      const repository = repositoryFake({
        findDraftConcept: jest
          .fn()
          .mockResolvedValue({ conceptJson: { sceneHint: "노을 지는 골목" } }),
      });
      const service = makeService(repository);

      await expect(
        service.updateOperatorRequest({
          draftId: "draft-1",
          operatorRequest: "무언가",
        }),
      ).rejects.toThrow("post-pipeline-v3");
      expect(repository.updateEditableDraft).not.toHaveBeenCalled();
    });

    // 비우면 "지정 없음"으로 되돌아가야 한다. 빈 문자열을 남기면 런타임이
    // 요청 없음으로 보는 것과 저장 모양이 어긋난다.
    it("clears the request when the new value is blank", async () => {
      const repository = repositoryFake({
        findDraftConcept: jest.fn().mockResolvedValue(v3Concept),
        findDraft: jest.fn().mockResolvedValue(draftRow),
      });
      const service = makeService(repository);

      await service.updateOperatorRequest({
        draftId: "draft-1",
        operatorRequest: "   ",
      });

      const [, , data] = (repository.updateEditableDraft as jest.Mock).mock
        .calls[0];
      expect(data.conceptJson).not.toHaveProperty("operatorRequest");
      expect(data.conceptJson).toHaveProperty("pipelineVersion");
    });
  });

  it("rejects an unknown status filter before querying", async () => {
    const repository = repositoryFake();
    const service = makeService(repository);

    await expect(
      service.listDrafts({ status: "archived", limit: 20 }),
    ).rejects.toThrow("Draft status must be one of");
    expect(repository.findMany).not.toHaveBeenCalled();
  });

  it("lists drafts with filters and limit-plus-one pagination", async () => {
    const repository = repositoryFake({
      findMany: jest.fn().mockResolvedValue([draftRow]),
    });
    const service = makeService(repository);

    await expect(
      service.listDrafts({ status: "needs_review", limit: 20 }),
    ).resolves.toMatchObject({
      items: [{ id: "draft-1", status: "needs_review" }],
    });
    expect(repository.findMany).toHaveBeenCalledWith({
      status: "needs_review",
      take: 21,
    });
  });

  it("rejects a cursor that does not belong to the active filters", async () => {
    const repository = repositoryFake({
      cursorMatchesFilter: jest.fn().mockResolvedValue(false),
    });
    const service = makeService(repository);

    await expect(
      service.listDrafts({
        status: "approved",
        characterId: " ai-1 ",
        limit: 20,
        cursor: Buffer.from("draft-1").toString("base64url"),
      }),
    ).rejects.toThrow("Invalid cursor");
    expect(repository.findMany).not.toHaveBeenCalled();
  });

  it("returns only the latest job per shot with its selected candidates", async () => {
    const repository = repositoryFake({
      findDraft: jest.fn().mockResolvedValue(draftRow),
      findDraftJobs: jest.fn().mockResolvedValue([
        selectedJob,
        {
          ...selectedJob,
          id: "job-old",
          status: "failed",
          createdAt: new Date("2026-07-12T01:00:00.000Z"),
          outputs: [],
        },
      ]),
    });
    const service = makeService(repository);

    await expect(service.getDraft("draft-1")).resolves.toMatchObject({
      shots: [
        {
          jobId: "job-1",
          outputs: [{ mediaId: "media-1", selected: true }],
        },
      ],
    });
  });

  it("returns planned and actual generation trace without hiding missing references", async () => {
    const repository = repositoryFake({
      findDraft: jest.fn().mockResolvedValue(draftRow),
      findDraftJobs: jest.fn().mockResolvedValue([
        {
          ...selectedJob,
          provider: "fal:new-edit-model",
          paramsJson: {
            _shot: {
              scene: "철길 옆에 선 뒷모습",
              captureSetup: "벤치 위 고정 카메라와 셀프타이머",
              characterVisible: true,
              referenceMediaIds: ["planned-ref", "missing-ref"],
              targetModelId: "old-edit-model",
              execution: {
                route: "edit",
                referenceMediaIds: ["planned-ref"],
              },
            },
          },
        },
      ]),
      findMediaUrls: jest
        .fn()
        .mockResolvedValue([
          { id: "planned-ref", url: "https://cdn.local/planned.png" },
        ]),
    });
    const service = makeService(repository);

    await expect(service.getDraft("draft-1")).resolves.toMatchObject({
      shots: [
        {
          generationTrace: {
            captureSetup: "벤치 위 고정 카메라와 셀프타이머",
            characterVisible: true,
            planned: {
              route: "edit",
              targetModelId: "old-edit-model",
              references: [
                {
                  mediaId: "planned-ref",
                  url: "https://cdn.local/planned.png",
                  available: true,
                },
                { mediaId: "missing-ref", available: false },
              ],
            },
            execution: {
              route: "edit",
              provider: "fal:new-edit-model",
              references: [
                {
                  mediaId: "planned-ref",
                  url: "https://cdn.local/planned.png",
                  available: true,
                },
              ],
            },
            matchesPlan: false,
          },
        },
      ],
    });
  });

  it("creates a manual draft with normalized operator intent", async () => {
    const repository = repositoryFake({
      createDraft: jest.fn().mockResolvedValue({
        ...draftRow,
        status: "planned",
        caption: "",
        hashtags: [],
        scheduledAt: null,
        conceptJson: { source: "manual", mode: "manual", sceneHint: "카페" },
      }),
    });
    const service = makeService(repository);

    await expect(
      service.createDraft({ characterId: "ai-1", sceneHint: " 카페 " }),
    ).resolves.toMatchObject({ status: "planned" });
    expect(repository.createDraft).toHaveBeenCalledWith({
      characterId: "ai-1",
      contentType: "feed",
      conceptJson: { source: "manual", mode: "manual", sceneHint: "카페" },
    });
    expect(repository.recordActionLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "DRAFT_CREATED" }),
    );
  });

  it("pins an enabled new draft to V3 without converting legacy fields", async () => {
    const repository = repositoryFake({
      createDraft: jest.fn().mockResolvedValue({
        ...draftRow,
        status: "planned",
        caption: "",
        hashtags: [],
        scheduledAt: null,
        conceptJson: {},
      }),
    });
    const service = makeService(repository, true);

    await service.createDraft({
      characterId: "ai-1",
      sceneHint: " 카페에서 비 오는 오후 ",
    });

    expect(repository.createDraft).toHaveBeenCalledWith({
      characterId: "ai-1",
      contentType: "feed",
      conceptJson: {
        pipelineVersion: "post-pipeline-v4",
        source: "manual",
        mode: "manual",
        operatorRequest: "카페에서 비 오는 오후",
        pipeline: {
          stage: "post_plan",
          state: "pending",
          imageCount: null,
          reasonCodes: [],
        },
      },
    });
  });

  it("does not let a legacy request turn the operator entry point automatic", async () => {
    const repository = repositoryFake({
      createDraft: jest.fn().mockResolvedValue({
        ...draftRow,
        status: "planned",
        conceptJson: { source: "manual", mode: "manual" },
      }),
    });
    const service = makeService(repository);

    await service.createDraft({ characterId: "ai-1", mode: "auto" } as never);

    expect(repository.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        conceptJson: { source: "manual", mode: "manual" },
      }),
    );
  });

  it("refuses to queue a shot whose stored prompt is empty", async () => {
    const repository = repositoryFake({
      findDraftShotPrompt: jest.fn().mockResolvedValue({ prompt: "" }),
    });
    const service = makeService(repository);

    await expect(
      service.queueShot({ draftId: "draft-1", jobId: "job-1" }),
    ).rejects.toThrow(
      "Shot prompt is empty — run prompt build first or provide a prompt",
    );
    expect(repository.queueDraftShot).not.toHaveBeenCalled();
  });

  it("queues a draft-state shot with the edited generation inputs", async () => {
    const repository = repositoryFake({
      findShotIdentity: jest
        .fn()
        .mockResolvedValue({ characterId: "ai-1", sortOrder: 0 }),
    });
    const service = makeService(repository);

    await service.queueShot({
      draftId: "draft-1",
      jobId: "job-1",
      prompt: " 수정된 프롬프트 ",
      candidateCount: 3,
    });

    expect(repository.queueDraftShot).toHaveBeenCalledWith({
      draftId: "draft-1",
      jobId: "job-1",
      prompt: "수정된 프롬프트",
      candidateCount: 3,
    });
    expect(repository.markManual).toHaveBeenCalledWith("draft-1");
    expect(repository.recordActionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "DRAFT_SHOT_GENERATION_STARTED",
      }),
    );
  });

  it("rejects edits when the draft no longer has an editable status", async () => {
    const repository = repositoryFake({
      updateEditableDraft: jest.fn().mockResolvedValue(false),
    });
    const service = makeService(repository);

    await expect(
      service.updateDraft({ draftId: "draft-1", caption: " 새 캡션 " }),
    ).rejects.toThrow(
      "Only needs_review or approved drafts (or V4 drafts waiting to publish) can be edited",
    );
    expect(repository.updateEditableDraft).toHaveBeenCalledWith(
      "draft-1",
      ["needs_review", "approved"],
      { caption: "새 캡션" },
      ["publish"],
    );
  });

  it("keeps the plan JSON and shot metadata aligned when an operator edits the plan", async () => {
    const repository = repositoryFake({
      findPlanEditDraft: jest.fn().mockResolvedValue({
        id: "draft-1",
        characterId: "ai-1",
        status: "generating",
        leaseExpiresAt: null,
        conceptJson: {
          source: "manual",
          mode: "manual",
          plan: {
            caption: "이전 캡션",
            hashtags: ["이전"],
            shots: [{ sortOrder: 0, scene: "이전 장면" }],
          },
        },
        jobs: [
          {
            id: "job-1",
            sortOrder: 0,
            paramsJson: { _shot: { scene: "이전 장면", captureSetup: "wide" } },
          },
        ],
      } as never),
      findDraft: jest.fn().mockResolvedValue(draftRow),
    });
    const service = makeService(repository);

    await service.updatePlan({
      draftId: "draft-1",
      caption: " 새 캡션 ",
      hashtags: [" 새태그 "],
      shots: [{ sortOrder: 0, scene: " 새 장면 " }],
    });

    expect(repository.updatePlan).toHaveBeenCalledWith({
      draftId: "draft-1",
      caption: "새 캡션",
      hashtags: ["새태그"],
      conceptJson: expect.objectContaining({
        mode: "manual",
        plan: expect.objectContaining({
          caption: "새 캡션",
          hashtags: ["새태그"],
          shots: [expect.objectContaining({ scene: "새 장면" })],
        }),
      }),
      shots: [
        {
          jobId: "job-1",
          paramsJson: {
            _shot: { scene: "새 장면", captureSetup: "wide" },
          },
        },
      ],
    });
  });

  it("requires a selected image for every shot before approval", async () => {
    const repository = repositoryFake({
      findDraft: jest.fn().mockResolvedValue(draftRow),
      findDraftJobs: jest.fn().mockResolvedValue([
        {
          ...selectedJob,
          outputs: [{ ...selectedJob.outputs[0], selected: false }],
        },
      ]),
    });
    const service = makeService(repository);

    await expect(service.approveDraft("draft-1")).rejects.toThrow(
      "Select one image for every shot before approval",
    );
    expect(repository.approveDraft).not.toHaveBeenCalled();
  });

  it("approves a fully reviewed draft and records the decision", async () => {
    const mismatchedJob = {
      ...selectedJob,
      provider: "fal:new-t2i-model",
      paramsJson: {
        _shot: {
          characterVisible: false,
          referenceMediaIds: [],
          targetModelId: "old-t2i-model",
          execution: { route: "t2i", referenceMediaIds: [] },
        },
      },
    };
    const repository = repositoryFake({
      findDraft: jest
        .fn()
        .mockResolvedValueOnce(draftRow)
        .mockResolvedValueOnce({ ...draftRow, status: "approved" }),
      findDraftJobs: jest.fn().mockResolvedValue([mismatchedJob]),
    });
    const service = makeService(repository);

    await expect(service.approveDraft("draft-1")).resolves.toMatchObject({
      status: "approved",
    });
    expect(repository.approveDraft).toHaveBeenCalledWith("draft-1");
    expect(repository.recordActionLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "DRAFT_APPROVED" }),
    );
  });

  it("maps stale regeneration attempts to the operator-facing error", async () => {
    const source = {
      id: "job-old",
      characterId: "ai-1",
      sortOrder: 1,
      status: "completed",
      inputPrompt: null,
      prompt: "옛 프롬프트",
      candidateCount: 2,
      paramsJson: { _shot: { scene: "옛 장면" } },
    } as const;
    const repository = repositoryFake({
      findRegenerationSource: jest.fn().mockResolvedValue(source),
      regenerateShot: jest.fn().mockResolvedValue("stale-job"),
    });
    const service = makeService(repository);

    await expect(
      service.regenerateShot({ draftId: "draft-1", jobId: "job-old" }),
    ).rejects.toThrow("Only the latest draft shot can be regenerated");
  });

  it("selects only a media candidate owned by the completed shot", async () => {
    const repository = repositoryFake({
      findCompletedShotCandidates: jest.fn().mockResolvedValue({
        id: "job-1",
        outputs: [{ mediaId: "media-1" }],
      }),
      findDraft: jest.fn().mockResolvedValue(draftRow),
    });
    const service = makeService(repository);

    await expect(
      service.selectShotOutput({
        draftId: "draft-1",
        jobId: "job-1",
        mediaId: "media-x",
      }),
    ).rejects.toThrow("Media is not a candidate output of this job");
    expect(repository.selectShotOutput).not.toHaveBeenCalled();
  });

  it("stores a valid filter only on an editable completed output", async () => {
    const repository = repositoryFake({
      findEditableOutput: jest.fn().mockResolvedValue({ id: "output-1" }),
      findDraft: jest.fn().mockResolvedValue(draftRow),
    });
    const service = makeService(repository);

    await service.updateShotOutputFilter({
      draftId: "draft-1",
      jobId: "job-1",
      mediaId: "media-1",
      filterPreset: "mono-film",
    });

    expect(repository.findEditableOutput).toHaveBeenCalledWith({
      draftId: "draft-1",
      jobId: "job-1",
      mediaId: "media-1",
      draftStatuses: [
        "generating",
        "regenerating",
        "needs_review",
        "approved",
        "failed",
      ],
    });
    expect(repository.updateOutputFilter).toHaveBeenCalledWith(
      "output-1",
      "mono-film",
    );
    expect(repository.markManual).toHaveBeenCalledWith("draft-1");
  });
});
