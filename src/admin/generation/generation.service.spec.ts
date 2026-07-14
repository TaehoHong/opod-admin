import { GenerationService } from "./generation.service";

const detailInclude = {
  outputMedia: true,
  outputs: {
    orderBy: { candidateIndex: "asc" },
    include: { media: { select: { url: true } } },
  },
  character: {
    select: {
      visualProfile: {
        select: {
          negativePrompt: true,
          referenceMedia: {
            select: { media: { select: { uploadedAt: true } } },
          },
        },
      },
    },
  },
};

const job = (overrides: Record<string, unknown> = {}) => ({
  id: "job-1",
  characterId: "ai-1",
  mediaType: "image" as const,
  prompt: "portrait",
  inputPrompt: null,
  candidateCount: null,
  status: "queued" as const,
  outputMediaId: null,
  outputMedia: null,
  outputs: [],
  character: { visualProfile: null },
  paramsJson: null,
  createdAt: new Date("2026-07-12T00:00:00.000Z"),
  updatedAt: new Date("2026-07-12T00:01:00.000Z"),
  ...overrides,
});

describe("GenerationService", () => {
  it("creates a non-claimable image draft with a compiled prompt", async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: "ai-1",
      visualProfile: {
        appearancePrompt: "same face",
        stylePrompt: "film grain",
        negativePrompt: "blurry",
        referenceMedia: [{ media: { uploadedAt: new Date() } }],
      },
    });
    const create = jest.fn().mockResolvedValue(
      job({
        status: "draft",
        inputPrompt: "walking in Seongsu",
        prompt: "same face, walking in Seongsu, film grain",
        candidateCount: 3,
      }),
    );
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({ character: { findUnique }, generationJob: { create } });

    await expect(
      service.createImageDraft({
        characterId: "ai-1",
        inputPrompt: " walking in Seongsu ",
        candidateCount: 3,
      }),
    ).resolves.toMatchObject({
      status: "draft",
      inputPrompt: "walking in Seongsu",
      candidateCount: 3,
      generationContext: {
        negativePrompt: "blurry",
        referenceImageCount: 1,
        route: "edit",
      },
    });
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: {
        characterId: "ai-1",
        mediaType: "image",
        status: "draft",
        inputPrompt: "walking in Seongsu",
        prompt: "same face, walking in Seongsu, film grain",
        candidateCount: 3,
      },
      include: { outputMedia: true },
    });
  });

  it.each([0, 5, 1.5])("rejects candidateCount %p", async (candidateCount) => {
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({});

    await expect(
      service.createImageDraft({
        characterId: "ai-1",
        inputPrompt: "portrait",
        candidateCount,
      }),
    ).rejects.toThrow("Candidate count must be an integer from 1 to 4");
  });

  it("updates only image drafts", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findUnique = jest
      .fn()
      .mockResolvedValue(
        job({ status: "draft", prompt: "edited prompt", candidateCount: 4 }),
      );
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({ generationJob: { updateMany, findUnique } });

    await expect(
      service.updateImageDraft("job-1", {
        prompt: " edited prompt ",
        candidateCount: 4,
      }),
    ).resolves.toMatchObject({
      status: "draft",
      prompt: "edited prompt",
      candidateCount: 4,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "draft" },
      data: { prompt: "edited prompt", candidateCount: 4 },
    });
  });

  it.each(["completed", "failed"])(
    "rejects editing a %s image job",
    async (status) => {
      const updateMany = jest.fn().mockResolvedValue({ count: 0 });
      const findUnique = jest.fn().mockResolvedValue(job({ status }));
      const service = new (
        GenerationService as new (prisma: unknown) => GenerationService
      )({ generationJob: { updateMany, findUnique } });

      await expect(
        service.updateImageDraft("job-1", {
          prompt: "edited prompt",
          candidateCount: 4,
        }),
      ).rejects.toThrow("Only draft generation jobs can be edited");
    },
  );

  it("confirms a draft by atomically queueing it", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findUnique = jest.fn().mockResolvedValue(job({ status: "queued" }));
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({ generationJob: { updateMany, findUnique } });

    await expect(service.confirmImageDraft("job-1")).resolves.toMatchObject({
      status: "queued",
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "draft" },
      data: { status: "queued" },
    });
  });

  it.each(["queued", "running", "completed", "failed"])(
    "returns an already %s job when confirm is retried",
    async (status) => {
      const updateMany = jest.fn().mockResolvedValue({ count: 0 });
      const findUnique = jest.fn().mockResolvedValue(job({ status }));
      const service = new (
        GenerationService as new (prisma: unknown) => GenerationService
      )({ generationJob: { updateMany, findUnique } });

      await expect(service.confirmImageDraft("job-1")).resolves.toMatchObject({
        status,
      });
    },
  );

  it("selects an owned output from a completed job in one transaction", async () => {
    const findFirst = jest.fn().mockResolvedValue({
      job: { characterId: "ai-1" },
    });
    const clearSelections = jest.fn().mockResolvedValue({ count: 2 });
    const setSelection = jest.fn().mockResolvedValue({ count: 1 });
    const update = jest.fn().mockResolvedValue({});
    const createLog = jest.fn().mockResolvedValue({});
    const $transaction = jest.fn(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          generationJobOutput: {
            updateMany: jest
              .fn()
              .mockImplementationOnce(clearSelections)
              .mockImplementationOnce(setSelection),
          },
          generationJob: { update },
          characterActionLog: { create: createLog },
        }),
    );
    const findUnique = jest
      .fn()
      .mockResolvedValue(
        job({ status: "completed", outputMediaId: "media-2" }),
      );
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({
      generationJobOutput: { findFirst },
      generationJob: { findUnique },
      $transaction,
    });

    await expect(
      service.selectOutput("job-1", "media-2"),
    ).resolves.toMatchObject({ outputMediaId: "media-2" });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        jobId: "job-1",
        mediaId: "media-2",
        job: { status: "completed" },
      },
      select: { job: { select: { characterId: true } } },
    });
    expect(clearSelections).toHaveBeenCalledWith({
      where: { jobId: "job-1" },
      data: { selected: false },
    });
    expect(setSelection).toHaveBeenCalledWith({
      where: { jobId: "job-1", mediaId: "media-2" },
      data: { selected: true },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { outputMediaId: "media-2" },
    });
    expect(createLog).toHaveBeenCalledWith({
      data: {
        characterId: "ai-1",
        actionType: "GENERATION_OUTPUT_SELECTED",
        targetTable: "generation_jobs",
        targetId: "job-1",
        reason: "selected generation output media-2",
      },
    });
    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it("rejects selecting media that is not owned by the completed job", async () => {
    const $transaction = jest.fn();
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({
      generationJobOutput: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction,
    });

    await expect(
      service.selectOutput("job-1", "foreign-media"),
    ).rejects.toThrow("Generation output not found for completed job");
    expect($transaction).not.toHaveBeenCalled();
  });

  it.each([
    { sourceStatus: "completed", candidateCount: 4 },
    { sourceStatus: "failed", candidateCount: 4 },
    { sourceStatus: "completed", candidateCount: null },
  ])(
    "regenerates a $sourceStatus image job with candidateCount $candidateCount as a draft",
    async ({ sourceStatus, candidateCount }) => {
      const findUnique = jest.fn().mockResolvedValue(
        job({
          status: sourceStatus,
          inputPrompt: "portrait request",
          prompt: "edited prompt",
          candidateCount,
          paramsJson: { aspect_ratio: "4:5" },
        }),
      );
      const create = jest.fn().mockResolvedValue(
        job({
          id: "job-2",
          status: "draft",
          originJobId: "job-1",
          inputPrompt: "portrait request",
          prompt: "edited prompt",
          candidateCount,
        }),
      );
      const service = new (
        GenerationService as new (prisma: unknown) => GenerationService
      )({ generationJob: { findUnique, create } });

      const regenerated = await service.regenerateImageJob("job-1");

      expect(regenerated).toMatchObject({
        status: "draft",
        originJobId: "job-1",
        inputPrompt: "portrait request",
        prompt: "edited prompt",
      });
      if (candidateCount === null) {
        expect(regenerated).not.toHaveProperty("candidateCount");
      } else {
        expect(regenerated).toMatchObject({ candidateCount });
      }
      expect(create).toHaveBeenCalledWith({
        data: {
          characterId: "ai-1",
          mediaType: "image",
          status: "draft",
          inputPrompt: "portrait request",
          prompt: "edited prompt",
          candidateCount,
          paramsJson: { aspect_ratio: "4:5" },
          originJobId: "job-1",
        },
        include: { outputMedia: true },
      });
    },
  );

  it.each([
    ["video", "completed"],
    ["image", "running"],
  ])("rejects regenerating a %s %s job", async (mediaType, status) => {
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({
      generationJob: {
        findUnique: jest.fn().mockResolvedValue(job({ mediaType, status })),
      },
    });

    await expect(service.regenerateImageJob("job-1")).rejects.toThrow(
      "Only completed or failed image jobs can be regenerated",
    );
  });

  it("requires image or video jobs", async () => {
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({});

    await expect(
      service.enqueueJob({
        characterId: "ai-1",
        mediaType: "audio",
        prompt: "sing",
      }),
    ).rejects.toThrow("Generation media type must be image or video");
  });

  it("lists filtered generation jobs with cursor pagination", async () => {
    const createdAt = new Date("2026-07-12T00:00:00.000Z");
    const updatedAt = new Date("2026-07-12T00:01:00.000Z");
    const completedJob = {
      id: "job-2",
      characterId: "ai-1",
      mediaType: "image" as const,
      prompt: "sunset portrait",
      status: "completed" as const,
      outputMediaId: "media-2",
      outputMedia: {
        mediaType: "image" as const,
        url: "https://cdn.local/generated.png",
        width: 1024,
        height: 1024,
        durationSeconds: null,
      },
      createdAt,
      updatedAt,
    };
    const cursor = Buffer.from(
      JSON.stringify({ id: "job-cursor" }),
      "utf8",
    ).toString("base64url");
    const findFirst = jest.fn().mockResolvedValue({ id: "job-cursor" });
    const findMany = jest.fn().mockResolvedValue([
      completedJob,
      {
        ...completedJob,
        id: "job-1",
        status: "queued" as const,
        outputMedia: null,
      },
    ]);
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({ generationJob: { findFirst, findMany } });

    await expect(
      service.listJobs({
        characterId: " ai-1 ",
        status: " completed ",
        mediaType: " image ",
        cursor,
        limit: 1,
      }),
    ).resolves.toEqual({
      items: [
        {
          id: "job-2",
          characterId: "ai-1",
          mediaType: "image",
          prompt: "sunset portrait",
          status: "completed",
          outputMediaId: "media-2",
          attemptCount: 0,
          outputMedia: {
            mediaType: "image",
            url: "https://cdn.local/generated.png",
            width: 1024,
            height: 1024,
          },
          createdAt: createdAt.toISOString(),
          updatedAt: updatedAt.toISOString(),
        },
      ],
      nextCursor: expect.any(String),
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: "job-cursor",
        characterId: "ai-1",
        status: "completed",
        mediaType: "image",
      },
      select: { id: true },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        characterId: "ai-1",
        status: "completed",
        mediaType: "image",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2,
      cursor: { id: "job-cursor" },
      skip: 1,
      include: { outputMedia: true },
    });
  });

  it("accepts the failed status filter", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({ generationJob: { findMany } });

    await expect(
      service.listJobs({ status: "failed", limit: 20 }),
    ).resolves.toEqual({ items: [] });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "failed" } }),
    );
  });

  it("accepts the draft status filter", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({ generationJob: { findMany } });

    await expect(
      service.listJobs({ status: "draft", limit: 20 }),
    ).resolves.toEqual({ items: [] });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "draft" } }),
    );
  });

  it("rejects a generation job cursor outside the active filters", async () => {
    const cursor = Buffer.from(
      JSON.stringify({ id: "job-cursor" }),
      "utf8",
    ).toString("base64url");
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({
      generationJob: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });

    await expect(
      service.listJobs({ characterId: "ai-1", cursor, limit: 20 }),
    ).rejects.toThrow("Invalid cursor");
  });

  it("rejects an invalid generation job status filter", async () => {
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({ generationJob: { findMany: jest.fn().mockResolvedValue([]) } });

    await expect(
      service.listJobs({ status: "archived", limit: 20 }),
    ).rejects.toThrow(
      "Generation job status must be draft, queued, running, completed, or failed",
    );
  });

  it("rejects an invalid generation job media type filter", async () => {
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({ generationJob: { findMany: jest.fn().mockResolvedValue([]) } });

    await expect(
      service.listJobs({ mediaType: "audio", limit: 20 }),
    ).rejects.toThrow("Generation media type must be image or video");
  });

  it("gets a generation job with the lifecycle response shape", async () => {
    const createdAt = new Date("2026-07-12T00:00:00.000Z");
    const findUnique = jest.fn().mockResolvedValue({
      id: "job-1",
      characterId: "ai-1",
      mediaType: "video",
      prompt: "city reel",
      inputPrompt: null,
      candidateCount: null,
      status: "queued",
      outputMediaId: null,
      provider: null,
      attemptCount: 0,
      originJobId: null,
      errorMessage: null,
      costUsd: null,
      paramsJson: null,
      outputMedia: null,
      outputs: [],
      character: {
        visualProfile: {
          negativePrompt: "avoid artifacts",
          referenceMedia: [
            { media: { uploadedAt: new Date("2026-07-11T00:00:00.000Z") } },
            { media: { uploadedAt: null } },
          ],
        },
      },
      createdAt,
      updatedAt: createdAt,
    });
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({ generationJob: { findUnique } });

    await expect(service.getJob("job-1")).resolves.toEqual({
      id: "job-1",
      characterId: "ai-1",
      mediaType: "video",
      prompt: "city reel",
      status: "queued",
      attemptCount: 0,
      generationContext: {
        negativePrompt: "avoid artifacts",
        referenceImageCount: 1,
        route: "edit",
      },
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "job-1" },
      include: detailInclude,
    });
  });

  it("exposes output candidates on the job detail", async () => {
    const createdAt = new Date("2026-07-12T00:00:00.000Z");
    const findUnique = jest.fn().mockResolvedValue({
      id: "job-1",
      characterId: "ai-1",
      mediaType: "image",
      prompt: "portrait",
      status: "completed",
      attemptCount: 1,
      outputMedia: null,
      outputs: [
        {
          mediaId: "media-1",
          candidateIndex: 0,
          selected: true,
          media: { url: "https://cdn.local/candidate-0.png" },
        },
        {
          mediaId: "media-2",
          candidateIndex: 1,
          selected: false,
          media: { url: "https://cdn.local/candidate-1.png" },
        },
      ],
      createdAt,
      updatedAt: createdAt,
    });
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({ generationJob: { findUnique } });

    await expect(service.getJob("job-1")).resolves.toMatchObject({
      outputs: [
        {
          mediaId: "media-1",
          url: "https://cdn.local/candidate-0.png",
          candidateIndex: 0,
          selected: true,
        },
        {
          mediaId: "media-2",
          url: "https://cdn.local/candidate-1.png",
          candidateIndex: 1,
          selected: false,
        },
      ],
    });
  });

  it("rejects a missing generation job detail", async () => {
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({ generationJob: { findUnique: jest.fn().mockResolvedValue(null) } });

    await expect(service.getJob("missing-job")).rejects.toThrow(
      "Generation job not found",
    );
  });

  it("starts queued jobs atomically with a lease", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findUnique = jest.fn().mockResolvedValue({
      id: "job-1",
      characterId: "ai-1",
      mediaType: "image",
      prompt: "portrait",
      status: "running",
      attemptCount: 1,
      outputMedia: null,
      outputs: [],
      createdAt,
      updatedAt: createdAt,
    });
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({ generationJob: { updateMany, findUnique } });

    await expect(service.startJob("job-1")).resolves.toMatchObject({
      id: "job-1",
      status: "running",
      attemptCount: 1,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "queued" },
      data: {
        status: "running",
        leaseExpiresAt: expect.any(Date),
        attemptCount: { increment: 1 },
      },
    });
  });

  it("rejects starting a job that is not queued", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const findUnique = jest.fn().mockResolvedValue({
      id: "job-1",
      characterId: "ai-1",
      mediaType: "image",
      prompt: "portrait",
      status: "running",
      outputMedia: null,
      outputs: [],
      createdAt,
      updatedAt: createdAt,
    });
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({ generationJob: { updateMany, findUnique } });

    await expect(service.startJob("job-1")).rejects.toThrow(
      "Only queued generation jobs can start",
    );
  });

  it("completes a running job from a URL inside one transaction", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const runningJob = {
      id: "job-1",
      characterId: "ai-1",
      mediaType: "image" as const,
      prompt: "portrait",
      status: "running" as const,
      outputMedia: null,
      outputs: [],
      createdAt,
      updatedAt: createdAt,
    };
    const completedJob = {
      ...runningJob,
      status: "completed" as const,
      outputMedia: {
        mediaType: "image" as const,
        url: "https://cdn.local/generated.png",
        width: 1024,
        height: 1024,
        durationSeconds: null,
      },
    };
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(runningJob)
      .mockResolvedValueOnce(completedJob);
    const txMediaCreate = jest.fn().mockResolvedValue({ id: "media-1" });
    const txUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const $transaction = jest.fn(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          media: { create: txMediaCreate },
          generationJob: { updateMany: txUpdateMany },
        }),
    );
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({ generationJob: { findUnique }, $transaction });

    await expect(
      service.completeJob({
        jobId: "job-1",
        url: "https://cdn.local/generated.png",
        width: 1024,
        height: 1024,
      }),
    ).resolves.toMatchObject({
      id: "job-1",
      status: "completed",
      outputMedia: {
        mediaType: "image",
        url: "https://cdn.local/generated.png",
      },
    });
    expect(txMediaCreate).toHaveBeenCalledWith({
      data: {
        mediaType: "image",
        url: "https://cdn.local/generated.png",
        width: 1024,
        height: 1024,
        durationSeconds: undefined,
      },
      select: { id: true },
    });
    expect(txUpdateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "running" },
      data: {
        status: "completed",
        outputMediaId: "media-1",
        leaseExpiresAt: null,
      },
    });
  });

  it("returns the completed job as-is when complete is retried", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const completedJob = {
      id: "job-1",
      characterId: "ai-1",
      mediaType: "image" as const,
      prompt: "portrait",
      status: "completed" as const,
      outputMedia: {
        mediaType: "image" as const,
        url: "https://cdn.local/generated.png",
        width: null,
        height: null,
        durationSeconds: null,
      },
      outputs: [],
      createdAt,
      updatedAt: createdAt,
    };
    const findUnique = jest.fn().mockResolvedValue(completedJob);
    const $transaction = jest.fn(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          media: { create: jest.fn().mockResolvedValue({ id: "media-x" }) },
          generationJob: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
        }),
    );
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({ generationJob: { findUnique }, $transaction });

    await expect(
      service.completeJob({
        jobId: "job-1",
        url: "https://cdn.local/generated.png",
      }),
    ).resolves.toMatchObject({ id: "job-1", status: "completed" });
  });

  it("completes a running job with uploaded media by id", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const uploadedAt = new Date("2026-06-30T00:01:00.000Z");
    const runningJob = {
      id: "job-1",
      characterId: "ai-1",
      mediaType: "image" as const,
      prompt: "portrait",
      status: "running" as const,
      outputMedia: null,
      outputs: [],
      createdAt,
      updatedAt: createdAt,
    };
    const completedJob = {
      ...runningJob,
      status: "completed" as const,
      outputMedia: {
        mediaType: "image" as const,
        url: "https://cdn.example.com/media/image/generated.png",
        width: 1024,
        height: 1024,
        durationSeconds: null,
      },
    };
    const findUniqueJob = jest
      .fn()
      .mockResolvedValueOnce(runningJob)
      .mockResolvedValueOnce(completedJob);
    const findUniqueMedia = jest.fn().mockResolvedValue({
      id: "media-1",
      mediaType: "image",
      uploadedAt,
    });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({
      media: {
        findUnique: findUniqueMedia,
      },
      generationJob: {
        findUnique: findUniqueJob,
        updateMany,
      },
    });

    await expect(
      service.completeJob({
        jobId: "job-1",
        mediaId: "media-1",
      }),
    ).resolves.toMatchObject({
      id: "job-1",
      status: "completed",
      outputMedia: {
        mediaType: "image",
        url: "https://cdn.example.com/media/image/generated.png",
      },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "running" },
      data: {
        status: "completed",
        outputMediaId: "media-1",
        leaseExpiresAt: null,
      },
    });
  });

  it("fails queued or running jobs with an error message", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findUnique = jest.fn().mockResolvedValue({
      id: "job-1",
      characterId: "ai-1",
      mediaType: "image",
      prompt: "portrait",
      status: "failed",
      attemptCount: 3,
      errorMessage: "provider timeout",
      outputMedia: null,
      outputs: [],
      createdAt,
      updatedAt: createdAt,
    });
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({ generationJob: { updateMany, findUnique } });

    await expect(
      service.failJob({ jobId: "job-1", errorMessage: "provider timeout" }),
    ).resolves.toMatchObject({
      id: "job-1",
      status: "failed",
      errorMessage: "provider timeout",
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: { in: ["queued", "running"] } },
      data: {
        status: "failed",
        errorMessage: "provider timeout",
        leaseExpiresAt: null,
      },
    });
  });

  it("retries only failed jobs and links the origin job", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const failedJob = {
      id: "job-1",
      characterId: "ai-1",
      mediaType: "image" as const,
      prompt: "portrait",
      status: "failed" as const,
      provider: "fal:flux-kontext",
      outputMedia: null,
      outputs: [],
      createdAt,
      updatedAt: createdAt,
    };
    const retriedJob = {
      ...failedJob,
      id: "job-2",
      status: "queued" as const,
      originJobId: "job-1",
    };
    const findUnique = jest.fn().mockResolvedValue(failedJob);
    const create = jest.fn().mockResolvedValue(retriedJob);
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({
      generationJob: {
        create,
        findUnique,
      },
    });

    await expect(service.retryJob("job-1")).resolves.toMatchObject({
      id: "job-2",
      characterId: "ai-1",
      status: "queued",
      originJobId: "job-1",
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        characterId: "ai-1",
        mediaType: "image",
        prompt: "portrait",
        provider: "fal:flux-kontext",
        originJobId: "job-1",
      },
      include: {
        outputMedia: true,
      },
    });
  });

  it("rejects retrying a job that has not failed", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const findUnique = jest.fn().mockResolvedValue({
      id: "job-1",
      characterId: "ai-1",
      mediaType: "image",
      prompt: "portrait",
      status: "completed",
      outputMedia: null,
      outputs: [],
      createdAt,
      updatedAt: createdAt,
    });
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({ generationJob: { findUnique } });

    await expect(service.retryJob("job-1")).rejects.toThrow(
      "Only failed generation jobs can be retried",
    );
  });
});
