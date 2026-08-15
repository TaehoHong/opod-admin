import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../domain/database/prisma.service";
import {
  createPostPipelineV3Concept,
  POST_PIPELINE_V3,
  PostPipelineV3ArtifactKey,
} from "./post-pipeline-v3";

const aggregateDraftSelect = {
  id: true,
  characterId: true,
  status: true,
  conceptJson: true,
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
      contentLanguage: true,
      personas: {
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
        select: { title: true, content: true },
      },
      memories: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { type: true, content: true },
      },
      posts: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          content: true,
          hashtags: { select: { hashtag: { select: { name: true } } } },
          sourceDrafts: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { conceptJson: true },
          },
        },
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

// 게시 가능 = V2/v3의 approved, 또는 V4의 planned + pipeline.stage=publish +
// state=pending(⑥ 캡션 완료 직후). 게시 경로 4곳(due 조회·수동 조회·오류 기록·
// 게시 CAS)이 같은 술어를 써야 "조회는 되는데 CAS는 실패"가 안 난다.
const PUBLISHABLE_WHERE: Prisma.PostDraftWhereInput = {
  OR: [
    { status: "approved" },
    {
      status: "planned",
      AND: [
        { conceptJson: { path: ["pipeline", "stage"], equals: "publish" } },
        { conceptJson: { path: ["pipeline", "state"], equals: "pending" } },
      ],
    },
  ],
};

