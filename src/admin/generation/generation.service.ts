import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  decodeCursor,
  Page,
  PageInput,
  pageFromRows,
} from "../../domain/database/page";
import { PrismaService } from "../../domain/database/prisma.service";
import { assertUploadedMedia } from "../media/media.service";

type MediaType = "image" | "video";
type JobStatus = "queued" | "running" | "completed" | "failed";

// 수동 start 경로에도 lease를 걸어, 워커 스윕이 방치된 running 잡을 회수할 수 있게 한다.
const MANUAL_START_LEASE_MS = 10 * 60 * 1000;

type OutputMedia = {
  mediaType: MediaType;
  url: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
};

type OutputCandidate = {
  mediaId: string;
  url: string;
  candidateIndex: number;
  selected: boolean;
};

type GenerationJob = {
  id: string;
  characterId: string;
  mediaType: MediaType;
  prompt: string;
  status: JobStatus;
  provider?: string;
  attemptCount: number;
  originJobId?: string;
  errorMessage?: string;
  costUsd?: string;
  outputMedia?: OutputMedia;
  outputs?: OutputCandidate[];
  createdAt: string;
  updatedAt: string;
};

type PrismaOutputMedia = {
  mediaType: MediaType;
  url: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
};

type PrismaJobOutput = {
  mediaId: string;
  candidateIndex: number;
  selected: boolean;
  media: { url: string };
};

type PrismaGenerationJob = Omit<
  GenerationJob,
  | "createdAt"
  | "updatedAt"
  | "outputMedia"
  | "outputs"
  | "provider"
  | "attemptCount"
  | "originJobId"
  | "errorMessage"
  | "costUsd"
> & {
  createdAt: Date;
  updatedAt: Date;
  provider?: string | null;
  attemptCount?: number | null;
  originJobId?: string | null;
  errorMessage?: string | null;
  costUsd?: { toString(): string } | null;
  outputMedia: PrismaOutputMedia | null;
  outputs?: PrismaJobOutput[];
};

@Injectable()
export class GenerationService {
  constructor(private readonly prisma: PrismaService) {}

  async listJobs(
    input: {
      characterId?: string;
      status?: string;
      mediaType?: string;
    } & PageInput,
  ): Promise<Page<GenerationJob>> {
    const characterId = input.characterId?.trim();
    const status = this.parseOptionalStatus(input.status);
    const mediaType = this.parseOptionalMediaType(input.mediaType);
    const where = {
      ...(characterId ? { characterId } : {}),
      ...(status ? { status } : {}),
      ...(mediaType ? { mediaType } : {}),
    };
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.prisma.generationJob.findFirst({
        where: { id: cursorId, ...where },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const jobs = await this.prisma.generationJob.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      include: this.jobWithOutput,
    });
    return pageFromRows(
      jobs.map((job) => this.toGenerationJob(job as PrismaGenerationJob)),
      input.limit,
    );
  }

