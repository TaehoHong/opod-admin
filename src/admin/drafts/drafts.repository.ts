import { Injectable } from "@nestjs/common";
import { PostDraftStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../domain/database/prisma.service";

const draftJobFields = {
  id: true,
  sortOrder: true,
  status: true,
  prompt: true,
  paramsJson: true,
  candidateCount: true,
  provider: true,
  costUsd: true,
  errorMessage: true,
  createdAt: true,
  outputs: {
    orderBy: { candidateIndex: "asc" as const },
    select: {
      mediaId: true,
      candidateIndex: true,
      selected: true,
      filterPreset: true,
      media: { select: { url: true } },
    },
  },
} as const;

const regenerationSourceFields = {
  id: true,
  characterId: true,
  sortOrder: true,
  status: true,
  inputPrompt: true,
  prompt: true,
  candidateCount: true,
  paramsJson: true,
} as const;

export type DraftRow = Prisma.PostDraftGetPayload<Prisma.PostDraftDefaultArgs>;
export type DraftJobRow = Prisma.GenerationJobGetPayload<{
  select: typeof draftJobFields;
}>;
export type RegenerationSource = Prisma.GenerationJobGetPayload<{
  select: typeof regenerationSourceFields;
}>;
export type RegenerationResult =
  "regenerated" | "stale-job" | "draft-not-found" | "invalid-draft-status";

@Injectable()
export class DraftsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async cursorMatchesFilter(
    cursorId: string,
    filter: { status?: PostDraftStatus; characterId?: string },
  ): Promise<boolean> {
    const row = await this.prisma.postDraft.findFirst({
      where: { id: cursorId, ...filter },
      select: { id: true },
    });
    return row !== null;
  }

  findMany(input: {
    status?: PostDraftStatus;
    characterId?: string;
    take: number;
    cursorId?: string;
  }): Promise<DraftRow[]> {
    return this.prisma.postDraft.findMany({
      where: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.characterId ? { characterId: input.characterId } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.take,
      ...(input.cursorId ? { cursor: { id: input.cursorId }, skip: 1 } : {}),
    });
  }

  findDraft(draftId: string): Promise<DraftRow | null> {
    return this.prisma.postDraft.findUnique({ where: { id: draftId } });
  }

  findDraftJobs(draftId: string): Promise<DraftJobRow[]> {
    return this.prisma.generationJob.findMany({
      where: { draftId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: draftJobFields,
    });
  }

  findMediaUrls(ids: string[]): Promise<{ id: string; url: string }[]> {
    return this.prisma.media.findMany({
      where: { id: { in: ids } },
      select: { id: true, url: true },
    });
  }

  async characterExists(characterId: string): Promise<boolean> {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { id: true },
    });
    return character !== null;
  }

  createDraft(data: {
    characterId: string;
    contentType: "feed" | "reel";
    conceptJson: Prisma.InputJsonValue;
    scheduledAt?: Date;
  }): Promise<DraftRow> {
    return this.prisma.postDraft.create({ data });
  }

  async findDraftConcept(
    draftId: string,
  ): Promise<{ conceptJson: Prisma.JsonValue } | null> {
    return this.prisma.postDraft.findUnique({
      where: { id: draftId },
      select: { conceptJson: true },
    });
  }

  async updateEditableDraft(
    draftId: string,
    statuses: PostDraftStatus[],
    data: Record<string, unknown>,
  ): Promise<boolean> {
    const result = await this.prisma.postDraft.updateMany({
      where: { id: draftId, status: { in: statuses } },
      data: data as never,
    });
    return result.count > 0;
  }

  async approveDraft(draftId: string): Promise<boolean> {
    const result = await this.prisma.postDraft.updateMany({
      where: { id: draftId, status: "needs_review" },
      data: { status: "approved", errorMessage: null },
    });
    return result.count > 0;
  }

  async rejectDraft(draftId: string): Promise<boolean> {
    const result = await this.prisma.postDraft.updateMany({
      where: { id: draftId, status: "needs_review" },
      data: { status: "rejected" },
    });
    return result.count > 0;
  }

  async draftExists(draftId: string): Promise<boolean> {
    const draft = await this.prisma.postDraft.findUnique({
      where: { id: draftId },
      select: { id: true },
    });
    return draft !== null;
  }

  findDraftShotPrompt(
    draftId: string,
    jobId: string,
  ): Promise<{ prompt: string } | null> {
    return this.prisma.generationJob.findFirst({
      where: { id: jobId, draftId, status: "draft" },
      select: { prompt: true },
    });
  }

  async queueDraftShot(input: {
    draftId: string;
    jobId: string;
    prompt?: string;
    candidateCount?: number;
  }): Promise<boolean> {
    const result = await this.prisma.generationJob.updateMany({
      where: { id: input.jobId, draftId: input.draftId, status: "draft" },
      data: {
        status: "queued",
        ...(input.prompt ? { prompt: input.prompt } : {}),
        ...(input.candidateCount != null
          ? { candidateCount: input.candidateCount }
          : {}),
      },
    });
    return result.count > 0;
  }

  findShotIdentity(
    jobId: string,
  ): Promise<{ characterId: string; sortOrder: number } | null> {
    return this.prisma.generationJob.findUnique({
      where: { id: jobId },
      select: { characterId: true, sortOrder: true },
    });
  }

  findRegenerationSource(
    draftId: string,
    jobId: string,
  ): Promise<RegenerationSource | null> {
    return this.prisma.generationJob.findFirst({
      where: { id: jobId, draftId },
      select: regenerationSourceFields,
    });
  }

  async regenerateShot(input: {
    draftId: string;
    source: RegenerationSource;
    prompt: string;
  }): Promise<RegenerationResult> {
    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.generationJob.findFirst({
        where: {
          draftId: input.draftId,
          sortOrder: input.source.sortOrder,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      if (latest?.id !== input.source.id) {
        return "stale-job";
      }
      const transitioned = await tx.postDraft.updateMany({
        where: {
          id: input.draftId,
          status: { in: ["needs_review", "failed"] },
        },
        data: { status: "regenerating", errorMessage: null },
      });
      if (transitioned.count === 0) {
        const draft = await tx.postDraft.findUnique({
          where: { id: input.draftId },
          select: { id: true },
        });
        return draft ? "invalid-draft-status" : "draft-not-found";
      }
      await tx.generationJob.create({
        data: {
          characterId: input.source.characterId,
          mediaType: "image",
          ...(input.source.inputPrompt != null
            ? { inputPrompt: input.source.inputPrompt }
            : {}),
          prompt: input.prompt,
          ...(input.source.candidateCount != null
            ? { candidateCount: input.source.candidateCount }
            : {}),
          ...(input.source.paramsJson != null
            ? {
                paramsJson: input.source.paramsJson as Prisma.InputJsonValue,
              }
            : {}),
          draftId: input.draftId,
          sortOrder: input.source.sortOrder,
          originJobId: input.source.id,
        },
      });
      await tx.characterActionLog.create({
        data: {
          characterId: input.source.characterId,
          actionType: "DRAFT_SHOT_REGENERATED",
          targetTable: "post_drafts",
          targetId: input.draftId,
          reason: `shot ${input.source.sortOrder} regeneration queued`,
        },
      });
      return "regenerated";
    });
  }

  findCompletedShotCandidates(
    draftId: string,
    jobId: string,
  ): Promise<{ id: string; outputs: { mediaId: string }[] } | null> {
    return this.prisma.generationJob.findFirst({
      where: { id: jobId, draftId, status: "completed" },
      select: {
        id: true,
        outputs: { select: { mediaId: true } },
      },
    });
  }

  async selectShotOutput(jobId: string, mediaId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
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
    });
  }

  findEditableOutput(input: {
    draftId: string;
    jobId: string;
    mediaId: string;
    draftStatuses: PostDraftStatus[];
  }): Promise<{ id: string } | null> {
    return this.prisma.generationJobOutput.findFirst({
      where: {
        jobId: input.jobId,
        mediaId: input.mediaId,
        job: {
          draftId: input.draftId,
          status: "completed",
          draft: { status: { in: input.draftStatuses } },
        },
      },
      select: { id: true },
    });
  }

  async updateOutputFilter(
    outputId: string,
    filterPreset: string,
  ): Promise<void> {
    await this.prisma.generationJobOutput.update({
      where: { id: outputId },
      data: { filterPreset },
    });
  }

  async recordActionLog(input: {
    characterId: string;
    draftId: string;
    actionType: string;
    reason: string;
  }): Promise<void> {
    await this.prisma.characterActionLog.create({
      data: {
        characterId: input.characterId,
        actionType: input.actionType,
        targetTable: "post_drafts",
        targetId: input.draftId,
        reason: input.reason,
      },
    });
  }
}
