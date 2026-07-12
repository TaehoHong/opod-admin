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

  it("lists filtered generation jobs with cursor pagination", async () => {
    const createdAt = new Date("2026-07-12T00:00:00.000Z");
    const updatedAt = new Date("2026-07-12T00:01:00.000Z");
    const completedJob = {
      id: "job-2",
      characterId: "ai-1",
      mediaType: "image" as const,
      prompt: "sunset portrait",
      status: "completed" as const,
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
      service.listJobs({ status: "failed", limit: 20 }),
    ).rejects.toThrow(
      "Generation job status must be queued, running, or completed",
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
      status: "queued",
      outputMedia: null,
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
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "job-1" },
      include: { outputMedia: true },
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
