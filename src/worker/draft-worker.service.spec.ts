import {
  DraftWorkerConfig,
  DraftWorkerService,
  publishedMemoryContent,
  selectedPublishedMemories,
} from "./draft-worker.service";
import { ContentPlanner } from "./content-planner";
import { ImagePromptBuilder } from "./image-prompt-builder";

const baseConfig: DraftWorkerConfig = {
  pollIntervalMs: 15_000,
  planLeaseSeconds: 120,
  maxAttempts: 3,
  maxShots: 2,
  schedulerEnabled: false,
};

type RepositoryFake = ReturnType<typeof repositoryFake>;

function repositoryFake() {
  return {
    claimDraftNow: jest.fn().mockResolvedValue(true),
    findApprovedDraft: jest.fn().mockResolvedValue(null),
    recordPublishError: jest.fn().mockResolvedValue(undefined),
    findAggregateDraft: jest.fn().mockResolvedValue(null),
    findPromptBuildDraft: jest.fn().mockResolvedValue(null),
    findDraftImageJobs: jest.fn().mockResolvedValue([]),
    persistBuiltPrompts: jest.fn().mockResolvedValue(undefined),
    sweepExpiredV3Leases: jest
      .fn()
      .mockResolvedValue({ requeued: 0, failed: 0 }),
    sweepExpiredPlanLeases: jest.fn().mockResolvedValue(0),
    claimPlannedDraft: jest.fn().mockResolvedValue(undefined),
    findPlannedDraft: jest.fn().mockResolvedValue(null),
    findAvailableLocations: jest.fn().mockResolvedValue([]),
    extendPlanLease: jest.fn().mockResolvedValue(undefined),
    persistPlan: jest.fn().mockResolvedValue(undefined),
    failPlanning: jest.fn().mockResolvedValue(true),
    requeuePlanning: jest.fn().mockResolvedValue(undefined),
    findGeneratingDrafts: jest.fn().mockResolvedValue([]),
    requeueDraftWithoutJobs: jest.fn().mockResolvedValue(undefined),
    failGeneratedDraft: jest.fn().mockResolvedValue(true),
    markDraftNeedsReview: jest.fn().mockResolvedValue(true),
    markDraftCaptionPending: jest.fn().mockResolvedValue(true),
    findDueDrafts: jest.fn().mockResolvedValue([]),
    recordPublishFailure: jest.fn().mockResolvedValue(undefined),
    findPublishJobs: jest.fn().mockResolvedValue([]),
    persistPublishedPost: jest.fn().mockResolvedValue(undefined),
    findMediaForFinish: jest.fn().mockResolvedValue(null),
    findEnabledPostingPolicies: jest.fn().mockResolvedValue([]),
    findPendingDraft: jest.fn().mockResolvedValue(null),
    findLastDraft: jest.fn().mockResolvedValue(null),
    findLastPost: jest.fn().mockResolvedValue(null),
    createScheduledDraft: jest.fn().mockResolvedValue(true),
    recordActionLog: jest.fn().mockResolvedValue(undefined),
  };
}

function planner(
  overrides: Partial<ContentPlanner> = {},
): ContentPlanner & { plan: jest.Mock } {
  return {
    name: "test-planner",
    plan: jest.fn().mockResolvedValue({
      caption: "오늘의 산책",
      hashtags: ["산책", "서울"],
      shots: [
        {
          sortOrder: 0,
          scene: "한강 산책로",
          captureSetup: "eye-level medium shot",
          characterVisible: true,
          referenceIds: ["reference-1"],
          environmentReferenceIds: [],
        },
      ],
    }),
    ...overrides,
  } as ContentPlanner & { plan: jest.Mock };
}

function promptBuilder(): ImagePromptBuilder & { build: jest.Mock } {
  return {
    name: "test-builder",
    targetModelIds: { t2i: "t2i-model", edit: "edit-model" },
    build: jest.fn().mockResolvedValue({ prompts: ["built prompt"] }),
  };
}

