import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "../domain/database/prisma.service";
import {
  GeneratedMediaStore,
  ReferenceUrlSigner,
} from "./generated-media-store";
import {
  GeneratedImage,
  ImageGenerationProvider,
  ImageGenerationProviders,
  ImageGenerationRequest,
} from "./image-generation.provider";
import { errorMessage, isRecord, parsePositiveNumber } from "./value-utils";

export type WorkerConfig = {
  enabled: boolean;
  pollIntervalMs: number;
  jobsPerTick: number;
  leaseSeconds: number;
  maxAttempts: number;
  providerPollIntervalMs: number;
  providerTimeoutMs: number;
  candidateCount: number;
  // 미설정이면 예산 게이트를 걸지 않는다.
  dailyBudgetUsd?: number;
  // fal 등은 요청별 비용을 응답에 싣지 않으므로, 모델 단가 × 후보 수로 맞춘
  // 추정 단가를 기록·예산 계산에 쓴다.
  jobCostEstimateUsd: number;
  circuitBreakerThreshold: number;
  circuitBreakerCooldownMs: number;
};

export function workerConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): WorkerConfig {
  return {
    enabled: env.WORKER_ENABLED === "true" || env.WORKER_ENABLED === "1",
    pollIntervalMs: parsePositiveNumber(env.WORKER_POLL_INTERVAL_MS) ?? 15_000,
    jobsPerTick: parsePositiveNumber(env.WORKER_JOBS_PER_TICK) ?? 1,
    leaseSeconds: parsePositiveNumber(env.WORKER_LEASE_SECONDS) ?? 600,
    maxAttempts: parsePositiveNumber(env.WORKER_MAX_ATTEMPTS) ?? 3,
    providerPollIntervalMs:
      parsePositiveNumber(env.WORKER_PROVIDER_POLL_INTERVAL_MS) ?? 5_000,
    providerTimeoutMs:
      parsePositiveNumber(env.WORKER_PROVIDER_TIMEOUT_MS) ?? 5 * 60_000,
    candidateCount: parsePositiveNumber(env.WORKER_CANDIDATE_COUNT) ?? 2,
    dailyBudgetUsd: parsePositiveNumber(env.WORKER_DAILY_BUDGET_USD),
    jobCostEstimateUsd:
      parsePositiveNumber(env.WORKER_JOB_COST_ESTIMATE_USD) ?? 0.2,
    circuitBreakerThreshold:
      parsePositiveNumber(env.WORKER_CIRCUIT_BREAKER_THRESHOLD) ?? 5,
    circuitBreakerCooldownMs:
      parsePositiveNumber(env.WORKER_CIRCUIT_BREAKER_COOLDOWN_MS) ?? 5 * 60_000,
  };
}

// fal edit 계열(nano-banana/edit 등)의 image_urls 상한 — 초과 시 422
// value_error. 장면별 레퍼런스 선별(LLM 선별)이 들어와도 전송 직전 안전판으로
// 유지한다 (docs/media-generation-pipeline.md "컨텍스트 선별").
const MAX_REFERENCE_IMAGES = 10;
// 정체성 고정용 앵커 — 선별 결과와 무관하게 항상 포함하는 대표컷 수.
const REFERENCE_ANCHOR_COUNT = 2;

// 잡 paramsJson._shot.referenceMediaIds — 기획 LLM이 이 샷에 고른 레퍼런스.
function shotReferenceMediaIds(paramsJson: unknown): string[] {
  if (!isRecord(paramsJson) || !isRecord(paramsJson._shot)) {
    return [];
  }
  const ids = paramsJson._shot.referenceMediaIds;
  return Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === "string")
    : [];
}

// 프로바이더가 잡 자체를 거부/실패 처리한 경우. 재시도 시 requestId를 버리고
// 새로 제출해야 한다 (transient 오류는 requestId를 유지해 폴링을 이어받는다).
// permanent = 입력 검증 실패(422 등) — 재시도 없이 즉시 failed 처리한다.
export class ProviderJobFailedError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean = false,
  ) {
    super(message);
  }
}

type ClaimedJob = {
  id: string;
  characterId: string;
  prompt: string;
  status: string;
  attemptCount: number;
  candidateCount: number | null;
  provider: string | null;
  providerRequestId: string | null;
  paramsJson: unknown;
  character: {
    visualProfile: {
      negativePrompt: string;
      providerConfig: unknown;
      referenceMedia: {
        mediaId: string;
        media: {
          url: string;
          storageKey: string | null;
          uploadedAt: Date | null;
        };
      }[];
    } | null;
  };
};

