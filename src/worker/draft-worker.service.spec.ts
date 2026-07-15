import { Logger } from "@nestjs/common";
import {
  DraftWorkerConfig,
  draftWorkerConfigFromEnv,
  DraftWorkerService,
  publishedMemoryContent,
} from "./draft-worker.service";
import { ContentPlanner } from "./content-planner";
import { compileImagePrompt } from "./image-prompt";

const baseConfig: DraftWorkerConfig = {
  enabled: true,
  pollIntervalMs: 15_000,
  planLeaseSeconds: 120,
  maxAttempts: 3,
  maxShots: 2,
  schedulerEnabled: false,
};

type PrismaMock = ReturnType<typeof prismaMock>;

function prismaMock() {
  return {
    postDraft: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "draft-new" }),
      update: jest.fn().mockResolvedValue({}),
    },
    generationJob: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
    },
    characterPostingPolicy: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    post: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "post-1" }),
    },
    characterActionLog: { create: jest.fn().mockResolvedValue({}) },
    characterMemory: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
  };
}

function plannerMock(
  plan = {
    caption: "노을 산책",
    hashtags: ["필름사진"],
    shots: [{ scene: "해변 역광" }, { scene: "카메라 클로즈업" }],
  },
): ContentPlanner & { plan: jest.Mock } {
  return { name: "test-planner", plan: jest.fn().mockResolvedValue(plan) };
}

function makeService(
  prisma: PrismaMock,
  planner: ContentPlanner = plannerMock(),
  config: Partial<DraftWorkerConfig> = {},
  random: () => number = () => 0.5,
) {
  return new DraftWorkerService(
    prisma as never,
    () => Promise.resolve(planner),
    { ...baseConfig, ...config },
    random,
  );
}

function plannedDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft-1",
    characterId: "ai-1",
    status: "generating",
    attemptCount: 1,
    conceptJson: { sceneHint: "애월 해변" },
    character: {
      displayName: "한소이",
      bio: "필름 사진",
      interests: ["필름사진"],
      personas: [{ title: "말투", content: "차분한 존댓말" }],
      memories: [{ content: "제주 애월 여행 (2026-07)" }],
      posts: [{ content: "지난 게시물" }],
      visualProfile: {
        appearancePrompt: "young woman, short hair",
        stylePrompt: "film photography",
      },
    },
    ...overrides,
  };
}

function txMock() {
  return {
    postDraft: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    generationJob: { create: jest.fn().mockResolvedValue({}) },
    post: { create: jest.fn().mockResolvedValue({ id: "post-1" }) },
    characterActionLog: { create: jest.fn().mockResolvedValue({}) },
    characterMemory: { create: jest.fn().mockResolvedValue({}) },
  };
}

describe("draftWorkerConfigFromEnv", () => {
  it("is disabled by default and parses overrides", () => {
    expect(draftWorkerConfigFromEnv({})).toMatchObject({
      enabled: false,
      schedulerEnabled: false,
    });
    expect(
      draftWorkerConfigFromEnv({ DRAFT_SCHEDULER_ENABLED: "true" })
        .schedulerEnabled,
    ).toBe(true);
    expect(
      draftWorkerConfigFromEnv({ DRAFT_SCHEDULER_ENABLED: "1" })
        .schedulerEnabled,
    ).toBe(true);
    expect(
      draftWorkerConfigFromEnv({
        WORKER_ENABLED: "true",
        DRAFT_MAX_SHOTS: "3",
        DRAFT_SCHEDULER_ENABLED: "false",
      }),
    ).toMatchObject({ enabled: true, maxShots: 3, schedulerEnabled: false });
  });
});

