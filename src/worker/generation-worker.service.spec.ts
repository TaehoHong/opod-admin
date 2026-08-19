import {
  GenerationWorkerService,
  WorkerConfig,
} from "./generation-worker.service";
import { createHash } from "node:crypto";
import {
  GenerationPollResult,
  ImageGenerationProvider,
  ImageGenerationProviders,
} from "./image-generation.provider";

const baseConfig: WorkerConfig = {
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
    candidateCount: 3,
    provider: null,
    providerRequestId: null,
    paramsJson: null,
    character: {
      visualProfile: {
        negativePrompt: "blurry",
        referenceMedia: [
          {
            mediaId: "reference-1",
            media: {
              url: "https://cdn.local/reference.png",
              storageKey: "pod/reference/a.png",
              uploadedAt: new Date("2026-07-01T00:00:00.000Z"),
            },
          },
          {
            media: {
              url: "https://cdn.local/unconfirmed.png",
              storageKey: null,
              uploadedAt: null,
            },
          },
        ],
      },
    },
    draft: null,
    ...overrides,
  };
}

// Prisma를 흉내내지 않고 repository를 대신 세운다
// (docs/02-development-rules.md "Module and Repository Rules"). 큐 전이의
// 원자성 자체는 repository의 조건부 갱신이 책임지므로, 여기서는 워커가 어떤
// 전이를 어떤 순서로 요구하는지만 본다.
type RepositoryFake = {
  claimNextQueuedImageJob: jest.Mock;
  claimQueuedImageJob: jest.Mock;
  requeueExpiredLeases: jest.Mock;
  findExhaustedLeases: jest.Mock;
  markFailed: jest.Mock;
  requeueForRetry: jest.Mock;
  sumCostSince: jest.Mock;
  findForProcessing: jest.Mock;
  recordProviderSubmission: jest.Mock;
  extendLease: jest.Mock;
  persistSuccess: jest.Mock;
  recordActionLog: jest.Mock;
};

function repositoryFake(): RepositoryFake {
  return {
    claimNextQueuedImageJob: jest.fn().mockResolvedValue(undefined),
    claimQueuedImageJob: jest
      .fn()
      .mockImplementation((jobId: string) => Promise.resolve(jobId)),
    requeueExpiredLeases: jest.fn().mockResolvedValue(0),
    findExhaustedLeases: jest.fn().mockResolvedValue([]),
    markFailed: jest.fn().mockResolvedValue(true),
    requeueForRetry: jest.fn().mockResolvedValue(undefined),
    sumCostSince: jest.fn().mockResolvedValue(0),
    findForProcessing: jest.fn(),
    recordProviderSubmission: jest.fn().mockResolvedValue(undefined),
    extendLease: jest.fn().mockResolvedValue(undefined),
    persistSuccess: jest.fn().mockResolvedValue(undefined),
    recordActionLog: jest.fn().mockResolvedValue(undefined),
  };
}

type ProviderMock = ImageGenerationProvider & {
  submit: jest.Mock;
  poll: jest.Mock;
  cancel: jest.Mock;
};

function providerMock(
  pollResults: GenerationPollResult[],
  name = "test-provider",
): ProviderMock {
  const poll = jest.fn();
  for (const result of pollResults) {
    poll.mockResolvedValueOnce(result);
  }
  return {
    name,
    submit: jest.fn().mockResolvedValue({
      requestId: "req-1",
      sentPrompt: "sent prompt",
    }),
    poll,
    cancel: jest.fn().mockResolvedValue(undefined),
  };
}

// 대부분의 테스트는 라우팅과 무관하므로 같은 목을 t2i/edit 양쪽에 쓴다.
function bothProviders(provider: ImageGenerationProvider) {
  return { t2i: provider, edit: provider };
}