function plannedDraft(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "draft-1",
    characterId: "character-1",
    status: "generating",
    attemptCount: 1,
    conceptJson: { sceneHint: "강변" },
    character: {
      displayName: "하나",
      bio: "산책을 좋아한다",
      interests: ["사진"],
      personas: [],
      memories: [],
      posts: [],
      visualProfile: {
        appearancePrompt: "same woman",
        stylePrompt: "film photo",
        referenceMedia: [
          {
            mediaId: "reference-1",
            description: "front portrait",
            media: { uploadedAt: new Date("2026-07-01T00:00:00.000Z") },
          },
        ],
      },
    },
    ...overrides,
  };
}

function makeService(
  repository: RepositoryFake,
  contentPlanner = planner(),
  // 자동 루프 on/off는 이제 config가 아니라 DB 설정이지만, 테스트에서는 같은
  // 자리에서 켜고 끄는 편이 읽기 쉽다.
  {
    enabled = true,
    pipelineV3Enabled = false,
    ...config
  }: Partial<DraftWorkerConfig> & {
    enabled?: boolean;
    pipelineV3Enabled?: boolean;
  } = {},
  builder = promptBuilder(),
  random = () => 0.5,
  store = jest.fn().mockResolvedValue({
    url: "https://cdn.local/finished.png",
    storageKey: "finished/image.png",
  }),
  finishImage = jest.fn().mockResolvedValue({
    bytes: Buffer.from("finished"),
    contentType: "image/png",
    width: 100,
    height: 200,
  }),
  downloadBytes = jest.fn().mockResolvedValue(Buffer.from("source")),
) {
  return new DraftWorkerService(
    repository as never,
    () => Promise.resolve(contentPlanner),
    () => Promise.resolve(builder),
    () => Promise.resolve(enabled),
    { ...baseConfig, ...config },
    random,
    store,
    null,
    finishImage,
    downloadBytes,
    () => Promise.resolve(pipelineV3Enabled),
  );
}

