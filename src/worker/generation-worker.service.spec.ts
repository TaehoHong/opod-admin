import {
  GenerationWorkerService,
  WorkerConfig,
  workerConfigFromEnv,
} from "./generation-worker.service";
import {
  GenerationPollResult,
  ImageGenerationProvider,
} from "./image-generation.provider";

const baseConfig: WorkerConfig = {
  enabled: true,
  pollIntervalMs: 15_000,
  jobsPerTick: 1,
  leaseSeconds: 600,
  maxAttempts: 3,
  providerPollIntervalMs: 1,
  providerTimeoutMs: 60_000,
  candidateCount: 2,
  jobCostEstimateUsd: 0.2,
  circuitBreakerThreshold: 5,
  circuitBreakerCooldownMs: 300_000,
};

function claimedJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    characterId: "ai-1",
    prompt: "film photo of a beach",
    status: "running",
    attemptCount: 1,
    provider: null,
    providerRequestId: null,
    paramsJson: null,
    character: {
      visualProfile: {
        negativePrompt: "blurry",
        referenceMedia: [
          {
            media: {
              url: "https://cdn.local/reference.png",
              uploadedAt: new Date("2026-07-01T00:00:00.000Z"),
            },
          },
          {
            media: {
              url: "https://cdn.local/unconfirmed.png",
              uploadedAt: null,
            },
          },
        ],
      },
    },
    ...overrides,
  };
}

type PrismaMock = {
  generationJob: {
    updateMany: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    aggregate: jest.Mock;
  };
  characterActionLog: { create: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};

function prismaMock(): PrismaMock {
  return {
    generationJob: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _sum: { costUsd: null } }),
    },
    characterActionLog: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
  };
}

function providerMock(
  pollResults: GenerationPollResult[],
): ImageGenerationProvider & { submit: jest.Mock; poll: jest.Mock } {
  const poll = jest.fn();
  for (const result of pollResults) {
    poll.mockResolvedValueOnce(result);
  }
  return {
    name: "test-provider",
    submit: jest.fn().mockResolvedValue({ requestId: "req-1" }),
    poll,
  };
}

function makeService(
  prisma: PrismaMock,
  provider: ImageGenerationProvider,
  config: Partial<WorkerConfig> = {},
  store = jest.fn().mockResolvedValue({
    url: "https://cdn.local/stored.png",
    storageKey: "generated/image/a.png",
  }),
  downloadBytes = jest.fn().mockResolvedValue(Buffer.from("png-bytes")),
) {
  const service = new GenerationWorkerService(
    prisma as never,
    provider,
    store,
    { ...baseConfig, ...config },
    () => Promise.resolve(),
    downloadBytes,
  );
  return { service, store, downloadBytes };
}

describe("workerConfigFromEnv", () => {
  it("is disabled by default and parses overrides", () => {
    expect(workerConfigFromEnv({}).enabled).toBe(false);
    const config = workerConfigFromEnv({
      WORKER_ENABLED: "true",
      WORKER_POLL_INTERVAL_MS: "5000",
      WORKER_DAILY_BUDGET_USD: "10",
      WORKER_MAX_ATTEMPTS: "2",
    });
    expect(config).toMatchObject({
      enabled: true,
      pollIntervalMs: 5000,
      dailyBudgetUsd: 10,
      maxAttempts: 2,
    });
  });
});

