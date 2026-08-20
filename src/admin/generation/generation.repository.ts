import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  assertableMediaFields,
  type AssertableMedia,
} from "../media/media.service";
import { PrismaService } from "../../domain/database/prisma.service";

const jobWithOutput = {
  outputMedia: true,
} as const;

const jobWithOutputs = {
  outputMedia: true,
  outputs: {
    orderBy: { candidateIndex: "asc" },
    include: { media: { select: { url: true } } },
  },
  character: {
    select: {
      visualProfile: {
        select: {
          negativePrompt: true,
          referenceMedia: {
            where: { isActive: true },
            select: { media: { select: { uploadedAt: true } } },
          },
        },
      },
    },
  },
} as const;

const imageDraftCharacter = {
  id: true,
  displayName: true,
  bio: true,
  interests: true,
  personas: {
    where: { deletedAt: null },
    orderBy: { sortOrder: "asc" },
    select: { title: true, content: true },
  },
  memories: {
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { content: true },
  },
  posts: {
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { content: true },
  },
  visualProfile: {
    select: {
      appearancePrompt: true,
      stylePrompt: true,
      negativePrompt: true,
      referenceMedia: {
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        select: {
          mediaId: true,
          description: true,
          media: { select: { uploadedAt: true } },
        },
      },
    },
  },
} as const;

export type GenerationJobRow = Prisma.GenerationJobGetPayload<{
  include: typeof jobWithOutput;
}>;
export type GenerationJobDetailRow = Prisma.GenerationJobGetPayload<{
  include: typeof jobWithOutputs;
}>;
export type ImageDraftCharacterRow = Prisma.CharacterGetPayload<{
  select: typeof imageDraftCharacter;
}>;
export type GenerationParams = unknown;
export type GenerationParamsObject = Record<string, unknown>;
export type GenerationParamsValue = unknown;

export type OutputSelectionResult = "missing" | "unchanged" | "selected";

function paramsWithoutProviderProgress(value: unknown): unknown {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const params = { ...(value as Record<string, unknown>) };
  delete params._providerProgress;
  return params;
}

@Injectable()
export class GenerationRepository {
  constructor(private readonly prisma: PrismaService) {}

  findCharacterForImageDraft(
    characterId: string,
  ): Promise<ImageDraftCharacterRow | null> {
    return this.prisma.character.findUnique({
      where: { id: characterId },
      select: imageDraftCharacter,
    });
  }

  createImageDraft(input: {
    characterId: string;
    inputPrompt: string;
    prompt: string;
    candidateCount: number;
    paramsJson: GenerationParamsObject;
  }): Promise<GenerationJobRow> {
    return this.prisma.generationJob.create({
      data: {
        characterId: input.characterId,
        mediaType: "image",
        status: "draft",
        inputPrompt: input.inputPrompt,
        prompt: input.prompt,
        candidateCount: input.candidateCount,
        ...(Object.keys(input.paramsJson).length > 0
          ? { paramsJson: input.paramsJson as Prisma.InputJsonValue }
          : {}),
      },
      include: jobWithOutput,
    });
  }

  async updateImageDraft(
    jobId: string,
    input: { prompt: string; candidateCount: number },
  ): Promise<boolean> {
    const transitioned = await this.prisma.generationJob.updateMany({
      where: { id: jobId, status: "draft" },
      data: input,
    });
    return transitioned.count > 0;
  }