describe("DraftWorkerService planning", () => {
  it("persists a validated plan and built prompt through the repository", async () => {
    const repository = repositoryFake();
    repository.claimPlannedDraft
      .mockResolvedValueOnce("draft-1")
      .mockResolvedValueOnce(undefined);
    repository.findPlannedDraft.mockResolvedValue(plannedDraft());
    const service = makeService(repository);

    await service.tick();

    expect(repository.extendPlanLease).toHaveBeenCalledWith("draft-1", 120);
    expect(repository.persistPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        draftId: "draft-1",
        characterId: "character-1",
        caption: "오늘의 산책",
        hashtags: ["산책", "서울"],
        plannerName: "test-planner",
        builderName: "test-builder",
        jobs: [
          expect.objectContaining({
            prompt: "built prompt",
            sortOrder: 0,
            paramsJson: {
              _shot: expect.objectContaining({
                scene: "한강 산책로",
                referenceMediaIds: ["reference-1"],
                targetModelId: "edit-model",
              }),
            },
          }),
        ],
      }),
    );
  });

  it("persists the selected location and combines its references with identity references", async () => {
    const repository = repositoryFake();
    repository.claimPlannedDraft
      .mockResolvedValueOnce("draft-1")
      .mockResolvedValueOnce(undefined);
    repository.findPlannedDraft.mockResolvedValue(plannedDraft());
    repository.findAvailableLocations.mockResolvedValue([
      {
        id: "gym-1",
        displayName: "서린이 다니는 헬스장",
        description: "촬영 친화적인 24시간 헬스장",
        visualPrompt: "warm greige gym with a three-panel mirror",
        negativePrompt: "neon gym",
        references: [
          {
            mediaId: "gym-ref-1",
            description: "전신 거울 구역",
            media: { uploadedAt: new Date("2026-07-01T00:00:00.000Z") },
          },
        ],
      },
    ]);
    const contentPlanner = planner({
      plan: jest.fn().mockResolvedValue({
        caption: "라인 체크",
        hashtags: ["애슬레저"],
        locationId: "gym-1",
        shots: [
          {
            sortOrder: 0,
            scene: "전신 거울 앞의 서린",
            captureSetup: "거울 정면 스마트폰 셀프 촬영",
            characterVisible: true,
            referenceIds: ["reference-1"],
            environmentReferenceIds: ["gym-ref-1"],
          },
        ],
      }),
    });
    const builder = promptBuilder();
    const service = makeService(repository, contentPlanner, {}, builder);

    await service.tick();

    expect(builder.build).toHaveBeenCalledWith(
      expect.objectContaining({
        environmentPrompt: "warm greige gym with a three-panel mirror",
      }),
      expect.anything(),
    );
    expect(repository.persistPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        locationId: "gym-1",
        jobs: [
          expect.objectContaining({
            paramsJson: {
              _shot: expect.objectContaining({
                identityReferenceMediaIds: ["reference-1"],
                environmentReferenceMediaIds: ["gym-ref-1"],
                referenceMediaIds: ["reference-1", "gym-ref-1"],
              }),
            },
          }),
        ],
      }),
    );
  });

  it("fails immediately when a visible shot has no uploaded identity reference", async () => {
    const repository = repositoryFake();
    repository.claimPlannedDraft
      .mockResolvedValueOnce("draft-1")
      .mockResolvedValueOnce(undefined);
    repository.findPlannedDraft.mockResolvedValue(
      plannedDraft({
        character: {
          displayName: "하나",
          bio: "",
          interests: [],
          personas: [],
          memories: [],
          posts: [],
          visualProfile: {
            appearancePrompt: "",
            stylePrompt: "",
            referenceMedia: [],
          },
        },
      }),
    );
    const service = makeService(repository);

    await service.tick();

    expect(repository.persistPlan).not.toHaveBeenCalled();
    expect(repository.failPlanning).toHaveBeenCalledWith(
      "draft-1",
      expect.stringContaining("identity reference"),
    );
    expect(repository.recordActionLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "DRAFT_FAILED" }),
    );
  });

  it("requeues a transient planner failure while attempts remain", async () => {
    const repository = repositoryFake();
    repository.claimPlannedDraft
      .mockResolvedValueOnce("draft-1")
      .mockResolvedValueOnce(undefined);
    repository.findPlannedDraft.mockResolvedValue(plannedDraft());
    const failingPlanner = planner({
      plan: jest.fn().mockRejectedValue(new Error("provider unavailable")),
    });
    const service = makeService(repository, failingPlanner);

    await service.tick();

    expect(repository.requeuePlanning).toHaveBeenCalledWith(
      "draft-1",
      "provider unavailable",
    );
    expect(repository.failPlanning).not.toHaveBeenCalled();
  });

  it("fails a transient planning error after the attempt budget is exhausted", async () => {
    const repository = repositoryFake();
    repository.claimPlannedDraft
      .mockResolvedValueOnce("draft-1")
      .mockResolvedValueOnce(undefined);
    repository.findPlannedDraft.mockResolvedValue(
      plannedDraft({ attemptCount: 3 }),
    );
    const service = makeService(
      repository,
      planner({
        plan: jest.fn().mockRejectedValue(new Error("provider unavailable")),
      }),
    );

    await service.tick();

    expect(repository.failPlanning).toHaveBeenCalledWith(
      "draft-1",
      "provider unavailable",
    );
    expect(repository.requeuePlanning).not.toHaveBeenCalled();
  });

  it("keeps manual-mode shots unqueued for the explicit build step", async () => {
    const repository = repositoryFake();
    repository.findPlannedDraft.mockResolvedValue(
      plannedDraft({ conceptJson: { mode: "manual", source: "admin" } }),
    );
    const builder = promptBuilder();
    const service = makeService(repository, planner(), {}, builder);

    await expect(service.planDraftNow("draft-1")).resolves.toEqual({
      planned: true,
    });

    expect(builder.build).not.toHaveBeenCalled();
    expect(repository.persistPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        conceptJson: expect.objectContaining({
          mode: "manual",
          source: "admin",
          planInput: expect.any(Object),
        }),
        jobs: [
          expect.objectContaining({
            prompt: "",
            status: "draft",
          }),
        ],
      }),
    );
  });

  it("does not run planning when a manual claim loses the state race", async () => {
    const repository = repositoryFake();
    repository.claimDraftNow.mockResolvedValue(false);
    const contentPlanner = planner();
    const service = makeService(repository, contentPlanner);

    await expect(service.planDraftNow("draft-1")).resolves.toEqual({
      planned: false,
    });

    expect(contentPlanner.plan).not.toHaveBeenCalled();
  });
});

