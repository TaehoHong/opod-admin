import { DraftWorkerRepository } from "./draft-worker.repository";

function prismaMock() {
  const tx = {
    postDraft: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    generationJob: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({}),
    },
    media: { create: jest.fn().mockResolvedValue({ id: "finished-media" }) },
    post: { create: jest.fn().mockResolvedValue({ id: "post-1" }) },
    characterActionLog: { create: jest.fn().mockResolvedValue({}) },
    characterMemory: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  return {
    prisma: {
      $queryRaw: jest.fn(),
      postDraft: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    },
    tx,
  };
}

describe("DraftWorkerRepository", () => {
  it("claims planned drafts with a bound lease and skip-locked ordering", async () => {
    const { prisma } = prismaMock();
    prisma.$queryRaw.mockImplementation(
      (strings: TemplateStringsArray, leaseSeconds: number) => {
        expect(strings.join("?")).toContain("FOR UPDATE OF d SKIP LOCKED");
        expect(strings.join("?")).toContain(
          "(d.concept_json->>'mode') IS DISTINCT FROM 'manual'",
        );
        expect(strings.join("?")).toContain(
          "(d.concept_json->>'pipelineVersion') IS DISTINCT FROM ?",
        );
        expect(leaseSeconds).toBe(120);
        return Promise.resolve([{ id: "draft-1" }]);
      },
    );
    const repository = new DraftWorkerRepository(prisma as never);

    await expect(repository.claimPlannedDraft(120)).resolves.toBe("draft-1");
  });

  it("keeps manual drafts out of automatic generation aggregation", async () => {
    const { prisma } = prismaMock();
    prisma.$queryRaw.mockImplementation(
      (strings: TemplateStringsArray, take: number) => {
        expect(strings.join("?")).toContain(
          "(d.concept_json->>'mode') IS DISTINCT FROM 'manual'",
        );
        expect(take).toBe(20);
        return Promise.resolve([]);
      },
    );
    const repository = new DraftWorkerRepository(prisma as never);

    await expect(repository.findGeneratingDrafts(20)).resolves.toEqual([]);
    expect(prisma.postDraft.findMany).not.toHaveBeenCalled();
  });

  it("loads only active character references for planning and prompt building", async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const findFirst = jest.fn().mockResolvedValue(null);
    const repository = new DraftWorkerRepository({
      postDraft: { findUnique, findFirst },
    } as never);

    await repository.findPlannedDraft("draft-1");
    await repository.findPromptBuildDraft("draft-1");

    expect(
      findUnique.mock.calls[0][0].include.character.select.visualProfile.select
        .referenceMedia.where,
    ).toEqual({ isActive: true });
    expect(
      findFirst.mock.calls[0][0].select.character.select.visualProfile.select
        .referenceMedia.where,
    ).toEqual({ isActive: true });
  });

  it("aborts plan persistence when the draft lost generating state", async () => {
    const { prisma, tx } = prismaMock();
    tx.postDraft.updateMany.mockResolvedValue({ count: 0 });
    const repository = new DraftWorkerRepository(prisma as never);

    await expect(
      repository.persistPlan({
        draftId: "draft-1",
        characterId: "character-1",
        caption: "caption",
        hashtags: [],
        conceptJson: {},
        plannerName: "planner",
        jobs: [
          {
            prompt: "prompt",
            sortOrder: 0,
            paramsJson: {},
          },
        ],
      }),
    ).rejects.toThrow("draft left the generating state during planning");
    expect(tx.generationJob.create).not.toHaveBeenCalled();
    expect(tx.characterActionLog.create).not.toHaveBeenCalled();
  });

  it("aborts prompt persistence when any shot left draft state", async () => {
    const { prisma, tx } = prismaMock();
    tx.generationJob.updateMany.mockResolvedValue({ count: 0 });
    const repository = new DraftWorkerRepository(prisma as never);

    await expect(
      repository.persistBuiltPrompts({
        draftId: "draft-1",
        characterId: "character-1",
        builderName: "builder",
        conceptJson: {},
        jobs: [
          {
            id: "job-1",
            sortOrder: 0,
            prompt: "prompt",
            paramsJson: {},
          },
        ],
      }),
    ).rejects.toThrow("shot 0 left draft state during prompt build");
    expect(tx.postDraft.update).not.toHaveBeenCalled();
    expect(tx.characterActionLog.create).not.toHaveBeenCalled();
  });

  it("does not persist or log a V3 artifact after losing its revision CAS", async () => {
    const { prisma, tx } = prismaMock();
    tx.postDraft.updateMany.mockResolvedValue({ count: 0 });
    const repository = new DraftWorkerRepository(prisma as never);

    await expect(
      repository.persistV3Artifact({
        draftId: "draft-1",
        characterId: "character-1",
        expected: {
          stage: "image_plan",
          state: "running",
          artifactKey: "postPlanning",
          revision: 1,
        },
        conceptJson: {
          pipelineVersion: "post-pipeline-v3",
          pipeline: { stage: "image_plan", state: "pending" },
        },
        actionType: "DRAFT_POST_PLAN_READY",
        reason: "post plan revision 2 stored",
      }),
    ).resolves.toBe(false);
    expect(tx.characterActionLog.create).not.toHaveBeenCalled();
  });

  it("persists the first V3 artifact using stage CAS without requiring a missing revision", async () => {
    const { prisma, tx } = prismaMock();
    const repository = new DraftWorkerRepository(prisma as never);

    await expect(
      repository.persistV3Artifact({
        draftId: "draft-1",
        characterId: "character-1",
        expected: {
          stage: "post_plan",
          state: "running",
          artifactKey: "postPlanning",
          revision: null,
        },
        conceptJson: {
          pipelineVersion: "post-pipeline-v3",
          pipeline: { stage: "image_plan", state: "pending" },
          postPlanning: { revision: 1 },
        },
        actionType: "DRAFT_POST_PLAN_READY",
        reason: "post plan revision 1 stored",
      }),
    ).resolves.toBe(true);
    const where = tx.postDraft.updateMany.mock.calls[0][0].where;
    expect(where.AND).toHaveLength(2);
    expect(tx.characterActionLog.create).toHaveBeenCalledTimes(1);
  });

  it("pins scheduled V3 drafts without changing legacy scheduled drafts", async () => {
    const { prisma } = prismaMock();
    const repository = new DraftWorkerRepository(prisma as never);
    const scheduledAt = new Date("2026-08-13T03:00:00.000Z");

    await repository.createScheduledDraft("character-1", scheduledAt, true);
    await repository.createScheduledDraft("character-2", scheduledAt, false);

    expect(
      prisma.postDraft.create.mock.calls[0][0].data.conceptJson,
    ).toMatchObject({
      pipelineVersion: "post-pipeline-v3",
      source: "scheduler",
      mode: "auto",
      pipeline: { stage: "post_plan", state: "pending" },
    });
    expect(prisma.postDraft.create.mock.calls[1][0].data.conceptJson).toEqual({
      source: "scheduler",
    });
  });

  it("does not create a post after an approved-state race is lost", async () => {
    const { prisma, tx } = prismaMock();
    tx.postDraft.updateMany.mockResolvedValue({ count: 0 });
    const repository = new DraftWorkerRepository(prisma as never);

    await expect(
      repository.persistPublishedPost({
        draftId: "draft-1",
        characterId: "character-1",
        contentType: "photo",
        caption: "caption",
        hashtags: [],
        memoryContent: "memory",
        media: [{ originalMediaId: "media-1", finishedFile: null }],
      }),
    ).rejects.toThrow("draft left the approved state before publish");
    expect(tx.post.create).not.toHaveBeenCalled();
    expect(tx.characterMemory.create).not.toHaveBeenCalled();
  });

  it("persists finished and original media in one publish transaction", async () => {
    const { prisma, tx } = prismaMock();
    const repository = new DraftWorkerRepository(prisma as never);

    await repository.persistPublishedPost({
      draftId: "draft-1",
      characterId: "character-1",
      contentType: "photo",
      caption: "caption",
      hashtags: ["서울"],
      memoryContent: "memory",
      media: [
        {
          originalMediaId: "source-media",
          finishedFile: {
            url: "https://cdn.local/finished.png",
            storageKey: "finished.png",
            contentType: "image/png",
            byteSize: 10,
            width: 100,
            height: 200,
          },
        },
        { originalMediaId: "original-media", finishedFile: null },
      ],
    });

    expect(tx.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          hashtags: {
            create: [
              {
                hashtag: {
                  connectOrCreate: {
                    where: { name: "서울" },
                    create: { name: "서울" },
                  },
                },
              },
            ],
          },
          postMedia: {
            create: [
              {
                sortOrder: 0,
                media: { connect: { id: "finished-media" } },
              },
              {
                sortOrder: 1,
                media: { connect: { id: "original-media" } },
              },
            ],
          },
        }),
        select: { id: true },
      }),
    );
    expect(tx.characterMemory.create).toHaveBeenCalledWith({
      data: {
        characterId: "character-1",
        type: "fact",
        content: "memory",
        reason: "auto: post published from draft",
      },
    });
  });

  it("stores selected V3 memories in the publish transaction and skips an existing duplicate", async () => {
    const { prisma, tx } = prismaMock();
    tx.characterMemory.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "existing" });
    const repository = new DraftWorkerRepository(prisma as never);

    await repository.persistPublishedPost({
      draftId: "draft-1",
      characterId: "character-1",
      contentType: "photo",
      caption: "caption",
      hashtags: [],
      memories: [
        { type: "routine", content: "매주 산책한다", reason: "v3" },
        { type: "fact", content: "서울에 산다", reason: "v3" },
      ],
      media: [{ originalMediaId: "media-1", finishedFile: null }],
    });

    expect(tx.characterMemory.create).toHaveBeenCalledTimes(1);
    expect(tx.characterMemory.create).toHaveBeenCalledWith({
      data: {
        characterId: "character-1",
        type: "routine",
        content: "매주 산책한다",
        reason: "v3",
      },
    });
  });
});