  async confirmImageDraft(jobId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.generationJob.updateMany({
        where: { id: jobId, status: "draft" },
        data: { status: "queued" },
      });
      if (transitioned.count === 0) {
        return false;
      }
      const confirmed = await tx.generationJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { characterId: true },
      });
      await tx.characterActionLog.create({
        data: {
          characterId: confirmed.characterId,
          actionType: "GENERATION_DRAFT_CONFIRMED",
          targetTable: "generation_jobs",
          targetId: jobId,
          reason: "generation draft confirmed",
        },
      });
      return true;
    });
  }

  async selectOutput(
    jobId: string,
    mediaId: string,
  ): Promise<OutputSelectionResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id
        FROM opod.generation_jobs
        WHERE id = ${jobId}::uuid
        FOR UPDATE
      `;
      const output = await tx.generationJobOutput.findFirst({
        where: { jobId, mediaId, job: { status: "completed" } },
        select: {
          selected: true,
          job: { select: { characterId: true, outputMediaId: true } },
        },
      });
      if (!output) {
        return "missing";
      }
      if (output.selected && output.job.outputMediaId === mediaId) {
        return "unchanged";
      }
      await tx.generationJobOutput.updateMany({
        where: { jobId },
        data: { selected: false },
      });
      await tx.generationJobOutput.updateMany({
        where: { jobId, mediaId },
        data: { selected: true },
      });
      await tx.generationJob.update({
        where: { id: jobId },
        data: { outputMediaId: mediaId },
      });
      await tx.characterActionLog.create({
        data: {
          characterId: output.job.characterId,
          actionType: "GENERATION_OUTPUT_SELECTED",
          targetTable: "generation_jobs",
          targetId: jobId,
          reason: `selected generation output ${mediaId}`,
        },
      });
      return "selected";
    });
  }

  findJob(jobId: string): Promise<GenerationJobRow | null> {
    return this.prisma.generationJob.findUnique({
      where: { id: jobId },
      include: jobWithOutput,
    });
  }

  createRegeneratedImageJob(
    source: GenerationJobRow,
  ): Promise<GenerationJobRow> {
    return this.prisma.generationJob.create({
      data: {
        characterId: source.characterId,
        mediaType: "image",
        status: "draft",
        inputPrompt: source.inputPrompt ?? source.prompt,
        prompt: source.prompt,
        candidateCount: source.candidateCount,
        ...(source.paramsJson != null
          ? {
              paramsJson: paramsWithoutProviderProgress(
                source.paramsJson,
              ) as Prisma.InputJsonValue,
            }
          : {}),
        originJobId: source.id,
      },
      include: jobWithOutput,
    });
  }

  async cursorMatchesFilter(
    cursorId: string,
    filter: {
      characterId?: string;
      status?: "draft" | "queued" | "running" | "completed" | "failed";
      mediaType?: "image" | "video";
      draftId?: null;
    },
  ): Promise<boolean> {
    const row = await this.prisma.generationJob.findFirst({
      where: { id: cursorId, ...filter },
      select: { id: true },
    });
    return row !== null;
  }

  findManyForList(input: {
    characterId?: string;
    status?: "draft" | "queued" | "running" | "completed" | "failed";
    mediaType?: "image" | "video";
    draftId?: null;
    take: number;
    cursor?: string;
  }): Promise<GenerationJobRow[]> {
    const { take, cursor, characterId, status, mediaType, draftId } = input;
    return this.prisma.generationJob.findMany({
      where: {
        ...(characterId ? { characterId } : {}),
        ...(status ? { status } : {}),
        ...(mediaType ? { mediaType } : {}),
        ...(draftId === null ? { draftId: null } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: jobWithOutput,
    });
  }

  enqueueJob(input: {
    characterId: string;
    mediaType: "image" | "video";
    prompt: string;
    provider?: string;
    paramsJson?: GenerationParams;
    originJobId?: string;
  }): Promise<GenerationJobRow> {
    return this.prisma.generationJob.create({
      data: {
        characterId: input.characterId,
        mediaType: input.mediaType,
        prompt: input.prompt,
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.paramsJson !== undefined
          ? { paramsJson: input.paramsJson as Prisma.InputJsonValue }
          : {}),
        ...(input.originJobId ? { originJobId: input.originJobId } : {}),
      },
      include: jobWithOutput,
    });
  }

  async startJob(jobId: string, leaseExpiresAt: Date): Promise<boolean> {
    const transitioned = await this.prisma.generationJob.updateMany({
      where: { id: jobId, status: "queued" },
      data: {
        status: "running",
        leaseExpiresAt,
        attemptCount: { increment: 1 },
      },
    });
    return transitioned.count > 0;
  }

  retryJob(
    source: GenerationJobRow,
    reason: string,
  ): Promise<GenerationJobRow> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.generationJob.create({
        data: {
          characterId: source.characterId,
          mediaType: source.mediaType,
          ...(source.inputPrompt != null
            ? { inputPrompt: source.inputPrompt }
            : {}),
          prompt: source.prompt,
          ...(source.candidateCount != null
            ? { candidateCount: source.candidateCount }
            : {}),
          ...(source.paramsJson != null
            ? {
                paramsJson: paramsWithoutProviderProgress(
                  source.paramsJson,
                ) as Prisma.InputJsonValue,
              }
            : {}),
          sortOrder: source.sortOrder,
          originJobId: source.id,
        },
        include: jobWithOutput,
      });
      await tx.characterActionLog.create({
        data: {
          characterId: source.characterId,
          actionType: "GENERATION_JOB_RETRIED",
          targetTable: "generation_jobs",
          targetId: created.id,
          reason,
        },
      });
      return created;
    });
  }

  async failJob(jobId: string, errorMessage: string): Promise<boolean> {
    const transitioned = await this.prisma.generationJob.updateMany({
      where: { id: jobId, status: { in: ["queued", "running"] } },
      data: { status: "failed", errorMessage, leaseExpiresAt: null },
    });
    return transitioned.count > 0;
  }

  findUploadedMedia(mediaId: string): Promise<AssertableMedia | null> {
    return this.prisma.media.findUnique({
      where: { id: mediaId },
      select: assertableMediaFields,
    });
  }

  async completeJobWithMediaId(
    jobId: string,
    mediaId: string,
  ): Promise<boolean> {
    const transitioned = await this.prisma.generationJob.updateMany({
      where: { id: jobId, status: "running" },
      data: {
        status: "completed",
        outputMediaId: mediaId,
        leaseExpiresAt: null,
      },
    });
    return transitioned.count > 0;
  }

  completeJobWithUrl(input: {
    jobId: string;
    mediaType: "image" | "video";
    url: string;
    width?: number;
    height?: number;
    durationSeconds?: number;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const media = await tx.media.create({
        data: {
          mediaType: input.mediaType,
          url: input.url,
          width: input.width,
          height: input.height,
          durationSeconds: input.durationSeconds,
        },
        select: { id: true },
      });
      const transitioned = await tx.generationJob.updateMany({
        where: { id: input.jobId, status: "running" },
        data: {
          status: "completed",
          outputMediaId: media.id,
          leaseExpiresAt: null,
        },
      });
      return transitioned.count > 0;
    });
  }

  findJobDetail(jobId: string): Promise<GenerationJobDetailRow | null> {
    return this.prisma.generationJob.findUnique({
      where: { id: jobId },
      include: jobWithOutputs,
    });
  }
}
