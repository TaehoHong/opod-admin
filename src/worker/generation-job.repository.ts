import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../domain/database/prisma.service";
import { LLM_LOG_TYPE } from "../domain/llm-logs/llm-log.service";

// entity repository — PrismaService는 이 계층에서만 쓴다
// (docs/02-development-rules.md "Module and Repository Rules").
//
// 생성 워커의 큐 조작을 모은다. claim/lease/전이는 전부 조건부 갱신이라
// 영향받은 행 수로 성공을 판정한다 — 여러 인스턴스가 떠도 한 잡을 한 번만
// 처리하기 위해서다.

const jobWithProfile = {
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
} as const;

export type GenerationJobWithProfile = Prisma.GenerationJobGetPayload<{
  include: typeof jobWithProfile;
}>;

export type ExpiredLeaseJob = {
  id: string;
  characterId: string;
  attemptCount: number;
};

export type GeneratedFile = {
  url: string;
  // store가 외부 URL을 그대로 쓰면 storageKey가 없다.
  storageKey?: string | null;
  contentType: string;
  byteSize: number;
  // 프로바이더가 크기를 안 주는 경우가 있어 선택 항목이다.
  image: { width?: number; height?: number };
};

@Injectable()
export class GenerationJobRepository {
  constructor(private readonly prisma: PrismaService) {}

  // FOR UPDATE SKIP LOCKED으로 queued 이미지 잡 하나를 원자적으로 집는다.
  // Prisma에 동등한 표현이 없어 raw SQL을 쓰되 repository 안에 둔다
  // (docs/02-development-rules.md:90). 값은 tagged template의 바인딩으로만
  // 들어간다.
  async claimNextQueuedImageJob(
    leaseSeconds: number,
  ): Promise<string | undefined> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE opod.generation_jobs
      SET status = 'running',
          lease_expires_at = now() + make_interval(secs => ${leaseSeconds}),
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

  // 지정한 잡이 아직 queued일 때만 집는다. 아니면 undefined.
  async claimQueuedImageJob(
    jobId: string,
    leaseSeconds: number,
  ): Promise<string | undefined> {
    const claimed = await this.prisma.generationJob.updateMany({
      where: { id: jobId, status: "queued", mediaType: "image" },
      data: {
        status: "running",
        leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1000),
        attemptCount: { increment: 1 },
      },
    });
    return claimed.count > 0 ? jobId : undefined;
  }

  async requeueExpiredLeases(now: Date, maxAttempts: number): Promise<number> {
    const requeued = await this.prisma.generationJob.updateMany({
      where: {
        status: "running",
        leaseExpiresAt: { lt: now },
        attemptCount: { lt: maxAttempts },
      },
      data: { status: "queued", leaseExpiresAt: null },
    });
    return requeued.count;
  }

  findExhaustedLeases(
    now: Date,
    maxAttempts: number,
  ): Promise<ExpiredLeaseJob[]> {
    return this.prisma.generationJob.findMany({
      where: {
        status: "running",
        leaseExpiresAt: { lt: now },
        attemptCount: { gte: maxAttempts },
      },
      select: { id: true, characterId: true, attemptCount: true },
    });
  }

  // running일 때만 전이한다 — 이미 다른 경로가 손댔으면 false.
  async markFailed(jobId: string, message: string): Promise<boolean> {
    const transitioned = await this.prisma.generationJob.updateMany({
      where: { id: jobId, status: "running" },
      data: { status: "failed", errorMessage: message, leaseExpiresAt: null },
    });
    return transitioned.count > 0;
  }

  async requeueForRetry(input: {
    jobId: string;
    message: string;
    clearProviderRequestId: boolean;
  }): Promise<void> {
    await this.prisma.generationJob.updateMany({
      where: { id: input.jobId, status: "running" },
      data: {
        status: "queued",
        leaseExpiresAt: null,
        errorMessage: input.message,
        ...(input.clearProviderRequestId ? { providerRequestId: null } : {}),
      },
    });
  }

  async sumCostSince(since: Date): Promise<number> {
    const aggregate = await this.prisma.generationJob.aggregate({
      _sum: { costUsd: true },
      where: { updatedAt: { gte: since }, costUsd: { not: null } },
    });
    return Number(aggregate._sum.costUsd ?? 0);
  }

  findForProcessing(jobId: string): Promise<GenerationJobWithProfile | null> {
    return this.prisma.generationJob.findUnique({
      where: { id: jobId },
      include: jobWithProfile,
    });
  }

  // 제출 직후 기록해야 크래시 후 재수용 시 이중 제출을 막는다.
  async recordProviderSubmission(input: {
    jobId: string;
    providerRequestId: string;
    provider: string;
  }): Promise<void> {
    await this.prisma.generationJob.updateMany({
      where: { id: input.jobId, status: "running" },
      data: {
        providerRequestId: input.providerRequestId,
        provider: input.provider,
      },
    });
  }

  async extendLease(jobId: string, leaseSeconds: number): Promise<void> {
    await this.prisma.generationJob.updateMany({
      where: { id: jobId, status: "running" },
      data: {
        leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1000),
      },
    });
  }

  // 미디어 생성, 잡 전이, 후보 등록, LLM 로그 연결, 액션 로그가 한 덩어리여야
  // 한다. 중간에 끊기면 완료된 잡에 결과물이 붙지 않는다.
  async persistSuccess(input: {
    jobId: string;
    characterId: string;
    files: GeneratedFile[];
    costUsd: number;
    providerName: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const mediaIds: string[] = [];
      for (const file of input.files) {
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
        where: { id: input.jobId, status: "running" },
        data: {
          status: "completed",
          outputMediaId: null,
          costUsd: input.costUsd,
          leaseExpiresAt: null,
          errorMessage: null,
        },
      });
      if (transitioned.count === 0) {
        throw new Error("job left the running state during persistence");
      }
      await tx.generationJobOutput.createMany({
        data: mediaIds.map((mediaId, index) => ({
          jobId: input.jobId,
          mediaId,
          candidateIndex: index,
          selected: false,
        })),
      });
      const llmLog = await tx.llmLog.findFirst({
        where: {
          type: LLM_LOG_TYPE.imageGenerate,
          generationJobId: input.jobId,
        },
        orderBy: { id: "desc" },
        select: { id: true },
      });
      if (llmLog) {
        await tx.llmLogMedia.createMany({
          data: mediaIds.map((mediaId, sortOrder) => ({
            llmLogId: llmLog.id,
            mediaId,
            role: "output",
            sortOrder,
          })),
          skipDuplicates: true,
        });
      }
      await tx.characterActionLog.create({
        data: {
          characterId: input.characterId,
          actionType: "GENERATION_JOB_COMPLETED",
          targetTable: "generation_jobs",
          targetId: input.jobId,
          reason: `generation worker completed job via ${input.providerName}`,
        },
      });
    });
  }

  async recordActionLog(input: {
    characterId: string;
    jobId: string;
    actionType: string;
    reason: string;
  }): Promise<void> {
    await this.prisma.characterActionLog.create({
      data: {
        characterId: input.characterId,
        actionType: input.actionType,
        targetTable: "generation_jobs",
        targetId: input.jobId,
        reason: input.reason,
      },
    });
  }
}
