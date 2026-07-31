import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../domain/database/prisma.service";

const aggregateDraftSelect = {
  id: true,
  characterId: true,
  status: true,
  jobs: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { sortOrder: true, status: true },
  },
} satisfies Prisma.PostDraftSelect;

const plannedDraftInclude = {
  character: {
    select: {
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
          referenceMedia: {
            orderBy: { sortOrder: "asc" },
            select: {
              mediaId: true,
              description: true,
              media: { select: { uploadedAt: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.PostDraftInclude;

const publishDraftSelect = {
  id: true,
  characterId: true,
  contentType: true,
  caption: true,
  hashtags: true,
  conceptJson: true,
} satisfies Prisma.PostDraftSelect;

export type AggregateDraft = Prisma.PostDraftGetPayload<{
  select: typeof aggregateDraftSelect;
}>;

export type PlannedDraft = Prisma.PostDraftGetPayload<{
  include: typeof plannedDraftInclude;
}>;

export type PublishDraft = Prisma.PostDraftGetPayload<{
  select: typeof publishDraftSelect;
}>;

export type PromptBuildDraft = {
  id: string;
  characterId: string;
  conceptJson: unknown;
  character: {
    visualProfile: {
      appearancePrompt: string;
      stylePrompt: string;
      referenceMedia: {
        mediaId: string;
        media: { uploadedAt: Date | null };
      }[];
    } | null;
  };
};

export type DraftImageJob = {
  id: string;
  sortOrder: number;
  status: string;
  paramsJson: unknown;
};

export type PublishJob = {
  sortOrder: number;
  status: string;
  outputMediaId: string | null;
  outputs: { mediaId: string; filterPreset: string | null }[];
};

export type PostingPolicy = {
  characterId: string;
  weeklyCadence: number;
  hourStartKst: number;
  hourEndKst: number;
};

export type FinishedPublishFile = {
  url: string;
  storageKey?: string;
  contentType: string;
  byteSize: number;
  width: number;
  height: number;
};

@Injectable()
export class DraftWorkerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claimDraftNow(draftId: string, leaseSeconds: number): Promise<boolean> {
    const claimed = await this.prisma.postDraft.updateMany({
      where: {
        id: draftId,
        status: "planned",
        draftType: "post",
        character: { status: "active" },
      },
      data: {
        status: "generating",
        leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1000),
        attemptCount: { increment: 1 },
      },
    });
    return claimed.count > 0;
  }

  findApprovedDraft(draftId: string): Promise<PublishDraft | null> {
    return this.prisma.postDraft.findFirst({
      where: {
        id: draftId,
        status: "approved",
        draftType: "post",
        character: { status: "active" },
      },
      select: publishDraftSelect,
    });
  }

  async recordPublishError(draftId: string, message: string): Promise<void> {
    await this.prisma.postDraft.updateMany({
      where: { id: draftId, status: "approved" },
      data: { errorMessage: message },
    });
  }

  findAggregateDraft(draftId: string): Promise<AggregateDraft | null> {
    return this.prisma.postDraft.findFirst({
      where: {
        id: draftId,
        status: { in: ["generating", "regenerating"] },
        leaseExpiresAt: null,
      },
      select: aggregateDraftSelect,
    });
  }

  findPromptBuildDraft(draftId: string): Promise<PromptBuildDraft | null> {
    return this.prisma.postDraft.findFirst({
      where: { id: draftId, draftType: "post" },
      select: {
        id: true,
        characterId: true,
        conceptJson: true,
        character: {
          select: {
            visualProfile: {
              select: {
                appearancePrompt: true,
                stylePrompt: true,
                referenceMedia: {
                  orderBy: { sortOrder: "asc" },
                  select: {
                    mediaId: true,
                    media: { select: { uploadedAt: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  findDraftImageJobs(draftId: string): Promise<DraftImageJob[]> {
    return this.prisma.generationJob.findMany({
      where: { draftId, mediaType: "image" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, sortOrder: true, status: true, paramsJson: true },
    });
  }

  async persistBuiltPrompts(input: {
    draftId: string;
    characterId: string;
    builderName: string;
    conceptJson: Prisma.InputJsonValue;
    jobs: {
      id: string;
      sortOrder: number;
      prompt: string;
      paramsJson: Prisma.InputJsonValue;
    }[];
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const job of input.jobs) {
        const updated = await tx.generationJob.updateMany({
          where: { id: job.id, status: "draft" },
          data: { prompt: job.prompt, paramsJson: job.paramsJson },
        });
        if (updated.count !== 1) {
          throw new Error(
            `shot ${job.sortOrder} left draft state during prompt build`,
          );
        }
      }
      await tx.postDraft.update({
        where: { id: input.draftId },
        data: { conceptJson: input.conceptJson },
      });
      await tx.characterActionLog.create({
        data: {
          characterId: input.characterId,
          actionType: "DRAFT_PROMPTS_BUILT",
          targetTable: "post_drafts",
          targetId: input.draftId,
          reason: `shot prompts built via ${input.builderName} (${input.jobs.length} shot(s))`,
        },
      });
    });
  }

  async sweepExpiredPlanLeases(
    now: Date,
    maxAttempts: number,
  ): Promise<number> {
    const requeued = await this.prisma.postDraft.updateMany({
      where: {
        status: "generating",
        leaseExpiresAt: { lt: now },
        attemptCount: { lt: maxAttempts },
      },
      data: { status: "planned", leaseExpiresAt: null },
    });
    await this.prisma.postDraft.updateMany({
      where: {
        status: "generating",
        leaseExpiresAt: { lt: now },
        attemptCount: { gte: maxAttempts },
      },
      data: {
        status: "failed",
        errorMessage: "planning lease expired",
        leaseExpiresAt: null,
      },
    });
    return requeued.count;
  }

  // Prisma에는 SKIP LOCKED claim의 동등한 API가 없어 tagged SQL을 쓴다.
  // 동적 값은 interpolation binding으로만 전달한다.
  async claimPlannedDraft(leaseSeconds: number): Promise<string | undefined> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE opod.post_drafts
      SET status = 'generating',
          lease_expires_at = now() + make_interval(secs => ${leaseSeconds}),
          attempt_count = attempt_count + 1,
          updated_at = now()
      WHERE id = (
        SELECT d.id FROM opod.post_drafts d
        JOIN opod.characters c ON c.id = d.character_id AND c.status = 'active'
        WHERE d.status = 'planned' AND d.draft_type = 'post'
          AND (d.concept_json->>'mode') IS DISTINCT FROM 'manual'
        ORDER BY d.created_at, d.id
        LIMIT 1
        FOR UPDATE OF d SKIP LOCKED
      )
      RETURNING id
    `;
    return rows[0]?.id;
  }

  findPlannedDraft(draftId: string): Promise<PlannedDraft | null> {
    return this.prisma.postDraft.findUnique({
      where: { id: draftId },
      include: plannedDraftInclude,
    });
  }

  async extendPlanLease(draftId: string, leaseSeconds: number): Promise<void> {
    await this.prisma.postDraft.updateMany({
      where: { id: draftId, status: "generating" },
      data: {
        leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1000),
      },
    });
  }

  async persistPlan(input: {
    draftId: string;
    characterId: string;
    caption: string;
    hashtags: string[];
    conceptJson: Prisma.InputJsonValue;
    plannerName: string;
    builderName?: string;
    jobs: {
      prompt: string;
      sortOrder: number;
      status?: "draft";
      paramsJson: Prisma.InputJsonValue;
    }[];
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.postDraft.updateMany({
        where: { id: input.draftId, status: "generating" },
        data: {
          caption: input.caption,
          hashtags: input.hashtags,
          conceptJson: input.conceptJson,
          leaseExpiresAt: null,
          errorMessage: null,
        },
      });
      if (transitioned.count === 0) {
        throw new Error("draft left the generating state during planning");
      }
      for (const job of input.jobs) {
        await tx.generationJob.create({
          data: {
            characterId: input.characterId,
            mediaType: "image",
            prompt: job.prompt,
            draftId: input.draftId,
            sortOrder: job.sortOrder,
            ...(job.status ? { status: job.status } : {}),
            paramsJson: job.paramsJson,
          },
        });
      }
      await tx.characterActionLog.create({
        data: {
          characterId: input.characterId,
          actionType: "DRAFT_PLANNED",
          targetTable: "post_drafts",
          targetId: input.draftId,
          reason: `draft planned via ${input.plannerName}${
            input.builderName ? `, prompts via ${input.builderName}` : ""
          } (${input.jobs.length} shot(s))`,
        },
      });
    });
  }

  async failPlanning(draftId: string, message: string): Promise<boolean> {
    const transitioned = await this.prisma.postDraft.updateMany({
      where: { id: draftId, status: "generating" },
      data: { status: "failed", errorMessage: message, leaseExpiresAt: null },
    });
    return transitioned.count > 0;
  }

  async requeuePlanning(draftId: string, message: string): Promise<void> {
    await this.prisma.postDraft.updateMany({
      where: { id: draftId, status: "generating" },
      data: { status: "planned", errorMessage: message, leaseExpiresAt: null },
    });
  }

  findGeneratingDrafts(take: number): Promise<AggregateDraft[]> {
    return this.prisma.postDraft.findMany({
      where: {
        status: { in: ["generating", "regenerating"] },
        leaseExpiresAt: null,
      },
      take,
      select: aggregateDraftSelect,
    });
  }

  async requeueDraftWithoutJobs(
    draftId: string,
    currentStatus: string,
  ): Promise<void> {
    await this.prisma.postDraft.updateMany({
      where: { id: draftId, status: currentStatus as never },
      data: { status: "planned" },
    });
  }

  async failGeneratedDraft(
    draftId: string,
    currentStatus: string,
    message: string,
  ): Promise<boolean> {
    const transitioned = await this.prisma.postDraft.updateMany({
      where: { id: draftId, status: currentStatus as never },
      data: { status: "failed", errorMessage: message },
    });
    return transitioned.count > 0;
  }

  async markDraftNeedsReview(
    draftId: string,
    currentStatus: string,
  ): Promise<boolean> {
    const transitioned = await this.prisma.postDraft.updateMany({
      where: { id: draftId, status: currentStatus as never },
      data: { status: "needs_review", errorMessage: null },
    });
    return transitioned.count > 0;
  }

  findDueDrafts(now: Date, take: number): Promise<PublishDraft[]> {
    return this.prisma.postDraft.findMany({
      where: {
        status: "approved",
        draftType: "post",
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
        character: { status: "active" },
      },
      orderBy: { scheduledAt: "asc" },
      take,
      select: publishDraftSelect,
    });
  }

  async recordPublishFailure(input: {
    draftId: string;
    characterId: string;
    message: string;
  }): Promise<void> {
    await this.recordPublishError(input.draftId, input.message);
    try {
      await this.prisma.serviceLog.create({
        data: {
          source: "admin-worker",
          level: "error",
          eventType: "DRAFT_PUBLISH_FAILED",
          message: input.message,
          contextJson: {
            draftId: input.draftId,
            characterId: input.characterId,
          },
        },
      });
    } catch {
      // Durable logging is best effort and must not stop the publish loop.
    }
  }

  findPublishJobs(draftId: string): Promise<PublishJob[]> {
    return this.prisma.generationJob.findMany({
      where: { draftId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        sortOrder: true,
        status: true,
        outputMediaId: true,
        outputs: {
          select: { mediaId: true, filterPreset: true },
        },
      },
    });
  }

  async persistPublishedPost(input: {
    draftId: string;
    characterId: string;
    contentType: string;
    caption: string;
    hashtags: string[];
    memoryContent: string;
    media: {
      originalMediaId: string;
      finishedFile: FinishedPublishFile | null;
    }[];
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.postDraft.updateMany({
        where: { id: input.draftId, status: "approved" },
        data: { status: "published", errorMessage: null },
      });
      if (transitioned.count === 0) {
        throw new Error("draft left the approved state before publish");
      }
      const publishMediaIds: string[] = [];
      for (const item of input.media) {
        if (!item.finishedFile) {
          publishMediaIds.push(item.originalMediaId);
          continue;
        }
        const media = await tx.media.create({
          data: {
            mediaType: "image",
            url: item.finishedFile.url,
            storageKey: item.finishedFile.storageKey,
            contentType: item.finishedFile.contentType,
            byteSize: item.finishedFile.byteSize,
            width: item.finishedFile.width,
            height: item.finishedFile.height,
            isAiGenerated: true,
            uploadedAt: new Date(),
          },
          select: { id: true },
        });
        publishMediaIds.push(media.id);
      }
      const post = await tx.post.create({
        data: {
          characterId: input.characterId,
          contentType: input.contentType as never,
          content: input.caption,
          hashtags: {
            create: input.hashtags.map((name) => ({
              hashtag: {
                connectOrCreate: { where: { name }, create: { name } },
              },
            })),
          },
          postMedia: {
            create: publishMediaIds.map((mediaId, index) => ({
              sortOrder: index,
              media: { connect: { id: mediaId } },
            })),
          },
        },
        select: { id: true },
      });
      await tx.postDraft.update({
        where: { id: input.draftId },
        data: { publishedPostId: post.id },
      });
      await tx.characterActionLog.create({
        data: {
          characterId: input.characterId,
          actionType: "POST_CREATED",
          targetTable: "posts",
          targetId: post.id,
          reason: `auto-published from draft ${input.draftId}`,
        },
      });
      await tx.characterMemory.create({
        data: {
          characterId: input.characterId,
          content: input.memoryContent,
          reason: "auto: post published from draft",
        },
      });
    });
  }

  findMediaForFinish(mediaId: string) {
    return this.prisma.media.findUnique({
      where: { id: mediaId },
      select: { mediaType: true, url: true, storageKey: true },
    });
  }

  findEnabledPostingPolicies(): Promise<PostingPolicy[]> {
    return this.prisma.characterPostingPolicy.findMany({
      where: { enabled: true, character: { status: "active" } },
      select: {
        characterId: true,
        weeklyCadence: true,
        hourStartKst: true,
        hourEndKst: true,
      },
    });
  }

  findPendingDraft(characterId: string): Promise<{ id: string } | null> {
    return this.prisma.postDraft.findFirst({
      where: {
        characterId,
        status: {
          in: [
            "planned",
            "generating",
            "regenerating",
            "needs_review",
            "approved",
          ],
        },
      },
      select: { id: true },
    });
  }

  findLastDraft(characterId: string) {
    return this.prisma.postDraft.findFirst({
      where: { characterId },
      orderBy: { createdAt: "desc" },
      select: { scheduledAt: true, createdAt: true },
    });
  }

  findLastPost(characterId: string) {
    return this.prisma.post.findFirst({
      where: { characterId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
  }

  async createScheduledDraft(
    characterId: string,
    scheduledAt: Date,
  ): Promise<void> {
    await this.prisma.postDraft.create({
      data: {
        characterId,
        conceptJson: { source: "scheduler" },
        scheduledAt,
      },
    });
  }

  async recordActionLog(input: {
    characterId: string;
    targetId: string;
    actionType: string;
    reason: string;
  }): Promise<void> {
    await this.prisma.characterActionLog.create({
      data: {
        characterId: input.characterId,
        actionType: input.actionType,
        targetTable: "post_drafts",
        targetId: input.targetId,
        reason: input.reason,
      },
    });
  }
}
