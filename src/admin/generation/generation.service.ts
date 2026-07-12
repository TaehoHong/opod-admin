import { BadRequestException, Injectable } from "@nestjs/common";
import {
  decodeCursor,
  Page,
  PageInput,
  pageFromRows,
} from "../../domain/database/page";
import { PrismaService } from "../../domain/database/prisma.service";
import { assertUploadedMedia } from "../media/media.service";

type MediaType = "image" | "video";
type JobStatus = "queued" | "running" | "completed";

type OutputMedia = {
  mediaType: MediaType;
  url: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
};

type GenerationJob = {
  id: string;
  characterId: string;
  mediaType: MediaType;
  prompt: string;
  status: JobStatus;
  outputMedia?: OutputMedia;
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

type PrismaGenerationJob = Omit<
  GenerationJob,
  "createdAt" | "updatedAt" | "outputMedia"
> & {
  createdAt: Date;
  updatedAt: Date;
  outputMedia: PrismaOutputMedia | null;
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
      },
      include: this.jobWithOutput,
    });
    return this.toGenerationJob(job as PrismaGenerationJob);
  }

  async startJob(jobId: string): Promise<GenerationJob> {
    const job = await this.getJob(jobId);

    if (job.status !== "queued") {
      throw new BadRequestException("Only queued generation jobs can start");
    }

    const updated = await this.prisma.generationJob.update({
      where: { id: jobId },
      data: { status: "running" },
      include: this.jobWithOutput,
    });
    return this.toGenerationJob(updated as PrismaGenerationJob);
  }

  async retryJob(jobId: string): Promise<GenerationJob> {
    const job = await this.getJob(jobId);
    const retried = await this.prisma.generationJob.create({
      data: {
        characterId: job.characterId,
        mediaType: job.mediaType,
        prompt: job.prompt,
      },
      include: this.jobWithOutput,
    });
    return this.toGenerationJob(retried as PrismaGenerationJob);
  }

  async completeJob(input: {
    jobId: string;
    url?: string;
    mediaId?: string;
    width?: number;
    height?: number;
    durationSeconds?: number;
  }): Promise<GenerationJob> {
    const job = await this.getJob(input.jobId);

    if (job.status !== "running") {
      throw new BadRequestException(
        "Only running generation jobs can complete",
      );
    }
    if (input.mediaId) {
      return this.completeJobWithMediaId(job, input.mediaId);
    }
    if (!input.url?.trim()) {
      throw new BadRequestException("Generated media URL is required");
    }

    const outputMedia = {
      mediaType: job.mediaType,
      url: input.url.trim(),
      width: input.width,
      height: input.height,
      durationSeconds: input.durationSeconds,
    };

    const updated = await this.prisma.generationJob.update({
      where: { id: input.jobId },
      data: {
        status: "completed",
        outputMedia: {
          create: outputMedia,
        },
      },
      include: this.jobWithOutput,
    });
    return this.toGenerationJob(updated as PrismaGenerationJob);
  }

  private readonly jobWithOutput = {
    outputMedia: true,
  } as const;

  private async completeJobWithMediaId(
    job: GenerationJob,
    mediaId: string,
  ): Promise<GenerationJob> {
    await assertUploadedMedia(this.prisma, mediaId, job.mediaType);

    const updated = await this.prisma.generationJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        outputMedia: {
          connect: { id: mediaId },
        },
      },
      include: this.jobWithOutput,
    });
    return this.toGenerationJob(updated as PrismaGenerationJob);
  }

  async getJob(jobId: string): Promise<GenerationJob> {
    const job = await this.prisma.generationJob.findUnique({
      where: { id: jobId },
      include: this.jobWithOutput,
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
    if (value === "queued" || value === "running" || value === "completed") {
      return value;
    }
    throw new BadRequestException(
      "Generation job status must be queued, running, or completed",
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

    return {
      id: job.id,
      characterId: job.characterId,
      mediaType: job.mediaType,
      prompt: job.prompt,
      status: job.status,
      ...(outputMedia ? { outputMedia } : {}),
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
  }
}
