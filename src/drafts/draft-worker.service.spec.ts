import { naturalAgentBundle } from "../../test/natural-agent-fixture";
import { generationSetHash } from "../post-production/post-pipeline-v3";
import {
  DraftWorkerConfig,
  DraftWorkerService,
  publishedMemoryContent,
  selectedPublishedMemories,
} from "./draft-worker.service";
import { ContentPlanner } from "../post-production/content-planner";
import { ImagePromptBuilder } from "../post-production/image-prompt-builder";

const baseConfig: DraftWorkerConfig = {
  pollIntervalMs: 15_000,
  planLeaseSeconds: 120,
  maxAttempts: 3,
  maxShots: 2,
  schedulerEnabled: false,
  naturalPhotoReviewEnabled: true,
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
    null,
    async () => ({
      postGenerationAgent: "natural-v1",
    }),
  );
}

describe("DraftWorkerService automatic loop toggle", () => {
  it("does not plan or aggregate while the generation loop is switched off", async () => {
    const repository = repositoryFake();
    repository.findGeneratingDrafts.mockResolvedValue([
      {
        id: "draft-1",
        characterId: "character-1",
        status: "generating",
        conceptJson: { postGenerationAgent: "natural-v1" },
        jobs: [],
      },
    ]);

    await makeService(repository, planner(), {
      enabled: false,
      schedulerEnabled: true,
    }).tick();

    expect(repository.sweepExpiredPlanLeases).not.toHaveBeenCalled();
    expect(repository.findEnabledPostingPolicies).not.toHaveBeenCalled();
    expect(repository.sweepExpiredV3Leases).not.toHaveBeenCalled();
    expect(repository.findGeneratingDrafts).not.toHaveBeenCalled();
    expect(repository.requeueDraftWithoutJobs).not.toHaveBeenCalled();
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
        conceptJson: { postGenerationAgent: "natural-v1" },
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
        conceptJson: { postGenerationAgent: "natural-v1" },
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
          postGenerationAgent: "natural-v1",
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
        conceptJson: { postGenerationAgent: "natural-v1" },
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

function acceptedPublishConcept(mediaIds: string[], manual = false) {
  const bundle = naturalAgentBundle();
  const images = mediaIds.map((mediaId, sortOrder) => ({
    sortOrder,
    jobId: `job-${sortOrder}`,
    mediaId,
  }));
  const hash = generationSetHash(images);
  const verdicts = {
    output: {
      shots: images.map(({ sortOrder }) => ({
        sortOrder,
        verdict: "accept",
        observations: ["Coherent photo"],
      })),
    },
  };
  return {
    postGenerationAgent: "natural-v1",
    naturalAgentConfig: bundle,
    ...(manual ? { mode: "manual" } : {}),
    photoReview: {
      status: "accepted",
      configRevision: bundle.revision,
      operatorRequest: null,
      generationSetHash: hash,
      naturalness: verdicts,
      requirements: verdicts,
    },
    captionBuild: { source: { generationSetHash: hash } },
  };
}

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
        conceptJson: acceptedPublishConcept(["media-a", "media-b"]),
      },
    ]);
    repository.findPublishJobs.mockResolvedValue([
      {
        id: "job-1",
        sortOrder: 1,
        status: "completed",
        outputMediaId: "media-b",
        outputs: [],
      },
      {
        id: "job-0",
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
        conceptJson: acceptedPublishConcept(["media-a"]),
      },
    ]);
    repository.findPublishJobs.mockResolvedValue([
      {
        id: "job-0",
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
        conceptJson: acceptedPublishConcept(["media-a"]),
      },
      {
        id: "draft-good",
        characterId: "character-1",
        contentType: "photo",
        caption: "ok",
        hashtags: [],
        conceptJson: acceptedPublishConcept(["media-a"]),
      },
    ]);
    repository.findPublishJobs.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "job-0",
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
        conceptJson: { postGenerationAgent: "natural-v1" },
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
        conceptJson: { postGenerationAgent: "natural-v1", mode: "manual" },
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
      conceptJson: acceptedPublishConcept(["media-a"], true),
    });
    repository.findPublishJobs.mockResolvedValue([
      {
        id: "job-0",
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
      conceptJson: { postGenerationAgent: "natural-v1" },
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
      expect.objectContaining({ postGenerationAgent: "natural-v1" }),
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

describe("natural agent publishing", () => {
  const job = {
    id: "job-a",
    sortOrder: 0,
    status: "completed",
    outputMediaId: "media-a",
    outputs: [],
  };
  function acceptedConcept() {
    const hash = generationSetHash([
      { sortOrder: 0, jobId: "job-a", mediaId: "media-a" },
    ]);
    const output = {
      shots: [
        {
          sortOrder: 0,
          verdict: "accept",
          observations: ["Plausible visible action"],
        },
      ],
    };
    return {
      postGenerationAgent: "natural-v1",
      pipelineVersion: "post-pipeline-v4",
      mode: "auto",
      naturalAgentConfig: naturalAgentBundle(),
      imagePlanning: { hash: "image-plan" },
      promptBuild: { hash: "prompt-build" },
      photoReview: {
        status: "accepted",
        operatorRequest: null,
        configRevision: naturalAgentBundle().revision,
        generationSetHash: hash,
        imagePlanningHash: "image-plan",
        promptBuildHash: "prompt-build",
        naturalness: { output },
        requirements: { output },
      },
      captionBuild: { source: { generationSetHash: hash } },
      postPlanning: { hash: "post-plan" },
      memoryCandidates: [
        {
          selected: true,
          type: "event",
          sourcePostPlanHash: "post-plan",
          content: "Generated event must not become canon",
        },
      ],
    };
  }
  it.each(["missing", "rejected", "stale", "caption-stale", "request-changed"])(
    "prevents manual publishing with %s photo acceptance",
    async (condition) => {
      const repository = repositoryFake();
      const concept = acceptedConcept();
      if (condition === "missing")
        delete (concept as Partial<typeof concept>).photoReview;
      if (condition === "rejected") concept.photoReview.status = "rejected";
      if (condition === "stale")
        concept.photoReview.generationSetHash = "older-images";
      if (condition === "request-changed")
        (
          concept as typeof concept & { operatorRequest: string }
        ).operatorRequest = "new requirement";
      if (condition === "caption-stale")
        concept.captionBuild.source.generationSetHash = "older-images";
      repository.findApprovedDraft.mockResolvedValue({
        id: "draft-1",
        characterId: "character-1",
        contentType: "feed",
        caption: "photo caption",
        hashtags: [],
        conceptJson: concept,
      });
      repository.findPublishJobs.mockResolvedValue([job]);
      const result = await makeService(repository).publishDraftNow("draft-1");
      expect(result.published).toBe(false);
      expect(result.reason).toContain("photo_review_required");
      expect(repository.persistPublishedPost).not.toHaveBeenCalled();
    },
  );
  it.each(["current", "caption-stale", "images-stale", "reenabled"])(
    "honors skipped reviews while preserving image and caption freshness: %s",
    async (condition) => {
      const repository = repositoryFake();
      const concept = acceptedConcept();
      concept.photoReview.status = "skipped";
      Object.assign(concept.photoReview, { reason: "disabled" });
      delete (concept.photoReview as Partial<typeof concept.photoReview>)
        .naturalness;
      delete (concept.photoReview as Partial<typeof concept.photoReview>)
        .requirements;
      if (condition === "caption-stale")
        concept.captionBuild.source.generationSetHash = "older-images";
      if (condition === "images-stale")
        concept.photoReview.generationSetHash = "older-images";
      repository.findApprovedDraft.mockResolvedValue({
        id: "draft-1",
        characterId: "character-1",
        contentType: "feed",
        caption: "photo caption",
        hashtags: [],
        conceptJson: concept,
      });
      repository.findPublishJobs.mockResolvedValue([job]);
      const result = await makeService(repository, undefined, {
        naturalPhotoReviewEnabled: condition === "reenabled",
      }).publishDraftNow("draft-1");
      expect(result.published).toBe(condition === "current");
      if (condition !== "current") {
        expect(result.reason).toContain("photo_review_required");
        expect(repository.persistPublishedPost).not.toHaveBeenCalled();
      }
    },
  );
  it("saves canon only after an explicit operator selection and manual publish", async () => {
    const repository = repositoryFake();
    const concept = acceptedConcept();
    concept.mode = "manual";
    Object.assign(concept.memoryCandidates[0], { selectedByOperator: true });
    repository.findApprovedDraft.mockResolvedValue({
      id: "draft-1",
      characterId: "character-1",
      contentType: "feed",
      caption: "photo caption",
      hashtags: [],
      conceptJson: concept,
    });
    repository.findPublishJobs.mockResolvedValue([job]);
    expect(await makeService(repository).publishDraftNow("draft-1")).toEqual({
      published: true,
    });
    expect(repository.persistPublishedPost.mock.calls[0][0].memories).toEqual([
      expect.objectContaining({
        type: "event",
        content: "Generated event must not become canon",
      }),
    ]);
  });
  it("automatically publishes accepted current images without inserting generated canon", async () => {
    const repository = repositoryFake();
    repository.findDueDrafts.mockResolvedValue([
      {
        id: "draft-1",
        characterId: "character-1",
        contentType: "feed",
        caption: "photo caption",
        hashtags: [],
        conceptJson: acceptedConcept(),
      },
    ]);
    repository.findPublishJobs.mockResolvedValue([job]);
    await makeService(repository).tick();
    expect(repository.persistPublishedPost).toHaveBeenCalledWith(
      expect.objectContaining({
        memories: [],
        media: [{ originalMediaId: "media-a", finishedFile: null }],
      }),
    );
    expect(repository.recordPublishFailure).not.toHaveBeenCalled();
  });
});