describe("DraftWorkerService planning", () => {
  it("plans a claimed draft and creates shot jobs with compiled prompts", async () => {
    const prisma = prismaMock();
    prisma.$queryRaw.mockResolvedValueOnce([{ id: "draft-1" }]);
    prisma.postDraft.findUnique.mockResolvedValue(plannedDraft());
    const tx = txMock();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
    );
    const planner = plannerMock();
    const service = makeService(prisma, planner);

    await service.tick();

    expect(planner.plan).toHaveBeenCalledWith(
      expect.objectContaining({
        characterName: "한소이",
        sceneHint: "애월 해변",
        recentCaptions: ["지난 게시물"],
        maxShots: 2,
      }),
    );
    expect(tx.postDraft.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "draft-1", status: "generating" },
        data: expect.objectContaining({
          caption: "노을 산책",
          hashtags: ["필름사진"],
          leaseExpiresAt: null,
        }),
      }),
    );
    expect(tx.generationJob.create).toHaveBeenCalledTimes(2);
    expect(tx.generationJob.create).toHaveBeenCalledWith({
      data: {
        characterId: "ai-1",
        mediaType: "image",
        prompt: "young woman, short hair, 해변 역광, film photography",
        draftId: "draft-1",
        sortOrder: 0,
        // 장면 원문은 프롬프트 추적용 메타데이터로 저장된다.
        paramsJson: { _shot: { scene: "해변 역광" } },
      },
    });
    expect(tx.characterActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actionType: "DRAFT_PLANNED" }),
    });
  });

  it("returns the draft to planned on a planning failure with attempts left", async () => {
    const prisma = prismaMock();
    prisma.$queryRaw.mockResolvedValueOnce([{ id: "draft-1" }]);
    prisma.postDraft.findUnique.mockResolvedValue(
      plannedDraft({ attemptCount: 1 }),
    );
    const planner = plannerMock();
    planner.plan.mockRejectedValue(new Error("LLM timeout"));
    const service = makeService(prisma, planner);

    await service.tick();

    expect(prisma.postDraft.updateMany).toHaveBeenCalledWith({
      where: { id: "draft-1", status: "generating" },
      data: {
        status: "planned",
        errorMessage: "LLM timeout",
        leaseExpiresAt: null,
      },
    });
  });

  it("logs planning failures as errors with the original stack trace", async () => {
    const prisma = prismaMock();
    prisma.$queryRaw.mockResolvedValueOnce([{ id: "draft-1" }]);
    prisma.postDraft.findUnique.mockResolvedValue(plannedDraft());
    const planningError = new Error("fetch failed");
    const planner = plannerMock();
    planner.plan.mockRejectedValue(planningError);
    const errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation();
    const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    const service = makeService(prisma, planner);

    await service.tick();

    expect(errorSpy).toHaveBeenCalledWith(
      "Draft draft-1 planning failed: fetch failed",
      planningError.stack,
    );
    expect(warnSpy).not.toHaveBeenCalledWith(
      "Draft draft-1 planning failed: fetch failed",
    );
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("fails the draft when planning attempts are exhausted", async () => {
    const prisma = prismaMock();
    prisma.$queryRaw.mockResolvedValueOnce([{ id: "draft-1" }]);
    prisma.postDraft.findUnique.mockResolvedValue(
      plannedDraft({ attemptCount: 3 }),
    );
    const planner = plannerMock();
    planner.plan.mockRejectedValue(new Error("LLM down"));
    const service = makeService(prisma, planner);

    await service.tick();

    expect(prisma.postDraft.updateMany).toHaveBeenCalledWith({
      where: { id: "draft-1", status: "generating" },
      data: {
        status: "failed",
        errorMessage: "LLM down",
        leaseExpiresAt: null,
      },
    });
    expect(prisma.characterActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actionType: "DRAFT_FAILED" }),
    });
  });
});