  async enqueueJob(input: {
    characterId: string;
    mediaType: string;
    prompt: string;
    provider?: string;
    paramsJson?: Prisma.InputJsonValue;
    originJobId?: string;
  }): Promise<GenerationJob> {
    if (input.mediaType !== "image" && input.mediaType !== "video") {
      throw new BadRequestException(
        "Generation media type must be image or video",
      );
    }
    if (!input.prompt.trim()) {
      throw new BadRequestException("Generation prompt is required");
    }

    const mediaType = input.mediaType;
    const prompt = input.prompt.trim();

    const job = await this.prisma.generationJob.create({
      data: {
        characterId: input.characterId,
        mediaType,
        prompt,
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.paramsJson !== undefined
          ? { paramsJson: input.paramsJson }
          : {}),
        ...(input.originJobId ? { originJobId: input.originJobId } : {}),
      },
      include: this.jobWithOutput,
    });
    return this.toGenerationJob(job as PrismaGenerationJob);
  }

  async startJob(jobId: string): Promise<GenerationJob> {
    const transitioned = await this.prisma.generationJob.updateMany({
      where: { id: jobId, status: "queued" },
      data: {
        status: "running",
        leaseExpiresAt: new Date(Date.now() + MANUAL_START_LEASE_MS),
        attemptCount: { increment: 1 },
      },
    });
    if (transitioned.count === 0) {
      await this.getJob(jobId); // 404를 400보다 먼저 구분한다.
      throw new BadRequestException("Only queued generation jobs can start");
    }
    return this.getJob(jobId);
  }

  async retryJob(jobId: string): Promise<GenerationJob> {
    const job = await this.getJob(jobId);
    if (job.status !== "failed") {
      throw new BadRequestException(
        "Only failed generation jobs can be retried",
      );
    }
    return this.enqueueJob({
      characterId: job.characterId,
      mediaType: job.mediaType,
      prompt: job.prompt,
      provider: job.provider,
      originJobId: job.id,
    });
  }

  async failJob(input: {
    jobId: string;
    errorMessage: string;
  }): Promise<GenerationJob> {
    const transitioned = await this.prisma.generationJob.updateMany({
      where: { id: input.jobId, status: { in: ["queued", "running"] } },
      data: {
        status: "failed",
        errorMessage: input.errorMessage,
        leaseExpiresAt: null,
      },
    });
    if (transitioned.count === 0) {
      const job = await this.getJob(input.jobId);
      if (job.status === "failed") {
        return job;
      }
      throw new BadRequestException(
        "Only queued or running generation jobs can fail",
      );
    }
    return this.getJob(input.jobId);
  }

  async completeJob(input: {
    jobId: string;
    url?: string;
    mediaId?: string;
    width?: number;
    height?: number;
    durationSeconds?: number;
  }): Promise<GenerationJob> {
    if (input.mediaId) {
      return this.completeJobWithMediaId(input.jobId, input.mediaId);
    }
    if (!input.url?.trim()) {
      throw new BadRequestException("Generated media URL is required");
    }
    return this.completeJobWithUrl(input.jobId, {
      url: input.url.trim(),
      width: input.width,
      height: input.height,
      durationSeconds: input.durationSeconds,
    });
  }

  private readonly jobWithOutput = {
    outputMedia: true,
  } as const;

  private readonly jobWithOutputs = {
    outputMedia: true,
    outputs: {
      orderBy: { candidateIndex: "asc" },
      include: { media: { select: { url: true } } },
    },
  } as const;

  private async completeJobWithMediaId(
    jobId: string,
    mediaId: string,
  ): Promise<GenerationJob> {
    const job = await this.getJob(jobId);
    await assertUploadedMedia(this.prisma, mediaId, job.mediaType);

    const transitioned = await this.prisma.generationJob.updateMany({
      where: { id: jobId, status: "running" },
      data: {
        status: "completed",
        outputMediaId: mediaId,
        leaseExpiresAt: null,
      },
    });
    if (transitioned.count === 0) {
      return this.assertIdempotentComplete(jobId);
    }
    return this.getJob(jobId);
  }

  private async completeJobWithUrl(
    jobId: string,
    outputMedia: {
      url: string;
      width?: number;
      height?: number;
      durationSeconds?: number;
    },
  ): Promise<GenerationJob> {
    const job = await this.getJob(jobId);

    // Media 생성과 상태 전이를 한 트랜잭션으로 묶어, 전이 실패 시 고아 Media를 남기지 않는다.
    // 주의: uploadedAt이 없는 Media는 게시(createPost/createStory)에 쓸 수 없다.
    // 파이프라인(워커) 경로는 반드시 S3 재업로드 + uploadedAt 확정 경로를 쓴다.
    const completed = await this.prisma.$transaction(async (tx) => {
      const media = await tx.media.create({
        data: {
          mediaType: job.mediaType,
          url: outputMedia.url,
          width: outputMedia.width,
          height: outputMedia.height,
          durationSeconds: outputMedia.durationSeconds,
        },
        select: { id: true },
      });
      const transitioned = await tx.generationJob.updateMany({
        where: { id: jobId, status: "running" },
        data: {
          status: "completed",
          outputMediaId: media.id,
          leaseExpiresAt: null,
        },
      });
      return transitioned.count > 0;
    });
    if (!completed) {
      return this.assertIdempotentComplete(jobId);
    }
    return this.getJob(jobId);
  }

  // 전이에 실패했을 때: 이미 완료된 잡이면 그대로 반환(멱등), 아니면 400.
  private async assertIdempotentComplete(
    jobId: string,
  ): Promise<GenerationJob> {
    const job = await this.getJob(jobId);
    if (job.status === "completed") {
      return job;
    }
    throw new BadRequestException("Only running generation jobs can complete");
  }

  async getJob(jobId: string): Promise<GenerationJob> {
    const job = await this.prisma.generationJob.findUnique({
      where: { id: jobId },
      include: this.jobWithOutputs,
    });

    if (!job) {
      throw new BadRequestException("Generation job not found");
    }

    return this.toGenerationJob(job as PrismaGenerationJob);
  }

  private parseOptionalStatus(status?: string): JobStatus | undefined {
    const value = status?.trim();
    if (!value) {
      return undefined;
    }
    if (
      value === "queued" ||
      value === "running" ||
      value === "completed" ||
      value === "failed"
    ) {
      return value;
    }
    throw new BadRequestException(
      "Generation job status must be queued, running, completed, or failed",
    );
  }

  private parseOptionalMediaType(mediaType?: string): MediaType | undefined {
    const value = mediaType?.trim();
    if (!value) {
      return undefined;
    }
    if (value === "image" || value === "video") {
      return value;
    }
    throw new BadRequestException(
      "Generation media type must be image or video",
    );
  }

  private toGenerationJob(job: PrismaGenerationJob): GenerationJob {
    const outputMedia = job.outputMedia
      ? {
          mediaType: job.outputMedia.mediaType,
          url: job.outputMedia.url,
          width: job.outputMedia.width ?? undefined,
          height: job.outputMedia.height ?? undefined,
          durationSeconds: job.outputMedia.durationSeconds ?? undefined,
        }
      : undefined;
    const outputs = job.outputs?.map((output) => ({
      mediaId: output.mediaId,
      url: output.media.url,
      candidateIndex: output.candidateIndex,
      selected: output.selected,
    }));

    return {
      id: job.id,
      characterId: job.characterId,
      mediaType: job.mediaType,
      prompt: job.prompt,
      status: job.status,
      attemptCount: job.attemptCount ?? 0,
      ...(job.provider ? { provider: job.provider } : {}),
      ...(job.originJobId ? { originJobId: job.originJobId } : {}),
      ...(job.errorMessage ? { errorMessage: job.errorMessage } : {}),
      ...(job.costUsd != null ? { costUsd: job.costUsd.toString() } : {}),
      ...(outputMedia ? { outputMedia } : {}),
      ...(outputs && outputs.length > 0 ? { outputs } : {}),
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
  }
}