type CompletedGeneration = {
  images: GeneratedImage[];
  costUsd?: number;
};

@Injectable()
export class GenerationWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GenerationWorkerService.name);
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private activeTick?: Promise<void>;
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  // 수동 실행(runJobNow)이 백그라운드로 돌린 처리들. 셧다운 시 대기한다.
  private readonly manualRuns = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    // 잡 처리 시마다 재해석한다 — admin 설정(UI)에서 키/모델을 바꾸면
    // 프로세스 재시작 없이 다음 잡부터 반영된다.
    private readonly resolveProviders: () => Promise<ImageGenerationProviders>,
    private readonly store: GeneratedMediaStore,
    private readonly config: WorkerConfig,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
    private readonly downloadBytes: (url: string) => Promise<Buffer> = download,
    // 자사 S3 레퍼런스를 프로바이더가 받을 수 있게 서명한다(버킷 비공개 유지).
    // null이면 원본 URL 그대로 전송 (공개 버킷/외부 URL 전제).
    private readonly signReferenceUrl: ReferenceUrlSigner | null = null,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled) {
      this.logger.log("Generation worker is disabled (WORKER_ENABLED)");
      return;
    }
    void this.resolveProviders()
      .then((providers) =>
        this.logger.log(
          `Generation worker enabled (t2i=${providers.t2i.name}, edit=${providers.edit.name}, interval=${this.config.pollIntervalMs}ms)`,
        ),
      )
      .catch(() =>
        this.logger.log(
          `Generation worker enabled (interval=${this.config.pollIntervalMs}ms)`,
        ),
      );
    this.scheduleNext();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    await this.activeTick;
    await Promise.allSettled(this.manualRuns);
  }

  // admin의 수동 실행. 지정 잡(또는 다음 queued 잡)을 claim만 하고
  // 처리는 백그라운드로 넘긴다 — HTTP 응답이 생성 완료를 기다리지 않는다.
  // WORKER_ENABLED와 무관하게 동작한다 (자동 루프만 env로 제어).
  async runJobNow(jobId?: string): Promise<{ jobId: string | null }> {
    const claimed = jobId
      ? await this.claimSpecificJob(jobId)
      : await this.claimNextJob();
    if (!claimed) {
      return { jobId: null };
    }
    const run = this.processJob(claimed)
      .catch((error) =>
        this.logger.error(
          `Manual run ${claimed} failed: ${errorMessage(error)}`,
        ),
      )
      .finally(() => this.manualRuns.delete(run));
    this.manualRuns.add(run);
    return { jobId: claimed };
  }

  // 특정 queued 이미지 잡을 조건부 전이로 claim한다. queued가 아니면 null.
  private async claimSpecificJob(jobId: string): Promise<string | undefined> {
    const claimed = await this.prisma.generationJob.updateMany({
      where: { id: jobId, status: "queued", mediaType: "image" },
      data: {
        status: "running",
        leaseExpiresAt: new Date(Date.now() + this.config.leaseSeconds * 1000),
        attemptCount: { increment: 1 },
      },
    });
    return claimed.count > 0 ? jobId : undefined;
  }

  private scheduleNext(): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      this.activeTick = this.runTick();
    }, this.config.pollIntervalMs);
  }

  private async runTick(): Promise<void> {
    try {
      await this.tick();
    } catch (error) {
      this.logger.error(`Worker tick failed: ${errorMessage(error)}`);
    } finally {
      this.scheduleNext();
    }
  }

  // 한 틱: 좀비 회수 → (서킷/예산 게이트) → claim → 처리. 테스트에서 직접 호출한다.
  async tick(): Promise<void> {
    await this.sweepExpiredLeases();
    for (let processed = 0; processed < this.config.jobsPerTick; processed++) {
      if (this.circuitOpen() || !(await this.withinDailyBudget())) {
        return;
      }
      const jobId = await this.claimNextJob();
      if (!jobId) {
        return;
      }
      await this.processJob(jobId);
    }
  }

  // lease가 만료된 running 잡을 회수한다. 시도 여유가 있으면 queued로 되돌리고,
  // 소진했으면 failed 처리한다. 배포/크래시로 중단된 잡의 유일한 복구 경로.
  private async sweepExpiredLeases(): Promise<void> {
    const now = new Date();
    const requeued = await this.prisma.generationJob.updateMany({
      where: {
        status: "running",
        leaseExpiresAt: { lt: now },
        attemptCount: { lt: this.config.maxAttempts },
      },
      data: { status: "queued", leaseExpiresAt: null },
    });
    if (requeued.count > 0) {
      this.logger.warn(`Requeued ${requeued.count} expired-lease job(s)`);
    }

    const exhausted = await this.prisma.generationJob.findMany({
      where: {
        status: "running",
        leaseExpiresAt: { lt: now },
        attemptCount: { gte: this.config.maxAttempts },
      },
      select: { id: true, characterId: true, attemptCount: true },
    });
    for (const job of exhausted) {
      const message = `lease expired after ${job.attemptCount} attempt(s)`;
      const transitioned = await this.prisma.generationJob.updateMany({
        where: { id: job.id, status: "running" },
        data: { status: "failed", errorMessage: message, leaseExpiresAt: null },
      });
      if (transitioned.count > 0) {
        await this.recordActionLog(job.characterId, job.id, {
          actionType: "GENERATION_JOB_FAILED",
          reason: message,
        });
      }
    }
  }

  private circuitOpen(): boolean {
    return Date.now() < this.circuitOpenUntil;
  }

  private async withinDailyBudget(): Promise<boolean> {
    if (this.config.dailyBudgetUsd === undefined) {
      return true;
    }
    const aggregate = await this.prisma.generationJob.aggregate({
      _sum: { costUsd: true },
      where: {
        updatedAt: { gte: startOfKstDay() },
        costUsd: { not: null },
      },
    });
    const spent = Number(aggregate._sum.costUsd ?? 0);
    const within =
      spent + this.config.jobCostEstimateUsd <= this.config.dailyBudgetUsd;
    if (!within) {
      this.logger.warn(
        `Daily generation budget reached (${spent.toFixed(2)}/${this.config.dailyBudgetUsd} USD); pausing claims`,
      );
    }
    return within;
  }

  // FOR UPDATE SKIP LOCKED으로 queued 이미지 잡 하나를 원자적으로 집는다.
  // 여러 워커 인스턴스가 떠도 같은 잡을 중복 처리하지 않는다.
  private async claimNextJob(): Promise<string | undefined> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE opod.generation_jobs
      SET status = 'running',
          lease_expires_at = now() + make_interval(secs => ${this.config.leaseSeconds}),
          attempt_count = attempt_count + 1,
          updated_at = now()
      WHERE id = (
        SELECT id FROM opod.generation_jobs
        WHERE status = 'queued' AND media_type = 'image'
        ORDER BY created_at, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `;
    return rows[0]?.id;
  }

  private async processJob(jobId: string): Promise<void> {
    const job = (await this.prisma.generationJob.findUnique({
      where: { id: jobId },
      include: {
        character: {
          include: {
            visualProfile: {
              include: {
                referenceMedia: {
                  orderBy: { sortOrder: "asc" },
                  include: {
                    media: {
                      select: { url: true, storageKey: true, uploadedAt: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })) as ClaimedJob | null;
    if (!job || job.status !== "running") {
      return;
    }

    // 레퍼런스가 있으면 edit(컨디셔닝) 모델, 없으면(콜드스타트) t2i 모델.
    // edit 계열은 image_urls가 필수라 레퍼런스 없는 잡을 보낼 수 없다.
    const request = await this.buildRequest(job);
    const providers = await this.resolveProviders();
    const provider =
      request.referenceImageUrls.length > 0 ? providers.edit : providers.t2i;

    try {
      const result = await this.generate(job, provider, request);
      await this.persistSuccess(job, result, provider.name);
      this.consecutiveFailures = 0;
      this.logger.log(`Job ${job.id} completed via ${provider.name}`);
    } catch (error) {
      await this.handleFailure(job, error);
    }
  }

  private async generate(
    job: ClaimedJob,
    provider: ImageGenerationProvider,
    request: ImageGenerationRequest,
  ): Promise<CompletedGeneration> {
    let requestId = job.providerRequestId ?? undefined;
    // 이전 시도가 다른 프로바이더로 제출했던 잡은 이어받을 수 없으므로 새로 제출한다.
    // (시도 사이에 레퍼런스가 승격되어 라우팅이 바뀐 경우도 여기에 해당한다.)
    if (!requestId || job.provider !== provider.name) {
      const submitted = await provider.submit(request);
      requestId = submitted.requestId;
      // 제출 직후 기록해야 크래시 후 재수용 시 이중 제출을 막는다.
      await this.prisma.generationJob.updateMany({
        where: { id: job.id, status: "running" },
        data: { providerRequestId: requestId, provider: provider.name },
      });
    }

    const deadline = Date.now() + this.config.providerTimeoutMs;
    for (;;) {
      const result = await provider.poll(requestId);
      if (result.status === "completed") {
        return result;
      }
      if (result.status === "failed") {
        throw new ProviderJobFailedError(
          result.errorMessage,
          result.permanent === true,
        );
      }
      if (Date.now() >= deadline) {
        // 아직 큐에서 시작 전이라면 과금 전에 취소를 시도한다 (베스트에포트).
        await provider.cancel?.(requestId);
        throw new Error(
          `provider polling timed out after ${this.config.providerTimeoutMs}ms`,
        );
      }
      await this.extendLease(job.id);
      await this.sleep(this.config.providerPollIntervalMs);
    }
  }

  private async buildRequest(job: ClaimedJob): Promise<ImageGenerationRequest> {
    const profile = job.character.visualProfile;
    // sortOrder 순 업로드 완료 레퍼런스.
    const uploaded = (profile?.referenceMedia ?? []).filter(
      (reference) => reference.media.uploadedAt,
    );
    // 기획 LLM이 이 샷에 고른 레퍼런스 (docs/media-generation-pipeline.md
    // "컨텍스트 선별"). 앵커(sortOrder 상위 2장 — 정체성 고정)는 항상 포함하고,
    // 선별분을 뒤에 붙인다. 선별이 없으면 전체(폴백)를 쓴다.
    const selectedIds = shotReferenceMediaIds(job.paramsJson);
    let ordered = uploaded;
    if (selectedIds.length > 0) {
      const anchors = uploaded.slice(0, REFERENCE_ANCHOR_COUNT);
      const anchorIds = new Set(anchors.map((reference) => reference.mediaId));
      const selected = selectedIds
        .filter((mediaId) => !anchorIds.has(mediaId))
        .map((mediaId) =>
          uploaded.find((reference) => reference.mediaId === mediaId),
        )
        .filter(
          (reference): reference is (typeof uploaded)[number] =>
            reference !== undefined,
        );
      ordered = [...anchors, ...selected];
    }
    // fal edit 계열의 image_urls 상한(10장 초과 시 422 value_error) 안전판.
    if (ordered.length > MAX_REFERENCE_IMAGES) {
      this.logger.warn(
        `Job ${job.id}: ${ordered.length} reference images exceed the provider limit; sending first ${MAX_REFERENCE_IMAGES}`,
      );
    }
    // 자사 S3 객체(storageKey 있음)는 presigned URL로 서명해 보낸다 —
    // 버킷을 공개로 열지 않아도 프로바이더가 다운로드할 수 있다.
    const referenceImageUrls = await Promise.all(
      ordered
        .slice(0, MAX_REFERENCE_IMAGES)
        .map((reference) =>
          this.signReferenceUrl && reference.media.storageKey
            ? this.signReferenceUrl(reference.media.storageKey)
            : Promise.resolve(reference.media.url),
        ),
    );
    // 프로필의 프로바이더 기본값(providerConfig) 위에 잡별 파라미터(paramsJson)를
    // 덮어쓴다. 종횡비 등 모델별 파라미터는 코드가 아니라 이 데이터로 주입한다.
    // 밑줄 접두 키(_wizard 등)는 파이프라인 메타데이터 — 프로바이더에 보내지 않는다.
    const extraParams = stripMetaKeys({
      ...(isRecord(profile?.providerConfig) ? profile.providerConfig : {}),
      ...(isRecord(job.paramsJson) ? job.paramsJson : {}),
    });
    return {
      prompt: job.prompt,
      negativePrompt: profile?.negativePrompt || undefined,
      referenceImageUrls,
      candidateCount: job.candidateCount ?? this.config.candidateCount,
      extraParams:
        Object.keys(extraParams).length > 0 ? extraParams : undefined,
    };
  }

  // 출력 다운로드 → 우리 스토리지 업로드 → Media(uploadedAt 확정, isAiGenerated)
  // → 후보 기록 → completed 전이. 영속화는 한 트랜잭션으로 묶는다.
  private async persistSuccess(
    job: ClaimedJob,
    result: CompletedGeneration,
    providerName: string,
  ): Promise<void> {
    const stored: {
      image: GeneratedImage;
      url: string;
      storageKey?: string;
      contentType: string;
      byteSize: number;
    }[] = [];
    for (const image of result.images) {
      const bytes = await this.downloadBytes(image.url);
      const contentType = image.contentType ?? "image/png";
      const file = await this.store({
        bytes,
        contentType,
        keyPrefix: `pod/generated/character/${job.characterId}`,
      });
      stored.push({
        image,
        url: file.url,
        storageKey: file.storageKey,
        contentType,
        byteSize: bytes.byteLength,
      });
    }
    const costUsd = result.costUsd ?? this.config.jobCostEstimateUsd;

    await this.prisma.$transaction(async (tx) => {
      const mediaIds: string[] = [];
      for (const file of stored) {
        const media = await tx.media.create({
          data: {
            mediaType: "image",
            url: file.url,
            storageKey: file.storageKey,
            contentType: file.contentType,
            byteSize: file.byteSize,
            width: file.image.width,
            height: file.image.height,
            isAiGenerated: true,
            uploadedAt: new Date(),
          },
          select: { id: true },
        });
        mediaIds.push(media.id);
      }
      const transitioned = await tx.generationJob.updateMany({
        where: { id: job.id, status: "running" },
        data: {
          status: "completed",
          outputMediaId: null,
          costUsd,
          leaseExpiresAt: null,
          errorMessage: null,
        },
      });
      if (transitioned.count === 0) {
        throw new Error("job left the running state during persistence");
      }
      await tx.generationJobOutput.createMany({
        data: mediaIds.map((mediaId, index) => ({
          jobId: job.id,
          mediaId,
          candidateIndex: index,
          selected: false,
        })),
      });
      await tx.characterActionLog.create({
        data: {
          characterId: job.characterId,
          actionType: "GENERATION_JOB_COMPLETED",
          targetTable: "generation_jobs",
          targetId: job.id,
          reason: `generation worker completed job via ${providerName}`,
        },
      });
    });
  }

  private async handleFailure(job: ClaimedJob, error: unknown): Promise<void> {
    const message = errorMessage(error).slice(0, 500);
    this.logger.warn(
      `Job ${job.id} attempt ${job.attemptCount} failed: ${message}`,
    );

    // 입력 검증 실패(permanent)는 프로바이더 장애가 아니다 — 재시도해도 항상
    // 같은 결과이므로 즉시 실패 처리하고, 서킷브레이커에도 집계하지 않는다.
    const permanent =
      error instanceof ProviderJobFailedError && error.permanent;
    if (!permanent) {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= this.config.circuitBreakerThreshold) {
        this.circuitOpenUntil =
          Date.now() + this.config.circuitBreakerCooldownMs;
        this.consecutiveFailures = 0;
        this.logger.error(
          `Circuit breaker opened for ${this.config.circuitBreakerCooldownMs}ms after consecutive failures`,
        );
      }
    }

    if (permanent || job.attemptCount >= this.config.maxAttempts) {
      const transitioned = await this.prisma.generationJob.updateMany({
        where: { id: job.id, status: "running" },
        data: { status: "failed", errorMessage: message, leaseExpiresAt: null },
      });
      if (transitioned.count > 0) {
        await this.recordActionLog(job.characterId, job.id, {
          actionType: "GENERATION_JOB_FAILED",
          reason: message,
        });
      }
      return;
    }

    await this.prisma.generationJob.updateMany({
      where: { id: job.id, status: "running" },
      data: {
        status: "queued",
        leaseExpiresAt: null,
        errorMessage: message,
        // 프로바이더가 잡을 거부한 경우에만 requestId를 버리고 재제출한다.
        // transient 오류는 requestId를 유지해 다음 시도가 폴링을 이어받는다.
        ...(error instanceof ProviderJobFailedError
          ? { providerRequestId: null }
          : {}),
      },
    });
  }

  private async extendLease(jobId: string): Promise<void> {
    await this.prisma.generationJob.updateMany({
      where: { id: jobId, status: "running" },
      data: {
        leaseExpiresAt: new Date(Date.now() + this.config.leaseSeconds * 1000),
      },
    });
  }

  private async recordActionLog(
    characterId: string,
    jobId: string,
    input: { actionType: string; reason: string },
  ): Promise<void> {
    try {
      await this.prisma.characterActionLog.create({
        data: {
          characterId,
          actionType: input.actionType,
          targetTable: "generation_jobs",
          targetId: jobId,
          reason: input.reason,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to record action log: ${errorMessage(error)}`);
    }
  }
}

// 예산 게이트/오늘 지출 집계의 KST 자정 기준 (설정 API에서도 재사용).
export function startOfKstDay(now: Date = new Date()): Date {
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kst = new Date(now.getTime() + kstOffsetMs);
  kst.setUTCHours(0, 0, 0, 0);
  return new Date(kst.getTime() - kstOffsetMs);
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw new Error(`generated media download failed (${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 밑줄 접두 키는 파이프라인 메타데이터(예: 위저드의 _wizard) — 프로바이더
// API 파라미터가 아니므로 제출 전에 걸러낸다.
function stripMetaKeys(
  params: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([key]) => !key.startsWith("_")),
  );
}