describe("GenerationWorkerService", () => {
  it("processes a claimed job end to end", async () => {
    const prisma = prismaMock();
    prisma.$queryRaw.mockResolvedValueOnce([{ id: "job-1" }]);
    prisma.generationJob.findUnique.mockResolvedValue(claimedJob());
    const provider = providerMock([
      {
        status: "completed",
        images: [
          {
            url: "https://provider.local/a.png",
            contentType: "image/png",
            width: 1024,
            height: 1024,
          },
          {
            url: "https://provider.local/b.png",
            contentType: "image/png",
            width: 1024,
            height: 1024,
          },
        ],
      },
    ]);
    const txMediaCreate = jest
      .fn()
      .mockResolvedValueOnce({ id: "media-a" })
      .mockResolvedValueOnce({ id: "media-b" });
    const txJobUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const txOutputsCreateMany = jest.fn().mockResolvedValue({ count: 2 });
    const txActionLogCreate = jest.fn().mockResolvedValue({});
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          media: { create: txMediaCreate },
          generationJob: { updateMany: txJobUpdateMany },
          generationJobOutput: { createMany: txOutputsCreateMany },
          characterActionLog: { create: txActionLogCreate },
        }),
    );
    const { service, downloadBytes } = makeService(prisma, provider);

    await service.tick();

    // 제출 직후 providerRequestId 기록 (이중 제출 방지)
    expect(prisma.generationJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "running" },
      data: { providerRequestId: "req-1", provider: "test-provider" },
    });
    // 레퍼런스는 업로드 확정본만, negative prompt는 프로필에서 주입
    expect(provider.submit).toHaveBeenCalledWith({
      prompt: "film photo of a beach",
      negativePrompt: "blurry",
      referenceImageUrls: ["https://cdn.local/reference.png"],
      candidateCount: 2,
      extraParams: undefined,
    });
    expect(downloadBytes).toHaveBeenCalledTimes(2);
    // 생성 미디어는 uploadedAt 확정 + isAiGenerated
    expect(txMediaCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isAiGenerated: true,
          uploadedAt: expect.any(Date),
          storageKey: "generated/image/a.png",
        }),
      }),
    );
    expect(txJobUpdateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "running" },
      data: expect.objectContaining({
        status: "completed",
        outputMediaId: "media-a",
        costUsd: 0.2,
      }),
    });
    expect(txOutputsCreateMany).toHaveBeenCalledWith({
      data: [
        {
          jobId: "job-1",
          mediaId: "media-a",
          candidateIndex: 0,
          selected: true,
        },
        {
          jobId: "job-1",
          mediaId: "media-b",
          candidateIndex: 1,
          selected: false,
        },
      ],
    });
    expect(txActionLogCreate).toHaveBeenCalled();
  });

  it("resumes polling with a stored provider request id instead of resubmitting", async () => {
    const prisma = prismaMock();
    prisma.$queryRaw.mockResolvedValueOnce([{ id: "job-1" }]);
    prisma.generationJob.findUnique.mockResolvedValue(
      claimedJob({ provider: "test-provider", providerRequestId: "req-old" }),
    );
    const provider = providerMock([
      {
        status: "completed",
        images: [{ url: "https://provider.local/a.png" }],
      },
    ]);
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          media: { create: jest.fn().mockResolvedValue({ id: "media-a" }) },
          generationJob: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          generationJobOutput: { createMany: jest.fn() },
          characterActionLog: { create: jest.fn() },
        }),
    );
    const { service } = makeService(prisma, provider);

    await service.tick();

    expect(provider.submit).not.toHaveBeenCalled();
    expect(provider.poll).toHaveBeenCalledWith("req-old");
  });

  it("requeues a transient failure keeping the provider request id", async () => {
    const prisma = prismaMock();
    prisma.$queryRaw.mockResolvedValueOnce([{ id: "job-1" }]);
    prisma.generationJob.findUnique.mockResolvedValue(
      claimedJob({ attemptCount: 1 }),
    );
    const provider = providerMock([]);
    provider.poll.mockRejectedValue(new Error("network flake"));
    const { service } = makeService(prisma, provider);

    await service.tick();

    expect(prisma.generationJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "running" },
      data: {
        status: "queued",
        leaseExpiresAt: null,
        errorMessage: "network flake",
      },
    });
  });

  it("drops the provider request id when the provider rejected the job", async () => {
    const prisma = prismaMock();
    prisma.$queryRaw.mockResolvedValueOnce([{ id: "job-1" }]);
    prisma.generationJob.findUnique.mockResolvedValue(
      claimedJob({ attemptCount: 1 }),
    );
    const provider = providerMock([
      { status: "failed", errorMessage: "nsfw rejected" },
    ]);
    const { service } = makeService(prisma, provider);

    await service.tick();

    expect(prisma.generationJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "running" },
      data: {
        status: "queued",
        leaseExpiresAt: null,
        errorMessage: "nsfw rejected",
        providerRequestId: null,
      },
    });
  });

  it("fails the job with an action log once attempts are exhausted", async () => {
    const prisma = prismaMock();
    prisma.$queryRaw.mockResolvedValueOnce([{ id: "job-1" }]);
    prisma.generationJob.findUnique.mockResolvedValue(
      claimedJob({ attemptCount: 3 }),
    );
    const provider = providerMock([
      { status: "failed", errorMessage: "nsfw rejected" },
    ]);
    const { service } = makeService(prisma, provider);

    await service.tick();

    expect(prisma.generationJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "running" },
      data: {
        status: "failed",
        errorMessage: "nsfw rejected",
        leaseExpiresAt: null,
      },
    });
    expect(prisma.characterActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actionType: "GENERATION_JOB_FAILED",
        targetId: "job-1",
      }),
    });
  });

  it("sweeps expired leases before claiming", async () => {
    const prisma = prismaMock();
    prisma.generationJob.updateMany.mockResolvedValue({ count: 2 });
    prisma.generationJob.findMany.mockResolvedValue([
      { id: "job-9", characterId: "ai-1", attemptCount: 3 },
    ]);
    const provider = providerMock([]);
    const { service } = makeService(prisma, provider);

    await service.tick();

    expect(prisma.generationJob.updateMany).toHaveBeenCalledWith({
      where: {
        status: "running",
        leaseExpiresAt: { lt: expect.any(Date) },
        attemptCount: { lt: 3 },
      },
      data: { status: "queued", leaseExpiresAt: null },
    });
    expect(prisma.generationJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-9", status: "running" },
      data: {
        status: "failed",
        errorMessage: "lease expired after 3 attempt(s)",
        leaseExpiresAt: null,
      },
    });
  });

  it("pauses claiming when the daily budget is reached", async () => {
    const prisma = prismaMock();
    prisma.generationJob.aggregate.mockResolvedValue({
      _sum: { costUsd: 9.9 },
    });
    const provider = providerMock([]);
    const { service } = makeService(prisma, provider, {
      dailyBudgetUsd: 10,
      jobCostEstimateUsd: 0.2,
    });

    await service.tick();

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("claims within the daily budget", async () => {
    const prisma = prismaMock();
    prisma.generationJob.aggregate.mockResolvedValue({
      _sum: { costUsd: 5 },
    });
    const provider = providerMock([]);
    const { service } = makeService(prisma, provider, {
      dailyBudgetUsd: 10,
      jobCostEstimateUsd: 0.2,
    });

    await service.tick();

    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it("opens the circuit breaker after consecutive failures", async () => {
    const prisma = prismaMock();
    const provider = providerMock([]);
    provider.poll.mockRejectedValue(new Error("provider down"));
    const { service } = makeService(prisma, provider, {
      circuitBreakerThreshold: 2,
      jobsPerTick: 10,
    });

    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: "job-1" }])
      .mockResolvedValueOnce([{ id: "job-2" }])
      .mockResolvedValue([{ id: "job-3" }]);
    prisma.generationJob.findUnique
      .mockResolvedValueOnce(claimedJob({ id: "job-1" }))
      .mockResolvedValueOnce(claimedJob({ id: "job-2" }))
      .mockResolvedValue(claimedJob({ id: "job-3" }));

    await service.tick();

    // 임계치(2) 도달 후 서킷이 열려 세 번째 claim은 일어나지 않는다.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(provider.poll).toHaveBeenCalledTimes(2);
  });

  it("does not process video jobs (claim query filters image only)", async () => {
    const prisma = prismaMock();
    const provider = providerMock([]);
    const { service } = makeService(prisma, provider);

    await service.tick();

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.generationJob.findUnique).not.toHaveBeenCalled();
  });

  it("times out provider polling against the deadline", async () => {
    const prisma = prismaMock();
    prisma.$queryRaw.mockResolvedValueOnce([{ id: "job-1" }]);
    prisma.generationJob.findUnique.mockResolvedValue(
      claimedJob({ attemptCount: 3 }),
    );
    const provider = providerMock([]);
    provider.poll.mockResolvedValue({ status: "pending" });
    const { service } = makeService(prisma, provider, {
      providerTimeoutMs: 0,
    });

    await service.tick();

    expect(prisma.generationJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "running" },
      data: expect.objectContaining({
        status: "failed",
        errorMessage: expect.stringContaining("timed out"),
      }),
    });
  });
});