describe("DraftWorkerService aggregation", () => {
  it("moves a draft to needs_review when the latest job per shot completed", async () => {
    const prisma = prismaMock();
    prisma.postDraft.findMany.mockResolvedValueOnce([
      {
        id: "draft-1",
        characterId: "ai-1",
        status: "generating",
        // 최신순 정렬: shot 0은 재생성 completed가 옛 failed를 대체
        jobs: [
          { sortOrder: 0, status: "completed" },
          { sortOrder: 1, status: "completed" },
          { sortOrder: 0, status: "failed" },
        ],
      },
    ]);
    const service = makeService(prisma);

    await service.tick();

    expect(prisma.postDraft.updateMany).toHaveBeenCalledWith({
      where: { id: "draft-1", status: "generating" },
      data: { status: "needs_review", errorMessage: null },
    });
    expect(prisma.characterActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actionType: "DRAFT_READY_FOR_REVIEW" }),
    });
  });

  it("fails the draft when a latest shot job failed", async () => {
    const prisma = prismaMock();
    prisma.postDraft.findMany.mockResolvedValueOnce([
      {
        id: "draft-1",
        characterId: "ai-1",
        status: "generating",
        jobs: [
          { sortOrder: 0, status: "failed" },
          { sortOrder: 1, status: "completed" },
        ],
      },
    ]);
    const service = makeService(prisma);

    await service.tick();

    expect(prisma.postDraft.updateMany).toHaveBeenCalledWith({
      where: { id: "draft-1", status: "generating" },
      data: {
        status: "failed",
        errorMessage: "one or more shots failed to generate",
      },
    });
  });

  it("leaves a draft alone while shots are still running", async () => {
    const prisma = prismaMock();
    prisma.postDraft.findMany.mockResolvedValueOnce([
      {
        id: "draft-1",
        characterId: "ai-1",
        status: "generating",
        jobs: [
          { sortOrder: 0, status: "completed" },
          { sortOrder: 1, status: "running" },
        ],
      },
    ]);
    const service = makeService(prisma);

    await service.tick();

    const transitions = prisma.postDraft.updateMany.mock.calls.filter(
      ([args]: [{ where: { id?: string } }]) => args.where.id === "draft-1",
    );
    expect(transitions).toHaveLength(0);
  });
});

describe("DraftWorkerService publishing", () => {
  it("publishes a due approved draft with ordered media, hashtags, and memory", async () => {
    const prisma = prismaMock();
    // publishDueDrafts 조회 (aggregation 조회는 첫 호출)
    prisma.postDraft.findMany
      .mockResolvedValueOnce([]) // aggregation
      .mockResolvedValueOnce([
        {
          id: "draft-1",
          characterId: "ai-1",
          contentType: "feed",
          caption: "노을 산책",
          hashtags: ["#필름사진", "여행"],
          conceptJson: { plan: { shots: [{ scene: "해변 역광" }] } },
        },
      ]);
    prisma.generationJob.findMany.mockResolvedValue([
      { sortOrder: 1, status: "completed", outputMediaId: "media-b" },
      { sortOrder: 0, status: "completed", outputMediaId: "media-a" },
    ]);
    const tx = txMock();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
    );
    const service = makeService(prisma);

    await service.tick();

    expect(tx.postDraft.updateMany).toHaveBeenCalledWith({
      where: { id: "draft-1", status: "approved" },
      data: { status: "published", errorMessage: null },
    });
    expect(tx.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          characterId: "ai-1",
          content: "노을 산책",
          hashtags: {
            create: [
              {
                hashtag: {
                  connectOrCreate: {
                    where: { name: "필름사진" },
                    create: { name: "필름사진" },
                  },
                },
              },
              {
                hashtag: {
                  connectOrCreate: {
                    where: { name: "여행" },
                    create: { name: "여행" },
                  },
                },
              },
            ],
          },
          postMedia: {
            create: [
              { sortOrder: 0, media: { connect: { id: "media-a" } } },
              { sortOrder: 1, media: { connect: { id: "media-b" } } },
            ],
          },
        }),
      }),
    );
    expect(tx.postDraft.update).toHaveBeenCalledWith({
      where: { id: "draft-1" },
      data: { publishedPostId: "post-1" },
    });
    expect(tx.characterMemory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        characterId: "ai-1",
        reason: "auto: post published from draft",
      }),
    });
  });

  it("records an error when a shot has no completed output", async () => {
    const prisma = prismaMock();
    prisma.postDraft.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "draft-1",
        characterId: "ai-1",
        contentType: "feed",
        caption: "c",
        hashtags: [],
        conceptJson: null,
      },
    ]);
    prisma.generationJob.findMany.mockResolvedValue([
      { sortOrder: 0, status: "running", outputMediaId: null },
    ]);
    const service = makeService(prisma);

    await service.tick();

    expect(prisma.postDraft.updateMany).toHaveBeenCalledWith({
      where: { id: "draft-1", status: "approved" },
      data: {
        errorMessage: expect.stringContaining("no completed output"),
      },
    });
  });

  it("does not auto-publish manual-mode approved drafts", async () => {
    const prisma = prismaMock();
    prisma.postDraft.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "draft-manual",
        characterId: "ai-1",
        contentType: "feed",
        caption: "노을 산책",
        hashtags: ["필름사진"],
        conceptJson: { source: "manual", mode: "manual" },
      },
    ]);
    const tx = txMock();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
    );
    const service = makeService(prisma);

    await service.tick();

    // 수동 진행 초안은 "지금 게시" 버튼 전용 — 자동 게시에서 제외된다.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.post.create).not.toHaveBeenCalled();
  });
});

