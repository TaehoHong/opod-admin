import { Injectable } from "@nestjs/common";
import { PostDraft, Prisma } from "@prisma/client";
import { PrismaService } from "../domain/database/prisma.service";
import {
  createPostPipelineV3Concept,
  POST_PIPELINE_V3,
  POST_PIPELINE_V4,
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

export type AggregateDraft = Prisma.PostDraftGetPayload<{
  select: typeof aggregateDraftSelect;
}>;

export type PlannedDraft = Prisma.PostDraftGetPayload<{
  include: typeof plannedDraftInclude;
}>;

export type PublishDraft = Pick<
  PostDraft,
  | "id"
  | "characterId"
  | "contentType"
  | "caption"
  | "hashtags"
  | "conceptJson"
  | "leaseExpiresAt"
>;

// v3와 v4는 같은 오케스트레이터가 돌린다. claim·sweep은 **버전 문자열 비교**라
// 타입 검사가 못 잡는다 — 한쪽만 v4를 빠뜨리면 V4 초안이 V3 경로에서 안 잡히고
// V2 경로로 새어 V2 플래너가 덮어쓴다. 그래서 술어를 이 상수로만 만든다.
const V3_FAMILY: Prisma.PostDraftWhereInput = {
  OR: [
    { conceptJson: { path: ["pipelineVersion"], equals: POST_PIPELINE_V3 } },
    { conceptJson: { path: ["pipelineVersion"], equals: POST_PIPELINE_V4 } },
  ],
};
// raw SQL 쪽. pipelineVersion이 없는 legacy V2 draft는 NULL이라 NOT IN이 NULL을
// 내므로 제외 술어는 IS NULL을 함께 본다.
function v3FamilySql(alias: string) {
  return Prisma.sql`${Prisma.raw(alias)}concept_json->>'pipelineVersion' IN (${POST_PIPELINE_V3}, ${POST_PIPELINE_V4})`;
}
function notV3FamilySql(alias: string) {
  return Prisma.sql`(${Prisma.raw(alias)}concept_json->>'pipelineVersion' IS NULL OR ${Prisma.raw(alias)}concept_json->>'pipelineVersion' NOT IN (${POST_PIPELINE_V3}, ${POST_PIPELINE_V4}))`;
}

// 러너가 실행하는 단계 = Agent 단계뿐이다(post-pipeline-v3.runner.ts
// runCurrentStage의 디스패치). ⑦ 게시·⑧ 메모리는 게시 루프와 운영자의 몫이라
// claim이 그 단계를 집으면 러너가 초안을 unknown_stage로 죽인다 — 그리고 failed
// state는 게시·캡션 편집·컷 재생성 게이트(전부 state=pending)를 동시에 막아
// 되살릴 방법이 없다. 그래서 "집지 않는다"가 1차 방어다.
const AGENT_STAGES = ["post_plan", "image_plan", "image_prompt", "caption"];
function agentStageSql(alias: string) {
  return Prisma.sql`${Prisma.raw(alias)}concept_json#>>'{pipeline,stage}' IN (${Prisma.join(AGENT_STAGES)})`;
}

function publishableSql(alias: string) {
  return Prisma.sql`(
    ${Prisma.raw(alias)}status = 'approved'
    OR (
      ${Prisma.raw(alias)}status = 'planned'
      AND ${Prisma.raw(alias)}concept_json#>>'{pipeline,stage}' = 'publish'
      AND ${Prisma.raw(alias)}concept_json#>>'{pipeline,state}' = 'pending'
    )
  )`;
}

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

export type RecentVisualPlanDraft = {
  id: string;
  createdAt: Date;
  publishedPostId: string | null;
  conceptJson: unknown;
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
        NOT: V3_FAMILY,
      },
      data: {
        status: "generating",
        leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1000),
        attemptCount: { increment: 1 },
      },
    });
    return claimed.count > 0;
  }

  async findApprovedDraft(
    draftId: string,
    leaseSeconds = 120,
  ): Promise<PublishDraft | null> {
    const rows = await this.prisma.$queryRaw<PublishDraft[]>`
      UPDATE opod.post_drafts d
      SET lease_expires_at = now() + make_interval(secs => ${leaseSeconds})
      WHERE d.id = ${draftId}::uuid
        AND d.draft_type = 'post'
        AND ${publishableSql("d.")}
        AND (d.lease_expires_at IS NULL OR d.lease_expires_at < now())
        AND EXISTS (
          SELECT 1 FROM opod.characters c
          WHERE c.id = d.character_id AND c.status = 'active'
        )
      RETURNING d.id,
                d.character_id AS "characterId",
                d.content_type AS "contentType",
                d.caption,
                d.hashtags,
                d.concept_json AS "conceptJson",
                d.lease_expires_at AS "leaseExpiresAt"
    `;
    return rows[0] ?? null;
  }

  async recordPublishError(
    draftId: string,
    message: string,
    leaseExpiresAt?: Date | null,
  ): Promise<void> {
    await this.prisma.postDraft.updateMany({
      where: {
        id: draftId,
        AND: [PUBLISHABLE_WHERE],
        ...(leaseExpiresAt ? { leaseExpiresAt } : {}),
      },
      data: { errorMessage: message, leaseExpiresAt: null },
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

  findRecentVisualPlanDrafts(
    characterId: string,
    excludeDraftId: string,
    take: number,
  ): Promise<RecentVisualPlanDraft[]> {
    return this.prisma.postDraft.findMany({
      where: {
        characterId,
        id: { not: excludeDraftId },
        draftType: "post",
        status: { notIn: ["failed", "rejected"] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      select: {
        id: true,
        createdAt: true,
        publishedPostId: true,
        conceptJson: true,
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
          attemptCount: 0,
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
        NOT: V3_FAMILY,
      },
      data: { status: "planned", leaseExpiresAt: null },
    });
    await this.prisma.postDraft.updateMany({
      where: {
        status: "generating",
        leaseExpiresAt: { lt: now },
        attemptCount: { gte: maxAttempts },
        NOT: V3_FAMILY,
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
        AND ${v3FamilySql("")}
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
        AND ${v3FamilySql("")}
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
          AND ${notV3FamilySql("d.")}
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
          concept_json = jsonb_set(
            concept_json #- '{pipeline,failure}',
            '{pipeline,state}',
            '"running"'::jsonb
          ),
          updated_at = now()
      WHERE id = (
        SELECT d.id FROM opod.post_drafts d
        JOIN opod.characters c ON c.id = d.character_id AND c.status = 'active'
        WHERE d.status = 'planned' AND d.draft_type = 'post'
          AND ${v3FamilySql("d.")}
          AND d.concept_json#>>'{pipeline,state}' = 'pending'
          AND ${agentStageSql("d.")}
          AND (d.concept_json->>'mode') IS DISTINCT FROM 'manual'
        ORDER BY d.created_at, d.id
        LIMIT 1
        FOR UPDATE OF d SKIP LOCKED
      )
      RETURNING id
    `;
    return rows[0]?.id;
  }

  // 수동 실행. 자동 claim과 두 가지가 다르다.
  //
  // 1) 멈춰 선 상태면 사유를 가리지 않고 집는다(running만 제외). 화면이 실패·
  //    입력 부족·설정 부족에 "고친 뒤 재실행하세요"라고 안내하는데 claim이
  //    pending만 집으면 그 버튼이 400을 낸다 — 실패 상태가 유일한 복구 경로까지
  //    잠갔다. 자동 루프는 계속 pending만 집는다(실패를 무한 재시도하지 않는다).
  // 2) ⑦ 게시에 서 있는 V4 초안은 단계를 ⑥ 캡션으로 되감아 집는다 — "캡션 다시
  //    생성"이 부르는 경로가 여기라서, 되감지 않으면 러너가 게시 단계를
  //    실행하려 든다. 되감아도 잃을 산출물이 없다(⑦은 산출물이 없고 captionBuild는
  //    새 revision으로 쌓인다). 자동 claim은 절대 되감지 않는다 — 캡션↔게시를
  //    무한히 왕복한다.
  async claimV3DraftNow(
    draftId: string,
    leaseSeconds: number,
  ): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE opod.post_drafts
      SET status = 'generating',
          lease_expires_at = now() + make_interval(secs => ${leaseSeconds}),
          attempt_count = CASE WHEN status = 'failed' THEN 1
                               ELSE attempt_count + 1 END,
          error_message = NULL,
          concept_json = jsonb_set(
            jsonb_set(
              concept_json #- '{pipeline,failure}',
              '{pipeline,stage}',
              CASE WHEN concept_json#>>'{pipeline,stage}' = 'publish'
                   THEN '"caption"'::jsonb
                   ELSE concept_json#>'{pipeline,stage}' END
            ),
            '{pipeline,state}',
            '"running"'::jsonb
          ),
          updated_at = now()
      WHERE id = ${draftId}::uuid
        AND status IN ('planned', 'failed')
        AND draft_type = 'post'
        AND ${v3FamilySql("")}
        AND concept_json#>>'{pipeline,state}' <> 'running'
        AND (
          ${agentStageSql("")}
          OR (
            concept_json#>>'{pipeline,stage}' = 'publish'
            AND concept_json->'captionBuild' IS NOT NULL
          )
        )
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
          attemptCount: 0,
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
          attemptCount: 0,
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
      data: {
        status: "planned",
        conceptJson,
        attemptCount: 0,
        errorMessage: null,
      },
    });
    return transitioned.count > 0;
  }

  findDueDrafts(
    now: Date,
    take: number,
    leaseSeconds: number,
    retryBefore: Date,
  ): Promise<PublishDraft[]> {
    return this.prisma.$queryRaw<PublishDraft[]>`
      WITH candidates AS (
        SELECT d.id
        FROM opod.post_drafts d
        JOIN opod.characters c
          ON c.id = d.character_id AND c.status = 'active'
        WHERE d.draft_type = 'post'
          AND ${publishableSql("d.")}
          AND (d.scheduled_at IS NULL OR d.scheduled_at <= ${now})
          AND (d.concept_json->>'mode') IS DISTINCT FROM 'manual'
          AND (d.lease_expires_at IS NULL OR d.lease_expires_at < now())
          AND (d.error_message IS NULL OR d.updated_at <= ${retryBefore})
        ORDER BY (d.error_message IS NOT NULL), d.scheduled_at ASC NULLS FIRST, d.id
        LIMIT ${take}
        FOR UPDATE OF d SKIP LOCKED
      )
      UPDATE opod.post_drafts d
      SET lease_expires_at = now() + make_interval(secs => ${leaseSeconds})
      FROM candidates
      WHERE d.id = candidates.id
      RETURNING d.id,
                d.character_id AS "characterId",
                d.content_type AS "contentType",
                d.caption,
                d.hashtags,
                d.concept_json AS "conceptJson",
                d.lease_expires_at AS "leaseExpiresAt"
    `;
  }

  async recordPublishFailure(input: {
    draftId: string;
    characterId: string;
    message: string;
    leaseExpiresAt?: Date | null;
  }): Promise<void> {
    await this.recordPublishError(
      input.draftId,
      input.message,
      input.leaseExpiresAt,
    );
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
    leaseExpiresAt?: Date | null;
    memoryContent?: string;
    memories?: { type: string; content: string; reason: string }[];
    media: {
      originalMediaId: string;
      finishedFile: FinishedPublishFile | null;
    }[];
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.postDraft.updateMany({
        where: {
          id: input.draftId,
          AND: [PUBLISHABLE_WHERE],
          ...(input.leaseExpiresAt
            ? { leaseExpiresAt: input.leaseExpiresAt }
            : {}),
        },
        data: {
          status: "published",
          errorMessage: null,
          leaseExpiresAt: null,
        },
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
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // 같은 캐릭터를 여러 admin instance가 동시에 스케줄링해도 한 transaction만
      // pending 여부를 판정한다. payment reconciliation의 기존 advisory-lock
      // 패턴과 같은 DB-scoped 직렬화다.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${characterId}, 0))`;
      const pending = await tx.postDraft.findFirst({
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
      if (pending) return false;
      await tx.postDraft.create({
        data: {
          characterId,
          conceptJson: pipelineV3Enabled
            ? createPostPipelineV3Concept({ source: "scheduler", mode: "auto" })
            : { source: "scheduler" },
          scheduledAt,
        },
      });
      return true;
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