describe("DraftWorkerService prompt building", () => {
  it("uses only the newest draft-state job per shot", async () => {
    const repository = repositoryFake();
    repository.findPromptBuildDraft.mockResolvedValue({
      id: "draft-1",
      characterId: "character-1",
      conceptJson: { mode: "manual" },
      character: {
        visualProfile: {
          appearancePrompt: "same woman",
          stylePrompt: "film",
          referenceMedia: [
            {
              mediaId: "reference-1",
              media: { uploadedAt: new Date("2026-07-01") },
            },
          ],
        },
      },
    });
    repository.findDraftImageJobs.mockResolvedValue([
      {
        id: "new",
        sortOrder: 0,
        status: "draft",
        paramsJson: {
          _shot: {
            scene: "new scene",
            captureSetup: "wide",
            characterVisible: true,
            referenceMediaIds: ["reference-1"],
          },
        },
      },
      {
        id: "old",
        sortOrder: 0,
        status: "draft",
        paramsJson: {
          _shot: {
            scene: "old scene",
            captureSetup: "close",
            characterVisible: true,
          },
        },
      },
    ]);
    const service = makeService(repository);

    await expect(service.buildDraftPromptsNow("draft-1")).resolves.toEqual({
      built: true,
    });

    expect(repository.persistBuiltPrompts).toHaveBeenCalledWith(
      expect.objectContaining({
        jobs: [expect.objectContaining({ id: "new", prompt: "built prompt" })],
      }),
    );
  });

  it("returns the repository transaction failure without claiming success", async () => {
    const repository = repositoryFake();
    repository.findPromptBuildDraft.mockResolvedValue({
      id: "draft-1",
      characterId: "character-1",
      conceptJson: {},
      character: {
        visualProfile: {
          appearancePrompt: "",
          stylePrompt: "",
          referenceMedia: [],
        },
      },
    });
    repository.findDraftImageJobs.mockResolvedValue([
      {
        id: "job-1",
        sortOrder: 0,
        status: "draft",
        paramsJson: {
          _shot: {
            scene: "empty room",
            captureSetup: "wide",
            characterVisible: false,
          },
        },
      },
    ]);
    repository.persistBuiltPrompts.mockRejectedValue(
      new Error("shot 0 left draft state during prompt build"),
    );
    const service = makeService(repository);

    await expect(service.buildDraftPromptsNow("draft-1")).resolves.toEqual({
      built: false,
      reason: "shot 0 left draft state during prompt build",
    });
  });

  it("rejects a visible shot whose uploaded reference disappeared", async () => {
    const repository = repositoryFake();
    repository.findPromptBuildDraft.mockResolvedValue({
      id: "draft-1",
      characterId: "character-1",
      conceptJson: {},
      character: {
        visualProfile: {
          appearancePrompt: "",
          stylePrompt: "",
          referenceMedia: [
            {
              mediaId: "reference-1",
              media: { uploadedAt: null },
            },
          ],
        },
      },
    });
    repository.findDraftImageJobs.mockResolvedValue([
      {
        id: "job-1",
        sortOrder: 0,
        status: "draft",
        paramsJson: {
          _shot: {
            scene: "portrait",
            captureSetup: "close",
            characterVisible: true,
            referenceMediaIds: ["reference-1"],
          },
        },
      },
    ]);
    const service = makeService(repository);

    await expect(service.buildDraftPromptsNow("draft-1")).resolves.toEqual({
      built: false,
      reason: expect.stringContaining("identity reference"),
    });
    expect(repository.persistBuiltPrompts).not.toHaveBeenCalled();
  });
});

