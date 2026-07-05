import { GenerationService } from "./generation.service";

describe("GenerationService", () => {
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

  it("moves jobs through Prisma lifecycle updates", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const updatedAt = new Date("2026-06-30T00:01:00.000Z");
    const queuedJob = {
      id: "job-1",
      characterId: "ai-1",
      mediaType: "image" as const,
      prompt: "portrait",
      status: "queued" as const,
      outputMedia: null,
      createdAt,
      updatedAt: createdAt,
    };
    const runningJob = {
      ...queuedJob,
      status: "running" as const,
      updatedAt,
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
    const create = jest.fn().mockResolvedValue(queuedJob);
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(queuedJob)
      .mockResolvedValueOnce(runningJob);
    const update = jest
      .fn()
      .mockResolvedValueOnce(runningJob)
      .mockResolvedValueOnce(completedJob);
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({
      generationJob: {
        create,
        findUnique,
        update,
      },
    });

    await expect(
      service.enqueueJob({
        characterId: "ai-1",
        mediaType: "image",
        prompt: " portrait ",
      }),
    ).resolves.toEqual({
      id: "job-1",
      characterId: "ai-1",
      mediaType: "image",
      prompt: "portrait",
      status: "queued",
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    });
    await expect(service.startJob("job-1")).resolves.toMatchObject({
      id: "job-1",
      status: "running",
    });
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
        width: 1024,
        height: 1024,
      },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        characterId: "ai-1",
        mediaType: "image",
        prompt: "portrait",
      },
      include: {
        outputMedia: true,
      },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "running" },
      include: {
        outputMedia: true,
      },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        status: "completed",
        outputMedia: {
          create: {
            mediaType: "image",
            url: "https://cdn.local/generated.png",
            width: 1024,
            height: 1024,
            durationSeconds: undefined,
          },
        },
      },
      include: {
        outputMedia: true,
      },
    });
  });

  it("completes a Prisma job with uploaded media by id", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const uploadedAt = new Date("2026-06-30T00:01:00.000Z");
    const runningJob = {
      id: "job-1",
      characterId: "ai-1",
      mediaType: "image" as const,
      prompt: "portrait",
      status: "running" as const,
      outputMedia: null,
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
    const findUniqueJob = jest.fn().mockResolvedValue(runningJob);
    const findUniqueMedia = jest.fn().mockResolvedValue({
      id: "media-1",
      mediaType: "image",
      uploadedAt,
    });
    const update = jest.fn().mockResolvedValue(completedJob);
    const service = new (
      GenerationService as new (prisma: unknown) => GenerationService
    )({
      media: {
        findUnique: findUniqueMedia,
      },
      generationJob: {
        create: jest.fn(),
        findUnique: findUniqueJob,
        update,
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
    expect(findUniqueMedia).toHaveBeenCalledWith({
      where: { id: "media-1" },
      select: {
        id: true,
        mediaType: true,
        url: true,
        width: true,
        height: true,
        durationSeconds: true,
        uploadedAt: true,
      },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        status: "completed",
        outputMedia: {
          connect: { id: "media-1" },
        },
      },
      include: {
        outputMedia: true,
      },
    });
  });

  it("retries jobs by cloning them as queued jobs", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const sourceJob = {
      id: "job-1",
      characterId: "ai-1",
      mediaType: "image" as const,
      prompt: "portrait",
      status: "completed" as const,
      outputMedia: null,
      createdAt,
      updatedAt: createdAt,
    };
    const retriedJob = {
      ...sourceJob,
      id: "job-2",
      status: "queued" as const,
    };
    const findUnique = jest.fn().mockResolvedValue(sourceJob);
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
      mediaType: "image",
      prompt: "portrait",
      status: "queued",
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        characterId: "ai-1",
        mediaType: "image",
        prompt: "portrait",
      },
      include: {
        outputMedia: true,
      },
    });
  });
});