export type PromptBuildDraft = {
  id: string;
  characterId: string;
  conceptJson: unknown;
  location: {
    id: string;
    visualPrompt: string;
    negativePrompt: string;
    references: {
      mediaId: string;
      media: { uploadedAt: Date | null };
    }[];
  } | null;
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

export type AvailableLocation = {
  id: string;
  displayName: string;
  description: string;
  visualPrompt: string;
  negativePrompt: string;
  references: {
    mediaId: string;
    description: string;
    media: { uploadedAt: Date | null };
  }[];
};

export type DraftImageJob = {
  id: string;
  sortOrder: number;
  status: string;
  paramsJson: unknown;
};

export type CaptionShot = {
  sortOrder: number;
  jobId: string;
  mediaId: string;
  media: { url: string; storageKey: string | null; contentType: string | null };
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
        NOT: {
          conceptJson: {
            path: ["pipelineVersion"],
            equals: POST_PIPELINE_V3,
          },
        },
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
        AND: [PUBLISHABLE_WHERE],
        draftType: "post",
        character: { status: "active" },
      },
      select: publishDraftSelect,
    });
  }

  async recordPublishError(draftId: string, message: string): Promise<void> {
    await this.prisma.postDraft.updateMany({
      where: { id: draftId, AND: [PUBLISHABLE_WHERE] },
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
        location: {
          select: {
            id: true,
            visualPrompt: true,
            negativePrompt: true,
            references: {
              orderBy: { sortOrder: "asc" },
              select: {
                mediaId: true,
                media: { select: { uploadedAt: true } },
              },
            },
          },
        },
        character: {
          select: {
            visualProfile: {
              select: {
                appearancePrompt: true,
                stylePrompt: true,
                referenceMedia: {
                  where: { isActive: true },
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

  findAvailableLocations(characterId: string): Promise<AvailableLocation[]> {
    return this.prisma.characterLocation.findMany({
      where: {
        deletedAt: null,
        OR: [{ characterId: null }, { characterId }],
      },
      orderBy: [{ characterId: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        displayName: true,
        description: true,
        visualPrompt: true,
        negativePrompt: true,
        references: {
          orderBy: { sortOrder: "asc" },
          select: {
            mediaId: true,
            description: true,
            media: { select: { uploadedAt: true } },
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

  async persistV3Artifact(input: {
    draftId: string;
    characterId: string;
    expected: {
      stage: string;
      state: string;
      artifactKey: PostPipelineV3ArtifactKey;
      revision: number | null;
    };
    conceptJson: Prisma.InputJsonValue;
    // V4 ⑥ 캡션 단계만 쓴다 — artifact 저장과 게시 컬럼 갱신을 한 트랜잭션에.
    columns?: { caption: string; hashtags: string[] };
    actionType: string;
    reason: string;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.postDraft.updateMany({
        where: {
          id: input.draftId,
          status: "generating",
          AND: [
            {
              conceptJson: {
                path: ["pipeline", "stage"],
                equals: input.expected.stage,
              },
            },
            {
              conceptJson: {
                path: ["pipeline", "state"],
                equals: input.expected.state,
              },
            },
            ...(input.expected.revision === null
              ? []
              : [
                  {
                    conceptJson: {
                      path: [input.expected.artifactKey, "revision"],
                      equals: input.expected.revision,
                    },
                  },
                ]),
          ],
        },
        data: {
          conceptJson: input.conceptJson,
          ...(input.columns ?? {}),
          status: "planned",
          leaseExpiresAt: null,
          errorMessage: null,
        },
      });
      if (updated.count !== 1) return false;
      await tx.characterActionLog.create({
        data: {
          characterId: input.characterId,
          actionType: input.actionType,
          targetTable: "post_drafts",
          targetId: input.draftId,
          reason: input.reason,
        },
      });
      return true;
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
        NOT: {
          conceptJson: {
            path: ["pipelineVersion"],
            equals: POST_PIPELINE_V3,
          },
        },
      },
      data: { status: "planned", leaseExpiresAt: null },
    });
    await this.prisma.postDraft.updateMany({
      where: {
        status: "generating",
        leaseExpiresAt: { lt: now },
        attemptCount: { gte: maxAttempts },
        NOT: {
          conceptJson: {
            path: ["pipelineVersion"],
            equals: POST_PIPELINE_V3,
          },
        },
      },
      data: {
        status: "failed",
        errorMessage: "planning lease expired",
        leaseExpiresAt: null,
      },
    });
    return requeued.count;
  }

  async sweepExpiredV3Leases(
    maxAttempts: number,
  ): Promise<{ requeued: number; failed: number }> {
    const requeued = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE opod.post_drafts
      SET status = 'planned',
          lease_expires_at = NULL,
          concept_json = jsonb_set(concept_json, '{pipeline,state}', '"pending"'::jsonb),
          updated_at = now()
      WHERE status = 'generating'
        AND lease_expires_at < now()
        AND attempt_count < ${maxAttempts}
        AND concept_json->>'pipelineVersion' = ${POST_PIPELINE_V3}
      RETURNING id
    `;
    const failed = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE opod.post_drafts
      SET status = 'failed',
          lease_expires_at = NULL,
          error_message = 'V3 stage lease expired',
          concept_json = jsonb_set(
            jsonb_set(concept_json, '{pipeline,state}', '"failed"'::jsonb),
            '{pipeline,reasonCodes}', '["lease_expired"]'::jsonb
          ),
          updated_at = now()
      WHERE status = 'generating'
        AND lease_expires_at < now()
        AND attempt_count >= ${maxAttempts}
        AND concept_json->>'pipelineVersion' = ${POST_PIPELINE_V3}
      RETURNING id
    `;
    return { requeued: requeued.length, failed: failed.length };
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
          AND (d.concept_json->>'pipelineVersion') IS DISTINCT FROM ${POST_PIPELINE_V3}
        ORDER BY d.created_at, d.id
        LIMIT 1
        FOR UPDATE OF d SKIP LOCKED
      )
      RETURNING id
    `;
    return rows[0]?.id;
  }

  async claimV3Draft(leaseSeconds: number): Promise<string | undefined> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE opod.post_drafts
      SET status = 'generating',
          lease_expires_at = now() + make_interval(secs => ${leaseSeconds}),
          attempt_count = attempt_count + 1,
          concept_json = jsonb_set(concept_json, '{pipeline,state}', '"running"'::jsonb),
          updated_at = now()
      WHERE id = (
        SELECT d.id FROM opod.post_drafts d
        JOIN opod.characters c ON c.id = d.character_id AND c.status = 'active'
        WHERE d.status = 'planned' AND d.draft_type = 'post'
          AND d.concept_json->>'pipelineVersion' = ${POST_PIPELINE_V3}
          AND d.concept_json#>>'{pipeline,state}' = 'pending'
          AND (d.concept_json->>'mode') IS DISTINCT FROM 'manual'
        ORDER BY d.created_at, d.id
        LIMIT 1
        FOR UPDATE OF d SKIP LOCKED
      )
      RETURNING id
    `;
    return rows[0]?.id;
  }

  async claimV3DraftNow(
    draftId: string,
    leaseSeconds: number,
  ): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE opod.post_drafts
      SET status = 'generating',
          lease_expires_at = now() + make_interval(secs => ${leaseSeconds}),
          attempt_count = attempt_count + 1,
          concept_json = jsonb_set(concept_json, '{pipeline,state}', '"running"'::jsonb),
          updated_at = now()
      WHERE id = ${draftId}::uuid
        AND status = 'planned'
        AND draft_type = 'post'
        AND concept_json->>'pipelineVersion' = ${POST_PIPELINE_V3}
        AND concept_json#>>'{pipeline,state}' = 'pending'
      RETURNING id
    `;
    return rows.length === 1;
  }

  async persistV3Paused(input: {
    draftId: string;
    characterId: string;
    expectedStage: string;
    conceptJson: Prisma.InputJsonValue;
    reason: string;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.postDraft.updateMany({
        where: {
          id: input.draftId,
          status: "generating",
          AND: [
            {
              conceptJson: {
                path: ["pipeline", "stage"],
                equals: input.expectedStage,
              },
            },
            {
              conceptJson: {
                path: ["pipeline", "state"],
                equals: "running",
              },
            },
          ],
        },
        data: {
          conceptJson: input.conceptJson,
          status: "planned",
          leaseExpiresAt: null,
          errorMessage: null,
        },
      });
      if (updated.count !== 1) return false;
      await tx.characterActionLog.create({
        data: {
          characterId: input.characterId,
          actionType: "DRAFT_V3_PAUSED",
          targetTable: "post_drafts",
          targetId: input.draftId,
          reason: input.reason,
        },
      });
      return true;
    });
  }

  async persistV3PromptJobs(input: {
    draftId: string;
    characterId: string;
    // v3 계약(post-plan-v1) draft가 ④를 재실행할 때만 채운다. V4는 캡션 컬럼을
    // ⑥ 캡션 단계가 소유하므로 여기서 건드리지 않는다(이중 소유 금지).
    columns?: { caption: string; hashtags: string[] };
    locationId: string | null;
    conceptJson: Prisma.InputJsonValue;
    manual: boolean;
    // V4: 프롬프트당 1장. undefined면 워커 기본값(env)을 따른다(v3·V2).
    candidateCount?: number;
    jobs: {
      prompt: string;
      sortOrder: number;
      paramsJson: Prisma.InputJsonValue;
    }[];
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.postDraft.updateMany({
        where: {
          id: input.draftId,
          status: "generating",
          AND: [
            {
              conceptJson: {
                path: ["pipeline", "stage"],
                equals: "image_prompt",
              },
            },
            {
              conceptJson: {
                path: ["pipeline", "state"],
                equals: "running",
              },
            },
          ],
        },
        data: {
          ...(input.columns ?? {}),
          locationId: input.locationId,
          conceptJson: input.conceptJson,
          leaseExpiresAt: null,
          errorMessage: null,
        },
      });
      if (updated.count !== 1) return false;
      for (const job of input.jobs) {
        await tx.generationJob.create({
          data: {
            characterId: input.characterId,
            mediaType: "image",
            prompt: job.prompt,
            draftId: input.draftId,
            sortOrder: job.sortOrder,
            ...(input.manual ? { status: "draft" as const } : {}),
            ...(input.candidateCount !== undefined
              ? { candidateCount: input.candidateCount }
              : {}),
            paramsJson: job.paramsJson,
          },
        });
      }
      await tx.characterActionLog.create({
        data: {
          characterId: input.characterId,
          actionType: "DRAFT_V3_PROMPTS_READY",
          targetTable: "post_drafts",
          targetId: input.draftId,
          reason: `${input.jobs.length} V3 prompt job(s) stored`,
        },
      });
      return true;
    });
  }

  async requeueOrFailV3(input: {
    draftId: string;
    conceptJson: Prisma.InputJsonValue;
    message: string;
    terminal: boolean;
  }): Promise<void> {
    await this.prisma.postDraft.updateMany({
      where: { id: input.draftId, status: "generating" },
      data: {
        status: input.terminal ? "failed" : "planned",
        conceptJson: input.conceptJson,
        errorMessage: input.message,
        leaseExpiresAt: null,
      },
    });
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
    locationId?: string;
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
          locationId: input.locationId ?? null,
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

  async findGeneratingDrafts(take: number): Promise<AggregateDraft[]> {
    // 수동으로 시작했거나 운영자 개입으로 manual이 된 draft는 단계 버튼으로만
    // 집계한다. 먼저 id를 고르면 manual draft가 batch를 채워 자동 draft를
    // 굶기는 문제도 피할 수 있다.
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT d.id
      FROM opod.post_drafts d
      WHERE d.status IN ('generating', 'regenerating')
        AND d.lease_expires_at IS NULL
        AND (d.concept_json->>'mode') IS DISTINCT FROM 'manual'
      ORDER BY d.updated_at, d.id
      LIMIT ${take}
    `;
    if (rows.length === 0) return [];
    return this.prisma.postDraft.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
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

  // V4: 컷이 전부 완료되면 검수가 아니라 ⑥ 캡션 단계로 간다. 자동 모드는
  // 워커가 planned+pending을 집어가고, 수동 모드는 단계 버튼이 집어간다.
  async markDraftCaptionPending(
    draftId: string,
    currentStatus: string,
    conceptJson: Prisma.InputJsonValue,
  ): Promise<boolean> {
    const transitioned = await this.prisma.postDraft.updateMany({
      where: { id: draftId, status: currentStatus as never },
      data: { status: "planned", conceptJson, errorMessage: null },
    });
    return transitioned.count > 0;
  }

  findDueDrafts(now: Date, take: number): Promise<PublishDraft[]> {
    return this.prisma.postDraft.findMany({
      where: {
        AND: [PUBLISHABLE_WHERE],
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

  // V4 ⑥ 캡션 입력 — 컷별 최신 completed 잡의 게시 이미지(1장). 컷이 재생성되면
  // 최신 잡이 바뀌므로 같은 정렬을 게시·평가와 공유한다.
  async findCaptionShots(draftId: string): Promise<CaptionShot[]> {
    const jobs = await this.prisma.generationJob.findMany({
      where: { draftId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        sortOrder: true,
        status: true,
        outputMediaId: true,
        outputMedia: {
          select: { id: true, url: true, storageKey: true, contentType: true },
        },
      },
    });
    const latest = new Map<number, (typeof jobs)[number]>();
    for (const job of jobs) {
      if (!latest.has(job.sortOrder)) latest.set(job.sortOrder, job);
    }
    return [...latest.values()]
      .filter(
        (
          job,
        ): job is typeof job & {
          outputMedia: NonNullable<typeof job.outputMedia>;
        } => job.status === "completed" && job.outputMedia !== null,
      )
      .map((job) => ({
        sortOrder: job.sortOrder,
        jobId: job.id,
        mediaId: job.outputMedia.id,
        media: {
          url: job.outputMedia.url,
          storageKey: job.outputMedia.storageKey,
          contentType: job.outputMedia.contentType,
        },
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
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
    memoryContent?: string;
    memories?: { type: string; content: string; reason: string }[];
    media: {
      originalMediaId: string;
      finishedFile: FinishedPublishFile | null;
    }[];
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.postDraft.updateMany({
        where: { id: input.draftId, AND: [PUBLISHABLE_WHERE] },
        data: { status: "published", errorMessage: null },
      });
      if (transitioned.count === 0) {
        throw new Error("draft left the publishable state before publish");
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
      const memories =
        input.memories ??
        (input.memoryContent
          ? [
              {
                type: "fact",
                content: input.memoryContent,
                reason: "auto: post published from draft",
              },
            ]
          : []);
      for (const memory of memories) {
        const existing = await tx.characterMemory.findFirst({
          where: {
            characterId: input.characterId,
            type: memory.type,
            content: memory.content,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!existing) {
          await tx.characterMemory.create({
            data: {
              characterId: input.characterId,
              type: memory.type,
              content: memory.content,
              reason: memory.reason,
            },
          });
        }
      }
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
    pipelineV3Enabled = false,
  ): Promise<void> {
    await this.prisma.postDraft.create({
      data: {
        characterId,
        conceptJson: pipelineV3Enabled
          ? createPostPipelineV3Concept({ source: "scheduler", mode: "auto" })
          : { source: "scheduler" },
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