describe("DraftWorkerService automatic loop toggle", () => {
  // draft 워커는 생성 워커와 같은 토글을 공유한다. 여기서 새면 화면에서 끈
  // 자동 기획·게시가 계속 돈다.
  it("does nothing while the automatic loop is switched off", async () => {
    const repository = repositoryFake();
    repository.findGeneratingDrafts.mockResolvedValue([
      {
        id: "draft-1",
        characterId: "character-1",
        status: "generating",
        jobs: [],
      },
    ]);

    await makeService(repository, planner(), { enabled: false }).tick();

    expect(repository.sweepExpiredPlanLeases).not.toHaveBeenCalled();
    expect(repository.findGeneratingDrafts).not.toHaveBeenCalled();
    expect(repository.requeueDraftWithoutJobs).not.toHaveBeenCalled();
  });

  // 수동 실행은 토글과 무관해야 한다 — 운영자가 타이밍만 정하는 경로다.
  it("still plans a draft manually while the automatic loop is off", async () => {
    const repository = repositoryFake();
    repository.findPlannedDraft.mockResolvedValue(plannedDraft());
    const service = makeService(repository, planner(), { enabled: false });

    await expect(service.planDraftNow("draft-1")).resolves.toEqual({
      planned: true,
    });
    expect(repository.persistPlan).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: "draft-1", caption: "오늘의 산책" }),
    );
  });
});

describe("DraftWorkerService aggregation", () => {
  it("returns an empty generating draft to planning", async () => {
    const repository = repositoryFake();
    repository.findGeneratingDrafts.mockResolvedValue([
      {
        id: "draft-1",
        characterId: "character-1",
        status: "generating",
        jobs: [],
      },
    ]);
    const service = makeService(repository);

    await service.tick();

    expect(repository.requeueDraftWithoutJobs).toHaveBeenCalledWith(
      "draft-1",
      "generating",
    );
  });

  it("moves a draft to review only when every latest shot completed", async () => {
    const repository = repositoryFake();
    repository.findGeneratingDrafts.mockResolvedValue([
      {
        id: "draft-1",
        characterId: "character-1",
        status: "regenerating",
        jobs: [
          { sortOrder: 0, status: "completed" },
          { sortOrder: 0, status: "failed" },
          { sortOrder: 1, status: "completed" },
        ],
      },
    ]);
    const service = makeService(repository);

    await service.tick();

    expect(repository.markDraftNeedsReview).toHaveBeenCalledWith(
      "draft-1",
      "regenerating",
    );
    expect(repository.recordActionLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "DRAFT_READY_FOR_REVIEW" }),
    );
  });

  // V4: 검수 없음 — 컷이 다 나오면 ⑥ 캡션 단계(planned+pending)로 간다.
  // v3 draft가 needs_review로 가는 위 테스트와 짝이다: 버전으로만 갈린다.
  it("moves a V4 draft to the caption stage instead of review", async () => {
    const repository = repositoryFake();
    repository.findGeneratingDrafts.mockResolvedValue([
      {
        id: "draft-1",
        characterId: "character-1",
        status: "generating",
        conceptJson: {
          pipelineVersion: "post-pipeline-v4",
          mode: "auto",
          pipeline: { stage: "generation", state: "ready", imageCount: 1 },
        },
        jobs: [{ sortOrder: 0, status: "completed" }],
      },
    ]);
    const service = makeService(repository);

    await service.tick();

    expect(repository.markDraftNeedsReview).not.toHaveBeenCalled();
    expect(repository.markDraftCaptionPending).toHaveBeenCalledWith(
      "draft-1",
      "generating",
      expect.objectContaining({
        pipelineVersion: "post-pipeline-v4",
        pipeline: expect.objectContaining({
          stage: "caption",
          state: "pending",
          imageCount: 1,
        }),
      }),
    );
    expect(repository.recordActionLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "DRAFT_V3_IMAGES_READY" }),
    );
  });

  it("marks the draft failed when a latest shot failed", async () => {
    const repository = repositoryFake();
    repository.findGeneratingDrafts.mockResolvedValue([
      {
        id: "draft-1",
        characterId: "character-1",
        status: "generating",
        jobs: [{ sortOrder: 0, status: "failed" }],
      },
    ]);
    const service = makeService(repository);

    await service.tick();

    expect(repository.failGeneratedDraft).toHaveBeenCalledWith(
      "draft-1",
      "generating",
      "one or more shots failed to generate",
    );
  });

  it("reports a manual aggregation as pending while a latest shot is running", async () => {
    const repository = repositoryFake();
    repository.findAggregateDraft.mockResolvedValue({
      id: "draft-1",
      characterId: "character-1",
      status: "generating",
      jobs: [{ sortOrder: 0, status: "running" }],
    });
    const service = makeService(repository);

    await expect(service.aggregateDraftNow("draft-1")).resolves.toEqual({
      aggregated: false,
      reason: "Some shots have not completed yet",
    });
    expect(repository.markDraftNeedsReview).not.toHaveBeenCalled();
    expect(repository.failGeneratedDraft).not.toHaveBeenCalled();
  });
});

