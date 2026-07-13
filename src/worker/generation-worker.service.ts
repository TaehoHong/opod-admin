import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "../domain/database/prisma.service";
import { GeneratedMediaStore } from "./generated-media-store";
import {
  GeneratedImage,
  ImageGenerationProvider,
} from "./image-generation.provider";

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

// 프로바이더가 잡 자체를 거부/실패 처리한 경우. 재시도 시 requestId를 버리고
// 새로 제출해야 한다 (transient 오류는 requestId를 유지해 폴링을 이어받는다).
export class ProviderJobFailedError extends Error {}

type ClaimedJob = {
  id: string;
  characterId: string;
  prompt: string;
  status: string;
  attemptCount: number;
  provider: string | null;
  providerRequestId: string | null;
  paramsJson: unknown;
  character: {
    visualProfile: {
      negativePrompt: string;
      referenceMedia: {
        media: { url: string; uploadedAt: Date | null };
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: ImageGenerationProvider,
    private readonly store: GeneratedMediaStore,
    private readonly config: WorkerConfig,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
    private readonly downloadBytes: (url: string) => Promise<Buffer> = download,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled) {
      this.logger.log("Generation worker is disabled (WORKER_ENABLED)");
      return;
    }
    this.logger.log(
      `Generation worker enabled (provider=${this.provider.name}, interval=${this.config.pollIntervalMs}ms)`,
    );
    this.scheduleNext();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    await this.activeTick;
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
                    media: { select: { url: true, uploadedAt: true } },
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

    try {
      const result = await this.generate(job);
      await this.persistSuccess(job, result);
      this.consecutiveFailures = 0;
      this.logger.log(`Job ${job.id} completed via ${this.provider.name}`);
    } catch (error) {
      await this.handleFailure(job, error);
    }
  }

  private async generate(job: ClaimedJob): Promise<CompletedGeneration> {
    let requestId = job.providerRequestId ?? undefined;
    // 이전 시도가 다른 프로바이더로 제출했던 잡은 이어받을 수 없으므로 새로 제출한다.
    if (!requestId || job.provider !== this.provider.name) {
      const submitted = await this.provider.submit(this.buildRequest(job));
      requestId = submitted.requestId;
      // 제출 직후 기록해야 크래시 후 재수용 시 이중 제출을 막는다.
      await this.prisma.generationJob.updateMany({
        where: { id: job.id, status: "running" },
        data: { providerRequestId: requestId, provider: this.provider.name },
      });
    }

    const deadline = Date.now() + this.config.providerTimeoutMs;
    for (;;) {
      const result = await this.provider.poll(requestId);
      if (result.status === "completed") {
        return result;
      }
      if (result.status === "failed") {
        throw new ProviderJobFailedError(result.errorMessage);
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `provider polling timed out after ${this.config.providerTimeoutMs}ms`,
        );
      }
      await this.extendLease(job.id);
      await this.sleep(this.config.providerPollIntervalMs);
    }
  }

  private buildRequest(job: ClaimedJob) {
    const profile = job.character.visualProfile;
    const referenceImageUrls = (profile?.referenceMedia ?? [])
      .filter((reference) => reference.media.uploadedAt)
      .map((reference) => reference.media.url);
    return {
      prompt: job.prompt,
      negativePrompt: profile?.negativePrompt || undefined,
      referenceImageUrls,
      candidateCount: this.config.candidateCount,
      extraParams: isRecord(job.paramsJson) ? job.paramsJson : undefined,
    };
  }

  // 출력 다운로드 → 우리 스토리지 업로드 → Media(uploadedAt 확정, isAiGenerated)
  // → 후보 기록 → completed 전이. 영속화는 한 트랜잭션으로 묶는다.
  private async persistSuccess(
    job: ClaimedJob,
    result: CompletedGeneration,
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
          outputMediaId: mediaIds[0],
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
          selected: index === 0,
        })),
      });
      await tx.characterActionLog.create({
        data: {
          characterId: job.characterId,
          actionType: "GENERATION_JOB_COMPLETED",
          targetTable: "generation_jobs",
          targetId: job.id,
          reason: `generation worker completed job via ${this.provider.name}`,
        },
      });
    });
  }

  private async handleFailure(job: ClaimedJob, error: unknown): Promise<void> {
    const message = errorMessage(error).slice(0, 500);
    this.logger.warn(
      `Job ${job.id} attempt ${job.attemptCount} failed: ${message}`,
    );

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.config.circuitBreakerThreshold) {
      this.circuitOpenUntil = Date.now() + this.config.circuitBreakerCooldownMs;
      this.consecutiveFailures = 0;
      this.logger.error(
        `Circuit breaker opened for ${this.config.circuitBreakerCooldownMs}ms after consecutive failures`,
      );
    }

    if (job.attemptCount >= this.config.maxAttempts) {
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

function startOfKstDay(now: Date = new Date()): Date {
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parsePositiveNumber(value: string | undefined): number | undefined {
  const parsed = Number(value?.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