function makeService(
  repository: RepositoryFake,
  providers: ImageGenerationProvider | ImageGenerationProviders,
  // 자동 루프 on/off는 이제 config가 아니라 DB 설정이지만, 테스트에서는 같은
  // 자리에서 켜고 끄는 편이 읽기 쉽다.
  {
    enabled = true,
    ...config
  }: Partial<WorkerConfig> & { enabled?: boolean } = {},
  store = jest.fn().mockResolvedValue({
    url: "https://cdn.local/stored.png",
    storageKey: "generated/image/a.png",
  }),
  downloadBytes = jest.fn().mockResolvedValue(Buffer.from("png-bytes")),
  signReferenceUrl: ((storageKey: string) => Promise<string>) | null = null,
  aspectRatios: Record<"feed" | "story" | "reel", string> = {
    feed: "4:5",
    story: "9:16",
    reel: "9:16",
  },
) {
  const pair =
    "t2i" in providers && "edit" in providers
      ? providers
      : bothProviders(providers as ImageGenerationProvider);
  const service = new GenerationWorkerService(
    repository as never,
    // 프로덕션에서는 잡마다 DB 설정을 재해석하는 resolver가 들어간다.
    () => Promise.resolve(pair),
    store,
    () => Promise.resolve(enabled),
    { ...baseConfig, ...config },
    () => Promise.resolve(),
    downloadBytes,
    signReferenceUrl,
    undefined,
    () => Promise.resolve(aspectRatios),
  );
  return { service, store, downloadBytes };
}