describe("DraftWorkerService publishing", () => {
  it("publishes ordered latest outputs with normalized hashtags and memory", async () => {
    const repository = repositoryFake();
    repository.findDueDrafts.mockResolvedValue([
      {
        id: "draft-1",
        characterId: "character-1",
        contentType: "photo",
        caption: "산책",
        hashtags: ["#서울", "  사진  ", ""],
        conceptJson: {},
      },
    ]);
    repository.findPublishJobs.mockResolvedValue([
      {
        sortOrder: 1,
        status: "completed",
        outputMediaId: "media-b",
        outputs: [],
      },
      {
        sortOrder: 0,
        status: "completed",
        outputMediaId: "media-a",
        outputs: [],
      },
    ]);
    const service = makeService(repository);

    await service.tick();

    expect(repository.persistPublishedPost).toHaveBeenCalledWith(
      expect.objectContaining({
        draftId: "draft-1",
        hashtags: ["서울", "사진"],
        media: [
          { originalMediaId: "media-a", finishedFile: null },
          { originalMediaId: "media-b", finishedFile: null },
        ],
        memoryContent: expect.stringContaining('게시: "산책"'),
      }),
    );
  });

  it("applies a selected finish before persistence", async () => {
    const repository = repositoryFake();
    repository.findDueDrafts.mockResolvedValue([
      {
        id: "draft-1",
        characterId: "character-1",
        contentType: "photo",
        caption: "산책",
        hashtags: [],
        conceptJson: {},
      },
    ]);
    repository.findPublishJobs.mockResolvedValue([
      {
        sortOrder: 0,
        status: "completed",
        outputMediaId: "media-a",
        outputs: [{ mediaId: "media-a", filterPreset: "film" }],
      },
    ]);
    repository.findMediaForFinish.mockResolvedValue({
      mediaType: "image",
      url: "https://cdn.local/source.png",
      storageKey: null,
    });
    const store = jest.fn().mockResolvedValue({
      url: "https://cdn.local/finished.png",
      storageKey: "finished.png",
    });
    const service = makeService(
      repository,
      planner(),
      {},
      promptBuilder(),
      () => 0.5,
      store,
    );

    await service.tick();

    expect(store).toHaveBeenCalled();
    expect(repository.persistPublishedPost).toHaveBeenCalledWith(
      expect.objectContaining({
        media: [
          expect.objectContaining({
            originalMediaId: "media-a",
            finishedFile: expect.objectContaining({
              url: "https://cdn.local/finished.png",
            }),
          }),
        ],
      }),
    );
  });

  it("records an automated publish failure and continues the batch", async () => {
    const repository = repositoryFake();
    repository.findDueDrafts.mockResolvedValue([
      {
        id: "draft-broken",
        characterId: "character-1",
        contentType: "photo",
        caption: "본문은 있으나 미디어가 없다",
        hashtags: [],
        conceptJson: {},
      },
      {
        id: "draft-good",
        characterId: "character-1",
        contentType: "photo",
        caption: "ok",
        hashtags: [],
        conceptJson: {},
      },
    ]);
    repository.findPublishJobs.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        sortOrder: 0,
        status: "completed",
        outputMediaId: "media-a",
        outputs: [],
      },
    ]);
    const service = makeService(repository);

    await service.tick();

    expect(repository.recordPublishFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        draftId: "draft-broken",
        message: "draft has no generated media to publish",
      }),
    );
    expect(repository.persistPublishedPost).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: "draft-good" }),
    );
  });

  // V4는 ⑥ 캡션 단계 없이 ⑦에 오는 경로가 없어야 하지만, 본문 없는 게시물은
  // 되돌릴 수 없으므로 게시 직전에 한 번 더 막는다(아키텍처 §20.4).
  it("refuses to publish a draft whose caption is empty", async () => {
    const repository = repositoryFake();
    repository.findDueDrafts.mockResolvedValue([
      {
        id: "draft-empty",
        characterId: "character-1",
        contentType: "photo",
        caption: "   ",
        hashtags: [],
        conceptJson: {},
      },
    ]);
    const service = makeService(repository);

    await service.tick();

    expect(repository.findPublishJobs).not.toHaveBeenCalled();
    expect(repository.persistPublishedPost).not.toHaveBeenCalled();
    expect(repository.recordPublishFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        draftId: "draft-empty",
        message: expect.stringContaining("caption_missing"),
      }),
    );
  });

  it("never auto-publishes a manual-mode draft", async () => {
    const repository = repositoryFake();
    repository.findDueDrafts.mockResolvedValue([
      {
        id: "draft-1",
        characterId: "character-1",
        contentType: "photo",
        caption: "",
        hashtags: [],
        conceptJson: { mode: "manual" },
      },
    ]);
    const service = makeService(repository);

    await service.tick();

    expect(repository.findPublishJobs).not.toHaveBeenCalled();
  });

  it("publishes an approved draft immediately regardless of its schedule", async () => {
    const repository = repositoryFake();
    repository.findApprovedDraft.mockResolvedValue({
      id: "draft-1",
      characterId: "character-1",
      contentType: "photo",
      caption: "now",
      hashtags: [],
      conceptJson: { mode: "manual" },
    });
    repository.findPublishJobs.mockResolvedValue([
      {
        sortOrder: 0,
        status: "completed",
        outputMediaId: "media-a",
        outputs: [],
      },
    ]);
    const service = makeService(repository);

    await expect(service.publishDraftNow("draft-1")).resolves.toEqual({
      published: true,
    });
    expect(repository.persistPublishedPost).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: "draft-1" }),
    );
  });

  it("records the reason when immediate publishing fails", async () => {
    const repository = repositoryFake();
    const leaseExpiresAt = new Date("2026-08-20T00:02:00.000Z");
    repository.findApprovedDraft.mockResolvedValue({
      id: "draft-1",
      characterId: "character-1",
      contentType: "photo",
      caption: "now",
      hashtags: [],
      conceptJson: {},
      leaseExpiresAt,
    });
    repository.findPublishJobs.mockResolvedValue([]);
    const service = makeService(repository);

    await expect(service.publishDraftNow("draft-1")).resolves.toEqual({
      published: false,
      reason: "draft has no generated media to publish",
    });
    expect(repository.recordPublishError).toHaveBeenCalledWith(
      "draft-1",
      "draft has no generated media to publish",
      leaseExpiresAt,
    );
  });
});

