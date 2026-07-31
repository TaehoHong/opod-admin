import { GenerationRepository } from "./generation.repository";

const repositoryWithTransaction = (tx: Record<string, unknown>) => {
  const transaction = jest.fn(
    (callback: (client: Record<string, unknown>) => unknown) => callback(tx),
  );
  const repository = new GenerationRepository({
    $transaction: transaction,
  } as never);
  return { repository, transaction };
};

describe("GenerationRepository", () => {
  it("confirms a draft and records its audit action in the same transaction", async () => {
    const createLog = jest.fn().mockResolvedValue({});
    const tx = {
      generationJob: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ characterId: "ai-1" }),
      },
      characterActionLog: { create: createLog },
    };
    const { repository, transaction } = repositoryWithTransaction(tx);

    await expect(repository.confirmImageDraft("job-1")).resolves.toBe(true);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(createLog).toHaveBeenCalledWith({
      data: {
        characterId: "ai-1",
        actionType: "GENERATION_DRAFT_CONFIRMED",
        targetTable: "generation_jobs",
        targetId: "job-1",
        reason: "generation draft confirmed",
      },
    });

    createLog.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(repository.confirmImageDraft("job-1")).rejects.toThrow(
      "audit unavailable",
    );
  });

  it("locks a completed job before switching its selected output and logging", async () => {
    const lockJob = jest.fn().mockResolvedValue([]);
    const outputUpdates = jest
      .fn()
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 });
    const updateJob = jest.fn().mockResolvedValue({});
    const createLog = jest.fn().mockResolvedValue({});
    const tx = {
      $queryRaw: lockJob,
      generationJobOutput: {
        findFirst: jest.fn().mockResolvedValue({
          selected: false,
          job: { characterId: "ai-1", outputMediaId: "media-old" },
        }),
        updateMany: outputUpdates,
      },
      generationJob: { update: updateJob },
      characterActionLog: { create: createLog },
    };
    const { repository } = repositoryWithTransaction(tx);

    await expect(repository.selectOutput("job-1", "media-new")).resolves.toBe(
      "selected",
    );
    expect(lockJob).toHaveBeenCalledTimes(1);
    expect(outputUpdates).toHaveBeenNthCalledWith(1, {
      where: { jobId: "job-1" },
      data: { selected: false },
    });
    expect(outputUpdates).toHaveBeenNthCalledWith(2, {
      where: { jobId: "job-1", mediaId: "media-new" },
      data: { selected: true },
    });
    expect(updateJob).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { outputMediaId: "media-new" },
    });
    expect(createLog).toHaveBeenCalledTimes(1);
  });

  it("does not rewrite or log an already-selected output", async () => {
    const updateOutput = jest.fn();
    const updateJob = jest.fn();
    const createLog = jest.fn();
    const { repository } = repositoryWithTransaction({
      $queryRaw: jest.fn().mockResolvedValue([]),
      generationJobOutput: {
        findFirst: jest.fn().mockResolvedValue({
          selected: true,
          job: { characterId: "ai-1", outputMediaId: "media-1" },
        }),
        updateMany: updateOutput,
      },
      generationJob: { update: updateJob },
      characterActionLog: { create: createLog },
    });

    await expect(repository.selectOutput("job-1", "media-1")).resolves.toBe(
      "unchanged",
    );
    expect(updateOutput).not.toHaveBeenCalled();
    expect(updateJob).not.toHaveBeenCalled();
    expect(createLog).not.toHaveBeenCalled();
  });

  it("creates URL media and completes the running job atomically", async () => {
    const createMedia = jest.fn().mockResolvedValue({ id: "media-1" });
    const transitionJob = jest.fn().mockResolvedValue({ count: 1 });
    const { repository, transaction } = repositoryWithTransaction({
      media: { create: createMedia },
      generationJob: { updateMany: transitionJob },
    });

    await expect(
      repository.completeJobWithUrl({
        jobId: "job-1",
        mediaType: "image",
        url: "https://cdn.example/output.jpg",
        width: 1024,
      }),
    ).resolves.toBe(true);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(createMedia).toHaveBeenCalledWith({
      data: {
        mediaType: "image",
        url: "https://cdn.example/output.jpg",
        width: 1024,
        height: undefined,
        durationSeconds: undefined,
      },
      select: { id: true },
    });
    expect(transitionJob).toHaveBeenCalledWith({
      where: { id: "job-1", status: "running" },
      data: {
        status: "completed",
        outputMediaId: "media-1",
        leaseExpiresAt: null,
      },
    });
  });

  it("creates a linked retry and its audit action in one transaction", async () => {
    const retried = {
      id: "job-2",
      characterId: "ai-1",
      mediaType: "image",
      prompt: "portrait",
      inputPrompt: "portrait source",
      candidateCount: 2,
      paramsJson: { aspect_ratio: "4:3" },
      sortOrder: 10,
    };
    const createJob = jest.fn().mockResolvedValue(retried);
    const createLog = jest.fn().mockResolvedValue({});
    const { repository } = repositoryWithTransaction({
      generationJob: { create: createJob },
      characterActionLog: { create: createLog },
    });

    await expect(
      repository.retryJob(retried as never, "operator retry"),
    ).resolves.toBe(retried);
    expect(createJob).toHaveBeenCalledWith({
      data: {
        characterId: "ai-1",
        mediaType: "image",
        inputPrompt: "portrait source",
        prompt: "portrait",
        candidateCount: 2,
        paramsJson: { aspect_ratio: "4:3" },
        sortOrder: 10,
        originJobId: "job-2",
      },
      include: { outputMedia: true },
    });
    expect(createLog).toHaveBeenCalledWith({
      data: {
        characterId: "ai-1",
        actionType: "GENERATION_JOB_RETRIED",
        targetTable: "generation_jobs",
        targetId: "job-2",
        reason: "operator retry",
      },
    });
  });
});
