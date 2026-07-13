import { DraftsService } from "./drafts.service";

function prismaMock() {
  return {
    postDraft: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    generationJob: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    generationJobOutput: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    character: {
      findUnique: jest.fn().mockResolvedValue({ id: "ai-1" }),
    },
    characterActionLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(),
  };
}

function makeService(prisma: ReturnType<typeof prismaMock>) {
  return new (DraftsService as new (prisma: unknown) => DraftsService)(prisma);
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
};

describe("DraftsService", () => {
  it("rejects an unknown status filter", async () => {
    const service = makeService(prismaMock());
    await expect(
      service.listDrafts({ status: "archived", limit: 20 }),
    ).rejects.toThrow("Draft status must be one of");
  });

  it("lists drafts with filters", async () => {
    const prisma = prismaMock();
    prisma.postDraft.findMany.mockResolvedValue([draftRow]);
    const service = makeService(prisma);

    await expect(
      service.listDrafts({ status: "needs_review", limit: 20 }),
    ).resolves.toMatchObject({
      items: [{ id: "draft-1", status: "needs_review" }],
    });
    expect(prisma.postDraft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "needs_review" } }),
    );
  });

  it("returns the draft detail with latest-per-shot jobs and candidates", async () => {
    const prisma = prismaMock();
    prisma.postDraft.findUnique.mockResolvedValue(draftRow);
    prisma.generationJob.findMany.mockResolvedValue([
      {
        id: "job-new",
        sortOrder: 0,
        status: "completed",
        prompt: "p",
        errorMessage: null,
        createdAt: new Date("2026-07-12T02:00:00.000Z"),
        outputs: [
          {
            mediaId: "media-1",
            candidateIndex: 0,
            selected: true,
            media: { url: "https://cdn.local/a.png" },
          },
        ],
      },
      {
        id: "job-old",
        sortOrder: 0,
        status: "failed",
        prompt: "p",
        errorMessage: "boom",
        createdAt: new Date("2026-07-12T01:00:00.000Z"),
        outputs: [],
      },
    ]);
    const service = makeService(prisma);

    const draft = await service.getDraft("draft-1");
    expect(draft.shots).toEqual([
      {
        sortOrder: 0,
        jobId: "job-new",
        status: "completed",
        prompt: "p",
        outputs: [
          {
            mediaId: "media-1",
            url: "https://cdn.local/a.png",
            candidateIndex: 0,
            selected: true,
          },
        ],
      },
    ]);
  });

  it("creates a manual draft with a scene hint", async () => {
    const prisma = prismaMock();
    prisma.postDraft.create.mockResolvedValue({
      ...draftRow,
      status: "planned",
      caption: "",
      hashtags: [],
      scheduledAt: null,
      conceptJson: { source: "manual", sceneHint: "카페" },
    });
    const service = makeService(prisma);

    await expect(
      service.createDraft({ characterId: "ai-1", sceneHint: "카페" }),
    ).resolves.toMatchObject({ status: "planned" });
    expect(prisma.postDraft.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        characterId: "ai-1",
        conceptJson: { source: "manual", sceneHint: "카페" },
      }),
    });
    expect(prisma.characterActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actionType: "DRAFT_CREATED" }),
    });
  });

  it("edits caption only in reviewable statuses", async () => {
    const prisma = prismaMock();
    prisma.postDraft.updateMany.mockResolvedValue({ count: 0 });
    prisma.postDraft.findUnique.mockResolvedValue(draftRow);
    const service = makeService(prisma);

    await expect(
      service.updateDraft({ draftId: "draft-1", caption: "새 캡션" }),
    ).rejects.toThrow("Only needs_review or approved drafts can be edited");
    expect(prisma.postDraft.updateMany).toHaveBeenCalledWith({
      where: { id: "draft-1", status: { in: ["needs_review", "approved"] } },
      data: { caption: "새 캡션" },
    });
  });

  it("approves a needs_review draft atomically", async () => {
    const prisma = prismaMock();
    prisma.postDraft.findUnique.mockResolvedValue({
      ...draftRow,
      status: "approved",
    });
    const service = makeService(prisma);

    await expect(service.approveDraft("draft-1")).resolves.toMatchObject({
      status: "approved",
    });
    expect(prisma.postDraft.updateMany).toHaveBeenCalledWith({
      where: { id: "draft-1", status: "needs_review" },
      data: { status: "approved", errorMessage: null },
    });
    expect(prisma.characterActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actionType: "DRAFT_APPROVED" }),
    });
  });

  it("rejects approving a draft in the wrong status", async () => {
    const prisma = prismaMock();
    prisma.postDraft.updateMany.mockResolvedValue({ count: 0 });
    prisma.postDraft.findUnique.mockResolvedValue(draftRow);
    const service = makeService(prisma);

    await expect(service.approveDraft("draft-1")).rejects.toThrow(
      "Only needs_review drafts can be approved",
    );
  });

  it("regenerates a shot with a new linked job", async () => {
    const prisma = prismaMock();
    prisma.generationJob.findFirst.mockResolvedValue({
      id: "job-1",
      characterId: "ai-1",
      sortOrder: 1,
      prompt: "원본 프롬프트",
      provider: "fal:flux",
    });
    prisma.postDraft.findUnique.mockResolvedValue({
      ...draftRow,
      status: "regenerating",
    });
    const service = makeService(prisma);

    await expect(
      service.regenerateShot({ draftId: "draft-1", jobId: "job-1" }),
    ).resolves.toMatchObject({ status: "regenerating" });
    expect(prisma.postDraft.updateMany).toHaveBeenCalledWith({
      where: { id: "draft-1", status: { in: ["needs_review", "failed"] } },
      data: { status: "regenerating", errorMessage: null },
    });
    expect(prisma.generationJob.create).toHaveBeenCalledWith({
      data: {
        characterId: "ai-1",
        mediaType: "image",
        prompt: "원본 프롬프트",
        draftId: "draft-1",
        sortOrder: 1,
        originJobId: "job-1",
        provider: "fal:flux",
      },
    });
  });

  it("selects a candidate output and updates the job cache", async () => {
    const prisma = prismaMock();
    prisma.generationJob.findFirst.mockResolvedValue({
      id: "job-1",
      outputs: [{ mediaId: "media-1" }, { mediaId: "media-2" }],
    });
    prisma.postDraft.findUnique.mockResolvedValue(draftRow);
    const txOutputsUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const txJobUpdate = jest.fn().mockResolvedValue({});
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          generationJobOutput: { updateMany: txOutputsUpdateMany },
          generationJob: { update: txJobUpdate },
        }),
    );
    const service = makeService(prisma);

    await service.selectShotOutput({
      draftId: "draft-1",
      jobId: "job-1",
      mediaId: "media-2",
    });
    expect(txOutputsUpdateMany).toHaveBeenCalledWith({
      where: { jobId: "job-1" },
      data: { selected: false },
    });
    expect(txOutputsUpdateMany).toHaveBeenCalledWith({
      where: { jobId: "job-1", mediaId: "media-2" },
      data: { selected: true },
    });
    expect(txJobUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { outputMediaId: "media-2" },
    });
  });

  it("rejects selecting media that is not a candidate", async () => {
    const prisma = prismaMock();
    prisma.generationJob.findFirst.mockResolvedValue({
      id: "job-1",
      outputs: [{ mediaId: "media-1" }],
    });
    const service = makeService(prisma);

    await expect(
      service.selectShotOutput({
        draftId: "draft-1",
        jobId: "job-1",
        mediaId: "media-x",
      }),
    ).rejects.toThrow("Media is not a candidate output of this job");
  });
});