describe("DraftWorkerService scheduler", () => {
  const policy = {
    characterId: "character-1",
    weeklyCadence: 7,
    hourStartKst: 18,
    hourEndKst: 22,
  };

  it("creates a slot only for an eligible character without pending work", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-31T00:00:00.000Z"));
    const repository = repositoryFake();
    repository.findEnabledPostingPolicies.mockResolvedValue([policy]);
    const service = makeService(
      repository,
      planner(),
      { schedulerEnabled: true, pipelineV3Enabled: true },
      promptBuilder(),
      () => 0.5,
    );

    await service.tick();

    expect(repository.createScheduledDraft).toHaveBeenCalledWith(
      "character-1",
      new Date("2026-07-31T11:00:00.000Z"),
      true,
    );
    expect(repository.recordActionLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "DRAFT_SCHEDULED" }),
    );
    jest.useRealTimers();
  });

  it("skips a character that already has pending work", async () => {
    const repository = repositoryFake();
    repository.findEnabledPostingPolicies.mockResolvedValue([policy]);
    repository.findPendingDraft.mockResolvedValue({ id: "pending" });
    const service = makeService(repository, planner(), {
      schedulerEnabled: true,
    });

    await service.tick();

    expect(repository.createScheduledDraft).not.toHaveBeenCalled();
  });

  it("skips a character whose posting interval has not elapsed", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-31T00:00:00.000Z"));
    const repository = repositoryFake();
    repository.findEnabledPostingPolicies.mockResolvedValue([policy]);
    repository.findLastPost.mockResolvedValue({
      createdAt: new Date("2026-07-30T12:00:00.000Z"),
    });
    const service = makeService(repository, planner(), {
      schedulerEnabled: true,
    });

    await service.tick();

    expect(repository.createScheduledDraft).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});