describe("GenerationWorkerService", () => {
  it("processes a claimed job end to end", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(claimedJob());
    const outputDigest = createHash("sha256")
      .update(Buffer.from("png-bytes"))
      .digest("hex");
    const provider = providerMock([
      {
        status: "completed",
        images: [
          {
            url: "https://provider.local/a.png",
            contentType: "image/png",
            width: 1024,
            height: 1024,
            sha256: outputDigest,
            downloadHeaders: { authorization: "Bearer flux-secret" },
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
    const { service, downloadBytes } = makeService(repository, provider);

    await service.tick();

    // 제출 직후 providerRequestId 기록 (이중 제출 방지)
    expect(repository.recordProviderSubmission).toHaveBeenCalledWith({
      jobId: "job-1",
      providerRequestId: "req-1",
      sentPrompt: "sent prompt",
      provider: "test-provider",
      paramsJson: {
        _shot: {
          execution: {
            route: "edit",
            referenceMediaIds: ["reference-1"],
          },
        },
      },
    });
    // 레퍼런스는 업로드 확정본만, negative prompt는 프로필에서 주입
    expect(provider.submit).toHaveBeenCalledWith({
      idempotencyKey: "job-1",
      profile: "photoreal_identity_v1",
      prompt: "film photo of a beach",
      negativePrompt: "blurry",
      references: [
        {
          id: "reference-1",
          role: "identity",
          primary: true,
          url: "https://cdn.local/reference.png",
        },
      ],
      candidateCount: 3,
      // 포맷 종횡비는 항상 실린다 — 초안이 없으면 피드 기본값.
      extraParams: { aspect_ratio: "4:5" },
      metadata: {
        character_id: "ai-1",
        generation_job_id: "job-1",
      },
    });
    expect(downloadBytes).toHaveBeenCalledTimes(2);
    expect(downloadBytes).toHaveBeenNthCalledWith(
      1,
      "https://provider.local/a.png",
      { authorization: "Bearer flux-secret" },
    );
    // 후보 두 장을 저장 비용 추정치와 함께 넘긴다.
    expect(repository.persistSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        characterId: "ai-1",
        costUsd: 0.2,
        providerName: "test-provider",
        files: expect.arrayContaining([
          expect.objectContaining({ storageKey: "generated/image/a.png" }),
        ]),
      }),
    );
    expect(repository.persistSuccess.mock.calls[0][0].files).toHaveLength(2);
  });

  it("rejects a generated output whose SHA-256 digest does not match", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(claimedJob());
    const provider = providerMock([
      {
        status: "completed",
        images: [
          {
            url: "https://provider.local/a.png",
            sha256: "0".repeat(64),
          },
        ],
      },
    ]);
    const { service } = makeService(repository, provider);

    await service.tick();

    expect(repository.persistSuccess).not.toHaveBeenCalled();
    expect(repository.requeueForRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        message: "generated media SHA-256 verification failed",
      }),
    );
  });

  it("uses the configured candidate count for legacy jobs", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(
      claimedJob({ candidateCount: null }),
    );
    const provider = providerMock([
      { status: "completed", images: [{ url: "https://p.local/a.png" }] },
    ]);
    const { service } = makeService(repository, provider);

    await service.tick();

    expect(provider.submit).toHaveBeenCalledWith(
      expect.objectContaining({ candidateCount: 2 }),
    );
  });

  it("resumes polling with a stored provider request id instead of resubmitting", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(
      claimedJob({ provider: "test-provider", providerRequestId: "req-old" }),
    );
    const provider = providerMock([
      {
        status: "completed",
        images: [{ url: "https://provider.local/a.png" }],
      },
    ]);
    const { service } = makeService(repository, provider);

    await service.tick();

    expect(provider.submit).not.toHaveBeenCalled();
    expect(provider.poll).toHaveBeenCalledWith("req-old");
  });

  it("requeues a transient failure keeping the provider request id", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(
      claimedJob({ attemptCount: 1 }),
    );
    const provider = providerMock([]);
    provider.poll.mockRejectedValue(new Error("network flake"));
    const { service } = makeService(repository, provider);

    await service.tick();

    expect(repository.requeueForRetry).toHaveBeenCalledWith({
      jobId: "job-1",
      message: "network flake",
      clearProviderRequestId: false,
    });
  });

  it("drops the provider request id when the provider rejected the job", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(
      claimedJob({ attemptCount: 1 }),
    );
    const provider = providerMock([
      { status: "failed", errorMessage: "nsfw rejected" },
    ]);
    const { service } = makeService(repository, provider);

    await service.tick();

    expect(repository.requeueForRetry).toHaveBeenCalledWith({
      jobId: "job-1",
      message: "nsfw rejected",
      clearProviderRequestId: true,
    });
  });

  it("fails the job with an action log once attempts are exhausted", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(
      claimedJob({ attemptCount: 3 }),
    );
    const provider = providerMock([
      { status: "failed", errorMessage: "nsfw rejected" },
    ]);
    const { service } = makeService(repository, provider);

    await service.tick();

    expect(repository.markFailed).toHaveBeenCalledWith(
      "job-1",
      "nsfw rejected",
    );
    expect(repository.recordActionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "GENERATION_JOB_FAILED",
        jobId: "job-1",
      }),
    );
  });

  // 자동 루프 토글은 설정 화면이 소유한다. 여기서 새면 화면에서 끈 워커가
  // 계속 이미지를 생성해 과금된다.
  it("does nothing while the automatic loop is switched off", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValue("job-1");
    const { service } = makeService(repository, providerMock([]), {
      enabled: false,
    });

    await service.tick();

    expect(repository.requeueExpiredLeases).not.toHaveBeenCalled();
    expect(repository.claimNextQueuedImageJob).not.toHaveBeenCalled();
  });

  // 수동 실행은 토글과 무관해야 한다 — 리허설과 즉시 실행이 그 목적이다.
  it("still runs a job manually while the automatic loop is off", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(claimedJob());
    const { service } = makeService(repository, providerMock([]), {
      enabled: false,
    });

    await expect(service.runJobNow()).resolves.toEqual({ jobId: "job-1" });
  });

  it("sweeps expired leases before claiming", async () => {
    const repository = repositoryFake();
    repository.requeueExpiredLeases.mockResolvedValue(2);
    repository.findExhaustedLeases.mockResolvedValue([
      { id: "job-9", characterId: "ai-1", attemptCount: 3 },
    ]);
    const provider = providerMock([]);
    const { service } = makeService(repository, provider);

    await service.tick();

    expect(repository.requeueExpiredLeases).toHaveBeenCalledWith(
      expect.any(Date),
      3,
    );
    expect(repository.markFailed).toHaveBeenCalledWith(
      "job-9",
      "lease expired after 3 attempt(s)",
    );
  });

  it("pauses claiming when the daily budget is reached", async () => {
    const repository = repositoryFake();
    repository.sumCostSince.mockResolvedValue(9.9);
    const provider = providerMock([]);
    const { service } = makeService(repository, provider, {
      dailyBudgetUsd: 10,
      jobCostEstimateUsd: 0.2,
    });

    await service.tick();

    expect(repository.claimNextQueuedImageJob).not.toHaveBeenCalled();
  });

  it("claims within the daily budget", async () => {
    const repository = repositoryFake();
    repository.sumCostSince.mockResolvedValue(5);
    const provider = providerMock([]);
    const { service } = makeService(repository, provider, {
      dailyBudgetUsd: 10,
      jobCostEstimateUsd: 0.2,
    });

    await service.tick();

    expect(repository.claimNextQueuedImageJob).toHaveBeenCalled();
  });

  it("opens the circuit breaker after consecutive failures", async () => {
    const repository = repositoryFake();
    const provider = providerMock([]);
    provider.poll.mockRejectedValue(new Error("provider down"));
    const { service } = makeService(repository, provider, {
      circuitBreakerThreshold: 2,
      jobsPerTick: 10,
    });

    repository.claimNextQueuedImageJob
      .mockResolvedValueOnce("job-1")
      .mockResolvedValueOnce("job-2")
      .mockResolvedValue("job-3");
    repository.findForProcessing
      .mockResolvedValueOnce(claimedJob({ id: "job-1" }))
      .mockResolvedValueOnce(claimedJob({ id: "job-2" }))
      .mockResolvedValue(claimedJob({ id: "job-3" }));

    await service.tick();

    // 임계치(2) 도달 후 서킷이 열려 세 번째 claim은 일어나지 않는다.
    expect(repository.claimNextQueuedImageJob).toHaveBeenCalledTimes(2);
    expect(provider.poll).toHaveBeenCalledTimes(2);
  });

  it("does not process video jobs (claim query filters image only)", async () => {
    const repository = repositoryFake();
    const provider = providerMock([]);
    const { service } = makeService(repository, provider);

    await service.tick();

    expect(repository.claimNextQueuedImageJob).toHaveBeenCalledTimes(1);
    expect(repository.findForProcessing).not.toHaveBeenCalled();
  });

  it("times out provider polling against the deadline", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(
      claimedJob({ attemptCount: 3 }),
    );
    const provider = providerMock([]);
    provider.poll.mockResolvedValue({ status: "pending" });
    const { service } = makeService(repository, provider, {
      providerTimeoutMs: 0,
    });

    await service.tick();

    expect(repository.markFailed).toHaveBeenCalledWith(
      "job-1",
      expect.stringContaining("timed out"),
    );
    // 데드라인 초과 시 시작 전 요청은 과금 전에 취소를 시도한다 (베스트에포트).
    expect(provider.cancel).toHaveBeenCalledWith("req-1");
  });

  it("fails an explicit character-visible shot without usable references before submission", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(
      claimedJob({
        paramsJson: {
          _shot: {
            sortOrder: 0,
            characterVisible: true,
            referenceMediaIds: ["pending-ref"],
          },
        },
        character: {
          visualProfile: {
            negativePrompt: "",
            referenceMedia: [
              // 업로드 미확정 레퍼런스는 걸러지므로 콜드스타트로 취급된다.
              {
                media: {
                  url: "https://cdn.local/pending.png",
                  uploadedAt: null,
                },
              },
            ],
          },
        },
      }),
    );
    const t2i = providerMock([], "fal:t2i-model");
    const edit = providerMock([], "fal:edit-model");
    const { service } = makeService(repository, { t2i, edit });

    await service.tick();

    expect(t2i.submit).not.toHaveBeenCalled();
    expect(edit.submit).not.toHaveBeenCalled();
    expect(repository.markFailed).toHaveBeenCalledWith(
      "job-1",
      "shot job-1 shows the character but has no usable identity reference",
    );
  });

  it("routes jobs with confirmed references to the edit provider", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(claimedJob());
    const t2i = providerMock([], "fal:t2i-model");
    const edit = providerMock(
      [{ status: "completed", images: [{ url: "https://p.local/a.png" }] }],
      "fal:edit-model",
    );
    const { service } = makeService(repository, { t2i, edit });

    await service.tick();

    expect(edit.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        references: [
          expect.objectContaining({
            role: "identity",
            primary: true,
            url: "https://cdn.local/reference.png",
          }),
        ],
      }),
    );
    expect(t2i.submit).not.toHaveBeenCalled();
  });

  it("records and continues a submission when the planned target model changed", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(
      claimedJob({
        paramsJson: {
          _shot: {
            characterVisible: false,
            referenceMediaIds: [],
            targetModelId: "old-t2i-model",
          },
        },
      }),
    );
    const t2i = providerMock(
      [{ status: "completed", images: [{ url: "https://p.local/a.png" }] }],
      "fal:new-t2i-model",
    );
    const edit = providerMock([], "fal:new-edit-model");
    const { service } = makeService(repository, { t2i, edit });

    await service.tick();

    expect(t2i.submit).toHaveBeenCalled();
    expect(edit.submit).not.toHaveBeenCalled();
    expect(repository.markFailed).not.toHaveBeenCalled();
    expect(repository.recordProviderSubmission).toHaveBeenCalledWith({
      jobId: "job-1",
      providerRequestId: "req-1",
      sentPrompt: "sent prompt",
      provider: "fal:new-t2i-model",
      paramsJson: {
        _shot: {
          characterVisible: false,
          referenceMediaIds: [],
          targetModelId: "old-t2i-model",
          execution: {
            route: "t2i",
            referenceMediaIds: [],
          },
        },
      },
    });
  });

  it("runJobNow claims a specific queued job and processes it in the background", async () => {
    const repository = repositoryFake();
    repository.findForProcessing.mockResolvedValue(claimedJob());
    const provider = providerMock([
      { status: "completed", images: [{ url: "https://p.local/a.png" }] },
    ]);
    const { service } = makeService(repository, provider);

    await expect(service.runJobNow("job-1")).resolves.toEqual({
      jobId: "job-1",
    });

    // 조건부 claim — queued 이미지 잡만 집는다.
    expect(repository.claimQueuedImageJob).toHaveBeenCalledWith("job-1", 600);
    // 처리 자체는 백그라운드 — 셧다운 훅이 완료를 기다린다.
    await service.onModuleDestroy();
    expect(provider.submit).toHaveBeenCalled();
  });

  it("runJobNow returns null when the job is not queued", async () => {
    const repository = repositoryFake();
    repository.claimQueuedImageJob.mockResolvedValue(undefined);
    const provider = providerMock([]);
    const { service } = makeService(repository, provider);

    await expect(service.runJobNow("job-1")).resolves.toEqual({
      jobId: null,
    });
    expect(repository.findForProcessing).not.toHaveBeenCalled();
  });

  it("runJobNow without a jobId claims the next queued job", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-7");
    repository.findForProcessing.mockResolvedValue(claimedJob({ id: "job-7" }));
    const provider = providerMock([
      { status: "completed", images: [{ url: "https://p.local/a.png" }] },
    ]);
    const { service } = makeService(repository, provider);

    await expect(service.runJobNow()).resolves.toEqual({ jobId: "job-7" });
    await service.onModuleDestroy();
  });

  it("merges visual profile providerConfig under job paramsJson", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(
      claimedJob({
        paramsJson: { seed: 42 },
        character: {
          visualProfile: {
            negativePrompt: "blurry",
            providerConfig: { aspect_ratio: "4:5", seed: 1 },
            referenceMedia: [
              {
                media: {
                  url: "https://cdn.local/reference.png",
                  uploadedAt: new Date("2026-07-01T00:00:00.000Z"),
                },
              },
            ],
          },
        },
      }),
    );
    const provider = providerMock([
      { status: "completed", images: [{ url: "https://p.local/a.png" }] },
    ]);
    const { service } = makeService(repository, provider);

    await service.tick();

    // 프로필 기본값(aspect_ratio) 위에 잡별 파라미터(seed)가 우선한다.
    expect(provider.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        extraParams: { aspect_ratio: "4:5", seed: 42 },
      }),
    );
  });

  // 종횡비를 데이터에만 맡겼더니 아무도 설정하지 않아 전 게시물이 모델 기본값인
  // 가로(16:9)로 나왔다. 피드에 그대로 쓸 수 없는 이미지가 만들어진다.
  it.each([
    ["post", "feed", "4:5"],
    ["story", "feed", "9:16"],
    ["post", "reel", "9:16"],
  ])(
    "sends the %s/%s aspect ratio (%s) when nothing overrides it",
    async (draftType, contentType, expected) => {
      const repository = repositoryFake();
      repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
      repository.findForProcessing.mockResolvedValue(
        claimedJob({ draft: { draftType, contentType, location: null } }),
      );
      const provider = providerMock([
        { status: "completed", images: [{ url: "https://p.local/a.png" }] },
      ]);
      const { service } = makeService(repository, provider);

      await service.tick();

      expect(provider.submit).toHaveBeenCalledWith(
        expect.objectContaining({
          extraParams: expect.objectContaining({ aspect_ratio: expected }),
        }),
      );
    },
  );

  // 스토리 초안도 contentType 기본값은 feed다. contentType을 먼저 보면 스토리가
  // 4:5로 나가 화면 위아래가 잘린다.
  it("treats a story draft as a story even when its content type is feed", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(
      claimedJob({
        draft: { draftType: "story", contentType: "feed", location: null },
      }),
    );
    const provider = providerMock([
      { status: "completed", images: [{ url: "https://p.local/a.png" }] },
    ]);
    const { service } = makeService(repository, provider);

    await service.tick();

    expect(provider.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        extraParams: expect.objectContaining({ aspect_ratio: "9:16" }),
      }),
    );
  });

  // 포맷 비율은 기본값이므로 명시적으로 설정한 값이 이겨야 한다. 반대면 잡별
  // 재생성에서 비율을 바꿀 수 없다.
  it("lets an explicit job parameter override the format aspect ratio", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(
      claimedJob({
        paramsJson: { aspect_ratio: "1:1" },
        draft: { draftType: "post", contentType: "feed", location: null },
      }),
    );
    const provider = providerMock([
      { status: "completed", images: [{ url: "https://p.local/a.png" }] },
    ]);
    const { service } = makeService(repository, provider);

    await service.tick();

    expect(provider.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        extraParams: expect.objectContaining({ aspect_ratio: "1:1" }),
      }),
    );
  });

  // 비주얼 프로필 테스트 생성은 초안이 없다. 비율을 안 보내면 인물 확인용
  // 이미지가 가로로 나와 쓸모가 없다.
  it("falls back to the feed ratio for jobs without a draft", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(claimedJob({ draft: null }));
    const provider = providerMock([
      { status: "completed", images: [{ url: "https://p.local/a.png" }] },
    ]);
    const { service } = makeService(repository, provider);

    await service.tick();

    expect(provider.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        extraParams: expect.objectContaining({ aspect_ratio: "4:5" }),
      }),
    );
  });

  it("sends anchors plus the shot's selected references", async () => {
    const reference = (mediaId: string) => ({
      mediaId,
      media: {
        url: `https://cdn.local/${mediaId}.png`,
        uploadedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    });
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(
      claimedJob({
        // 기획 LLM이 이 샷에 고른 레퍼런스 — r3는 앵커와 중복되지 않는 선별분.
        paramsJson: {
          _shot: { scene: "장면", referenceMediaIds: ["r3", "r1"] },
        },
        character: {
          visualProfile: {
            negativePrompt: "",
            providerConfig: null,
            referenceMedia: [
              reference("r1"),
              reference("r2"),
              reference("r3"),
              reference("r4"),
            ],
          },
        },
      }),
    );
    const provider = providerMock([
      { status: "completed", images: [{ url: "https://p.local/a.png" }] },
    ]);
    const { service } = makeService(repository, provider);

    await service.tick();

    // 기획 LLM이 고른 순서만 유지한다. r2/r4는 미선택이라 제외.
    expect(provider.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        references: [
          expect.objectContaining({
            id: "r3",
            primary: true,
            url: "https://cdn.local/r3.png",
          }),
          expect.objectContaining({
            id: "r1",
            url: "https://cdn.local/r1.png",
          }),
        ],
      }),
    );
  });

  it("does not send references when the shot marks the character as hidden", async () => {
    const reference = (mediaId: string) => ({
      mediaId,
      media: {
        url: `https://cdn.local/${mediaId}.png`,
        uploadedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    });
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(
      claimedJob({
        paramsJson: {
          _shot: {
            scene: "사람이 없는 철길",
            captureSetup: "촬영자는 프레임 밖에 있음",
            characterVisible: false,
            // 잘못 남은 ID가 있어도 비노출 계약이 우선한다.
            referenceMediaIds: ["r1"],
          },
        },
        character: {
          visualProfile: {
            negativePrompt: "",
            providerConfig: null,
            referenceMedia: [reference("r1")],
          },
        },
      }),
    );
    const provider = providerMock([
      { status: "completed", images: [{ url: "https://p.local/a.png" }] },
    ]);
    const { service } = makeService(repository, provider);

    await service.tick();

    expect(provider.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: "photoreal_scene_v1",
        references: [],
      }),
    );
  });

  // V3 계약: 인물 레퍼런스가 필요한지는 이미지 기획이 정한다. 손·팔뚝만 보이는
  // 컷은 "보이지만(mode≠none) 인물 레퍼런스 불필요"라 환경 레퍼런스만 묶는다.
  // V2 가드(보이면 인물 레퍼런스 필수)를 그대로 쓰면 이런 컷이 실패한다 —
  // 2026-08-16 한소이 첫 V4 초안에서 실제로 났다.
  it("lets a V3 hands-only shot run with only an environment reference", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(
      claimedJob({
        paramsJson: {
          _shot: {
            characterVisible: true,
            identityRequired: false,
            referenceMediaIds: ["desk-ref-1"],
          },
          _v3: {
            referenceBindings: [
              {
                bindingId: "env-home-desk-01",
                referenceId: "desk-ref-1",
                slot: "Image 1",
              },
            ],
            negativePrompt: null,
          },
        },
        draft: {
          location: {
            references: [
              {
                mediaId: "desk-ref-1",
                media: {
                  url: "https://cdn.local/desk.png",
                  storageKey: "pod/reference/desk.png",
                  uploadedAt: new Date("2026-07-01T00:00:00.000Z"),
                },
              },
            ],
          },
        },
      }),
    );
    const provider = providerMock([
      { status: "completed", images: [{ url: "https://p.local/a.png" }] },
    ]);
    const { service } = makeService(repository, provider);

    await service.tick();

    expect(repository.markFailed).not.toHaveBeenCalled();
    expect(provider.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: "photoreal_scene_v1",
        references: [
          expect.objectContaining({
            id: "desk-ref-1",
            role: "background",
            url: "https://cdn.local/desk.png",
          }),
        ],
      }),
    );
  });

  it("still refuses a V3 shot whose plan requires identity but has no identity reference", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(
      claimedJob({
        paramsJson: {
          _shot: {
            characterVisible: true,
            identityRequired: true,
            referenceMediaIds: [],
          },
          _v3: { referenceBindings: [], negativePrompt: null },
        },
      }),
    );
    const provider = providerMock([]);
    const { service } = makeService(repository, provider);

    await service.tick();

    expect(provider.submit).not.toHaveBeenCalled();
    expect(repository.markFailed).toHaveBeenCalledWith(
      "job-1",
      "shot job-1 shows the character but has no usable identity reference",
    );
  });

  it("rejects a V3 binding-to-asset mismatch instead of silently dropping it", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(
      claimedJob({
        paramsJson: {
          _shot: {
            characterVisible: false,
            referenceMediaIds: ["reference-1"],
          },
          _v3: {
            referenceBindings: [
              {
                bindingId: "environment-1",
                referenceId: "missing-reference",
                slot: "Image 1",
              },
            ],
            negativePrompt: null,
          },
        },
      }),
    );
    const provider = providerMock([]);
    const { service } = makeService(repository, provider);

    await service.tick();

    expect(provider.submit).not.toHaveBeenCalled();
    expect(repository.markFailed).toHaveBeenCalledWith(
      "job-1",
      "shot job-1 V3 reference binding/asset order mismatch",
    );
  });

  it("preserves a V3 reference contract even when identity is not visible", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(
      claimedJob({
        paramsJson: {
          _shot: {
            characterVisible: false,
            referenceMediaIds: ["reference-1"],
          },
          _v3: {
            referenceBindings: [
              {
                bindingId: "wardrobe-1",
                referenceId: "reference-1",
                slot: "Image 1",
              },
            ],
            negativePrompt: "no visible logos",
          },
        },
      }),
    );
    const provider = providerMock([
      { status: "completed", images: [{ url: "https://p.local/a.png" }] },
    ]);
    const { service } = makeService(repository, provider);

    await service.tick();

    expect(provider.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: "photoreal_scene_v1",
        references: [
          expect.objectContaining({
            id: "reference-1",
            role: "outfit",
            url: "https://cdn.local/reference.png",
          }),
        ],
        negativePrompt: "blurry, no visible logos",
      }),
    );
  });

  it("keeps location references for a hidden-character shot and combines negative prompts", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(
      claimedJob({
        paramsJson: {
          _shot: {
            characterVisible: false,
            referenceMediaIds: ["reference-1", "gym-ref-1"],
          },
        },
        draft: {
          location: {
            negativePrompt: "neon gym",
            // 빈 공간 레퍼런스를 만들 때만 쓰는 금지어 — 컷 요청에 섞이면
            // 인물이 나와야 하는 컷과 정면 모순이라 목록 전체가 무시된다.
            referenceNegativePrompt: "people, faces, silhouettes",
            references: [
              {
                mediaId: "gym-ref-1",
                media: {
                  url: "https://cdn.local/gym-ref-1.png",
                  storageKey: null,
                  uploadedAt: new Date("2026-07-01T00:00:00.000Z"),
                },
              },
            ],
          },
        },
      }),
    );
    const provider = providerMock([
      { status: "completed", images: [{ url: "https://p.local/a.png" }] },
    ]);
    const { service } = makeService(repository, provider);

    await service.tick();

    expect(provider.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        references: [
          expect.objectContaining({
            id: "gym-ref-1",
            role: "background",
            url: "https://cdn.local/gym-ref-1.png",
          }),
        ],
        negativePrompt: "blurry, neon gym",
      }),
    );
    const sent = provider.submit.mock.calls.at(-1)?.[0] as {
      negativePrompt?: string;
    };
    expect(sent.negativePrompt).not.toContain("people");
    expect(sent.negativePrompt).not.toContain("faces");
  });

  // 프로바이더가 네거티브를 본문 뒤에 합치는 모델이 있어 "저장본 ≠ 전송본"이었다.
  // 회귀하면 실제로 무엇이 나갔는지 다시 못 보게 되고, 연구 로그의 1차 증거가
  // 또 틀려진다(관측 4 부수 발견).
  it("stores the prompt the provider actually sent", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(claimedJob());
    const provider = providerMock([
      { status: "completed", images: [{ url: "https://p.local/a.png" }] },
    ]);
    provider.submit.mockResolvedValue({
      requestId: "req-1",
      sentPrompt: "film photo of a beach Do not include: blurry.",
    });
    const { service } = makeService(repository, provider);

    await service.tick();

    expect(repository.recordProviderSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        sentPrompt: "film photo of a beach Do not include: blurry.",
      }),
    );
  });

  it("presigns S3-backed reference urls before sending them to the provider", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(claimedJob());
    const provider = providerMock([
      { status: "completed", images: [{ url: "https://p.local/a.png" }] },
    ]);
    const sign = jest
      .fn()
      .mockResolvedValue("https://cdn.local/reference.png?signed=1");
    const { service } = makeService(
      repository,
      provider,
      {},
      undefined,
      undefined,
      sign,
    );

    await service.tick();

    // storageKey 있는 레퍼런스는 서명된 URL로 전송된다 (비공개 버킷 접근).
    expect(sign).toHaveBeenCalledWith("pod/reference/a.png");
    expect(provider.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        references: [
          expect.objectContaining({
            url: "https://cdn.local/reference.png?signed=1",
          }),
        ],
      }),
    );
  });

  it("strips underscore-prefixed metadata keys from provider params", async () => {
    const repository = repositoryFake();
    repository.claimNextQueuedImageJob.mockResolvedValueOnce("job-1");
    repository.findForProcessing.mockResolvedValue(
      claimedJob({
        // 위저드가 남긴 파이프라인 메타데이터 — 프로바이더에 전달되면 안 된다.
        paramsJson: {
          seed: 42,
          _wizard: { plannerName: "llm:test", expandedScene: "장면" },
        },
      }),
    );
    const provider = providerMock([
      { status: "completed", images: [{ url: "https://p.local/a.png" }] },
    ]);
    const { service } = makeService(repository, provider);

    await service.tick();

    expect(provider.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        extraParams: { aspect_ratio: "4:5", seed: 42 },
      }),
    );
  });
});
