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