describe("publishedMemoryContent", () => {
  it("includes planned scenes in the durable memory summary", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-31T00:00:00.000Z"));

    expect(
      publishedMemoryContent("오늘의 산책", {
        plan: { shots: [{ scene: "한강" }, { scene: "카페" }] },
      }),
    ).toBe('2026-07-31 게시: "오늘의 산책" (장면: 한강 / 카페)');

    jest.useRealTimers();
  });
});

describe("selectedPublishedMemories", () => {
  it("keeps only selected candidates from the current PostPlan and deduplicates them", () => {
    expect(
      selectedPublishedMemories({
        pipelineVersion: "post-pipeline-v3",
        postPlanning: { hash: "sha256:current" },
        memoryCandidates: [
          {
            type: "routine",
            content: " 매주 산책한다 ",
            selected: true,
            sourcePostPlanHash: "sha256:current",
          },
          {
            type: "routine",
            content: "매주 산책한다",
            selected: true,
            sourcePostPlanHash: "sha256:current",
          },
          {
            type: "fact",
            content: "stale",
            selected: true,
            sourcePostPlanHash: "sha256:old",
          },
          {
            type: "fact",
            content: "not selected",
            selected: false,
            sourcePostPlanHash: "sha256:current",
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({ type: "routine", content: "매주 산책한다" }),
    ]);
  });

  // 버전을 직접 비교하면 V4 초안이 게시돼도 기억이 하나도 저장되지 않는다 —
  // ⑧ 메모리 단계가 조용히 빈손이 되고, 다음 기획이 세계관을 잃는다.
  it("commits memories for V4 drafts too", () => {
    const concept = {
      postPlanning: { hash: "sha256:current" },
      memoryCandidates: [
        {
          type: "routine",
          content: "월요일마다 필라테스",
          selected: true,
          sourcePostPlanHash: "sha256:current",
        },
      ],
    };
    expect(
      selectedPublishedMemories({
        ...concept,
        pipelineVersion: "post-pipeline-v4",
      }),
    ).toEqual([
      expect.objectContaining({
        content: "월요일마다 필라테스",
        reason: expect.stringContaining("post-pipeline-v4"),
      }),
    ]);
    // V2 draft는 여전히 이 경로를 쓰지 않는다(게시 요약 메모리가 따로 있다).
    expect(selectedPublishedMemories(concept)).toEqual([]);
  });
});
