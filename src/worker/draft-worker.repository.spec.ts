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
    characterMemory: { create: jest.fn().mockResolvedValue({}) },
  };
  return {
    prisma: {
      $queryRaw: jest.fn(),
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
        expect(leaseSeconds).toBe(120);
        return Promise.resolve([{ id: "draft-1" }]);
      },
    );
    const repository = new DraftWorkerRepository(prisma as never);

    await expect(repository.claimPlannedDraft(120)).resolves.toBe("draft-1");
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
        content: "memory",
        reason: "auto: post published from draft",
      },
    });
  });
});