describe("DraftWorkerService manual triggers", () => {
  it("planDraftNow claims a planned draft of an active character and plans it", async () => {
    const prisma = prismaMock();
    prisma.postDraft.findUnique.mockResolvedValue(plannedDraft());
    const tx = txMock();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
    );
    const planner = plannerMock();
    const service = makeService(prisma, planner);

    const result = await service.planDraftNow("draft-1");

    expect(result).toEqual({ planned: true });
    expect(prisma.postDraft.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "draft-1",
          status: "planned",
          draftType: "post",
          character: { status: "active" },
        },
        data: expect.objectContaining({
          status: "generating",
          attemptCount: { increment: 1 },
        }),
      }),
    );
    expect(planner.plan).toHaveBeenCalledWith(
      expect.objectContaining({ sceneHint: "애월 해변" }),
    );
    expect(tx.generationJob.create).toHaveBeenCalledTimes(2);
  });

  it("planDraftNow does not plan when the draft is not claimable", async () => {
    const prisma = prismaMock();
    prisma.postDraft.updateMany.mockResolvedValue({ count: 0 });
    const planner = plannerMock();
    const service = makeService(prisma, planner);

    const result = await service.planDraftNow("draft-1");

    expect(result).toEqual({ planned: false });
    expect(planner.plan).not.toHaveBeenCalled();
  });

  it("planDraftNow keeps manual-mode shots in draft status and preserves concept + planInput", async () => {
    const prisma = prismaMock();
    prisma.postDraft.findUnique.mockResolvedValue(
      plannedDraft({
        conceptJson: {
          source: "manual",
          mode: "manual",
          sceneHint: "애월 해변",
        },
      }),
    );
    const tx = txMock();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
    );
    const service = makeService(prisma, plannerMock());

    const result = await service.planDraftNow("draft-1");

    expect(result).toEqual({ planned: true });
    // 수동 진행 컷 잡은 status "draft"로 만들어 생성 워커가 자동으로 집지 않는다.
    expect(tx.generationJob.create).toHaveBeenCalledTimes(2);
    expect(tx.generationJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "draft",
        sortOrder: 0,
        paramsJson: { _shot: { scene: "해변 역광" } },
      }),
    });
    // source/mode는 보존하고 기획 입력 스냅샷(planInput)을 기록한다.
    const conceptJson = tx.postDraft.updateMany.mock.calls[0][0].data
      .conceptJson as Record<string, unknown>;
    expect(conceptJson).toMatchObject({
      source: "manual",
      mode: "manual",
      sceneHint: "애월 해변",
      plannerName: "test-planner",
      planInput: expect.objectContaining({
        personas: [{ title: "말투", content: "차분한 존댓말" }],
        memories: ["제주 애월 여행 (2026-07)"],
        recentCaptions: ["지난 게시물"],
        sceneHint: "애월 해변",
      }),
    });
    expect(conceptJson.plan).toBeDefined();
  });

  it("publishDraftNow publishes an approved draft regardless of scheduledAt", async () => {
    const prisma = prismaMock();
    prisma.postDraft.findFirst.mockResolvedValue({
      id: "draft-1",
      characterId: "ai-1",
      contentType: "feed",
      caption: "노을 산책",
      hashtags: ["필름사진"],
      conceptJson: null,
    });
    prisma.generationJob.findMany.mockResolvedValue([
      { sortOrder: 0, status: "completed", outputMediaId: "media-a" },
    ]);
    const tx = txMock();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
    );
    const service = makeService(prisma);

    const result = await service.publishDraftNow("draft-1");

    expect(result).toEqual({ published: true });
    expect(prisma.postDraft.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "draft-1",
          status: "approved",
          draftType: "post",
          character: { status: "active" },
        },
      }),
    );
    expect(tx.post.create).toHaveBeenCalled();
  });

  it("publishDraftNow reports the reason and records it when publish fails", async () => {
    const prisma = prismaMock();
    prisma.postDraft.findFirst.mockResolvedValue({
      id: "draft-1",
      characterId: "ai-1",
      contentType: "feed",
      caption: "c",
      hashtags: [],
      conceptJson: null,
    });
    prisma.generationJob.findMany.mockResolvedValue([
      { sortOrder: 0, status: "running", outputMediaId: null },
    ]);
    const service = makeService(prisma);

    const result = await service.publishDraftNow("draft-1");

    expect(result.published).toBe(false);
    expect(result.reason).toContain("no completed output");
    expect(prisma.postDraft.updateMany).toHaveBeenCalledWith({
      where: { id: "draft-1", status: "approved" },
      data: { errorMessage: expect.stringContaining("no completed output") },
    });
  });

  it("publishDraftNow refuses drafts that are not approved", async () => {
    const prisma = prismaMock();
    prisma.postDraft.findFirst.mockResolvedValue(null);
    const service = makeService(prisma);

    const result = await service.publishDraftNow("draft-1");

    expect(result).toEqual({ published: false });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("DraftWorkerService scheduler", () => {
  const policy = {
    characterId: "ai-1",
    weeklyCadence: 7, // 매일
    hourStartKst: 18,
    hourEndKst: 22,
  };

  it("creates a planned draft when no pending draft exists and interval elapsed", async () => {
    const prisma = prismaMock();
    prisma.characterPostingPolicy.findMany.mockResolvedValue([policy]);
    prisma.postDraft.findFirst
      .mockResolvedValueOnce(null) // pending 없음
      .mockResolvedValueOnce({
        scheduledAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      });
    const service = makeService(prisma, plannerMock(), {
      schedulerEnabled: true,
    });

    await service.tick();

    expect(prisma.postDraft.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        characterId: "ai-1",
        conceptJson: { source: "scheduler" },
        scheduledAt: expect.any(Date),
      }),
    });
    const scheduledAt: Date =
      prisma.postDraft.create.mock.calls[0][0].data.scheduledAt;
    // KST 시간창(18~22시) 검증
    const kstHour = (scheduledAt.getUTCHours() + 9) % 24;
    expect(kstHour).toBeGreaterThanOrEqual(18);
    expect(kstHour).toBeLessThan(22);
  });

  it("skips characters with a pending draft", async () => {
    const prisma = prismaMock();
    prisma.characterPostingPolicy.findMany.mockResolvedValue([policy]);
    prisma.postDraft.findFirst.mockResolvedValueOnce({ id: "draft-pending" });
    const service = makeService(prisma, plannerMock(), {
      schedulerEnabled: true,
    });

    await service.tick();

    expect(prisma.postDraft.create).not.toHaveBeenCalled();
  });

  it("skips characters whose posting interval has not elapsed", async () => {
    const prisma = prismaMock();
    prisma.characterPostingPolicy.findMany.mockResolvedValue([
      { ...policy, weeklyCadence: 1 }, // 주 1회
    ]);
    prisma.postDraft.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        scheduledAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 하루 전
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });
    const service = makeService(prisma, plannerMock(), {
      schedulerEnabled: true,
    });

    await service.tick();

    expect(prisma.postDraft.create).not.toHaveBeenCalled();
  });
});

describe("helpers", () => {
  it("compiles shot prompts like the visual profile test generation", () => {
    expect(
      compileImagePrompt({ appearancePrompt: "a", stylePrompt: "s" }, "scene"),
    ).toBe("a, scene, s");
    expect(compileImagePrompt(null, "scene")).toBe("scene");
  });

  it("builds published memory content with scenes", () => {
    const content = publishedMemoryContent("노을 산책", {
      plan: { shots: [{ scene: "해변" }, { scene: "골목" }, { scene: "셋" }] },
    });
    expect(content).toContain('게시: "노을 산책"');
    expect(content).toContain("해변 / 골목");
    expect(content).not.toContain("셋");
  });
});
