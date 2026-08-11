// 평가 워커의 DB 접근 계층. 클레임은 "평가 대상 draft를 잠그고 pending
// 평가 행을 삽입"으로 원자화한다 — draft 상태 머신은 건드리지 않는다
// (docs/plan-prompt-evaluation-agent.md 3절).
// attempt는 평가 시도 번호다. 재기획·프롬프트 재빌드·컷 재생성 action이 최신
// 평가보다 새로우면 completed 이력을 보존한 채 다음 attempt를 클레임한다.

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../domain/database/prisma.service";

export type DraftEvaluationKind = "plan" | "prompt" | "image";

export type ClaimedEvaluation = {
  evaluationId: string;
  draftId: string;
  characterId: string;
  contentLanguage: string;
  attempt: number;
};

export type PlanEvaluationSource = {
  draftId: string;
  characterId: string;
  contentLanguage: string;
  characterName: string;
  bio: string;
  interests: string[];
  locationName?: string;
  conceptJson: unknown;
};

export type PromptEvaluationJob = {
  id: string;
  sortOrder: number;
  prompt: string;
  paramsJson: unknown;
  createdAt: Date;
};

export type PromptEvaluationSource = {
  draftId: string;
  caption: string;
  conceptJson: unknown;
  jobs: PromptEvaluationJob[];
};

export type ImageEvaluationSource = PromptEvaluationSource & {
  jobs: (PromptEvaluationJob & {
    status: string;
    outputs: {
      mediaId: string;
      candidateIndex: number;
      media: {
        url: string;
        storageKey: string | null;
        contentType: string | null;
      };
    }[];
  })[];
  referenceMedia: {
    id: string;
    url: string;
    storageKey: string | null;
    contentType: string | null;
  }[];
};

@Injectable()
export class EvaluationRepository {
  constructor(private readonly prisma: PrismaService) {}

  // 만료된 pending lease는 failed로 전환한다. 실패 행은 maxAttempts까지
  // 다음 attempt 클레임으로 이어지므로 별도 재큐가 필요 없다.
  async sweepExpiredLeases(now: Date): Promise<number> {
    const swept = await this.prisma.draftEvaluation.updateMany({
      where: { status: "pending", leaseExpiresAt: { lt: now } },
      data: {
        status: "failed",
        errorMessage: "evaluation lease expired",
        leaseExpiresAt: null,
      },
    });
    return swept.count;
  }

  // Prisma에는 SKIP LOCKED claim의 동등한 API가 없어 tagged SQL을 쓴다.
  // 동적 값은 interpolation binding으로만 전달한다.
  async claim(
    kind: DraftEvaluationKind,
    leaseSeconds: number,
    maxAttempts: number,
    rubricVersion: string,
  ): Promise<ClaimedEvaluation | undefined> {
    return this.prisma.$transaction(async (tx) => {
      // prompt 평가는 빌드된(비어 있지 않은) 프롬프트가 있어야 한다 —
      // 수동 모드 draft는 기획 시점에 prompt = ''로 잡을 만든다.
      const promptGate =
        kind === "prompt"
          ? Prisma.sql`AND EXISTS (
              SELECT 1 FROM opod.generation_jobs j
              WHERE j.draft_id = d.id AND j.prompt <> ''
            )`
          : Prisma.empty;
      const imageGate =
        kind === "image"
          ? Prisma.sql`AND EXISTS (
              SELECT 1
              FROM opod.generation_jobs j
              JOIN opod.generation_job_outputs o ON o.job_id = j.id
              WHERE j.draft_id = d.id AND j.status = 'completed'
            )
            AND EXISTS (
              SELECT 1 FROM opod.character_action_logs ready
              WHERE ready.target_table = 'post_drafts'
                AND ready.target_id = d.id
                AND ready.action_type = 'DRAFT_READY_FOR_REVIEW'
            )
            AND NOT EXISTS (
              SELECT 1 FROM opod.character_action_logs regenerated
              WHERE regenerated.target_table = 'post_drafts'
                AND regenerated.target_id = d.id
                AND regenerated.action_type = 'DRAFT_SHOT_REGENERATED'
                AND regenerated.created_at > (
                  SELECT max(ready.created_at)
                  FROM opod.character_action_logs ready
                  WHERE ready.target_table = 'post_drafts'
                    AND ready.target_id = d.id
                    AND ready.action_type = 'DRAFT_READY_FOR_REVIEW'
                )
            )`
          : Prisma.empty;
      const relevantAction =
        kind === "plan"
          ? Prisma.sql`l.action_type = 'DRAFT_PLANNED'`
          : kind === "image"
            ? Prisma.sql`l.action_type = 'DRAFT_READY_FOR_REVIEW'`
            : Prisma.sql`l.action_type IN (
              'DRAFT_PLANNED',
              'DRAFT_PROMPTS_BUILT',
              'DRAFT_SHOT_REGENERATED'
            )`;
      const rows = await tx.$queryRaw<
        { id: string; character_id: string; content_language: string }[]
      >`
        SELECT d.id, d.character_id, c.content_language
        FROM opod.post_drafts d
        JOIN opod.characters c ON c.id = d.character_id AND c.status = 'active'
        WHERE d.draft_type = 'post'
          AND d.concept_json ? 'plan'
          ${promptGate}
          ${imageGate}
          AND NOT EXISTS (
            SELECT 1 FROM opod.draft_evaluations e
            WHERE e.draft_id = d.id
              AND e.kind = ${kind}::opod.draft_evaluation_kind
              AND e.status = 'pending'
          )
          AND (
            NOT EXISTS (
              SELECT 1 FROM opod.draft_evaluations e
              WHERE e.draft_id = d.id
                AND e.kind = ${kind}::opod.draft_evaluation_kind
                AND e.status = 'completed'
            )
            OR EXISTS (
              SELECT 1 FROM opod.character_action_logs l
              WHERE l.target_table = 'post_drafts'
                AND l.target_id = d.id
                AND ${relevantAction}
                AND l.created_at > (
                  SELECT max(e.created_at)
                  FROM opod.draft_evaluations e
                  WHERE e.draft_id = d.id
                    AND e.kind = ${kind}::opod.draft_evaluation_kind
                    AND e.status = 'completed'
                )
            )
          )
          AND (
            SELECT count(*) FROM opod.draft_evaluations e
            WHERE e.draft_id = d.id
              AND e.kind = ${kind}::opod.draft_evaluation_kind
              AND e.status = 'failed'
              AND e.created_at >= COALESCE(
                (
                  SELECT max(l.created_at)
                  FROM opod.character_action_logs l
                  WHERE l.target_table = 'post_drafts'
                    AND l.target_id = d.id
                    AND ${relevantAction}
                ),
                d.created_at
              )
          ) < ${maxAttempts}
        ORDER BY d.created_at DESC, d.id
        LIMIT 1
        FOR UPDATE OF d SKIP LOCKED
      `;
      const candidate = rows[0];
      if (!candidate) {
        return undefined;
      }
      const previous = await tx.draftEvaluation.aggregate({
        where: { draftId: candidate.id, kind },
        _max: { attempt: true },
      });
      const attempt = (previous._max.attempt ?? 0) + 1;
      const created = await tx.draftEvaluation.create({
        data: {
          draftId: candidate.id,
          kind,
          attempt,
          status: "pending",
          leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1000),
          rubricVersion,
          contentLanguage: candidate.content_language,
        },
        select: { id: true },
      });
      return {
        evaluationId: created.id,
        draftId: candidate.id,
        characterId: candidate.character_id,
        contentLanguage: candidate.content_language,
        attempt,
      };
    });
  }

  async loadPlanSource(draftId: string): Promise<PlanEvaluationSource | null> {
    const draft = await this.prisma.postDraft.findUnique({
      where: { id: draftId },
      select: {
        id: true,
        characterId: true,
        conceptJson: true,
        character: {
          select: {
            displayName: true,
            bio: true,
            interests: true,
            contentLanguage: true,
          },
        },
        location: { select: { displayName: true } },
      },
    });
    if (!draft) {
      return null;
    }
    return {
      draftId: draft.id,
      characterId: draft.characterId,
      contentLanguage: draft.character.contentLanguage,
      characterName: draft.character.displayName,
      bio: draft.character.bio,
      interests: draft.character.interests,
      ...(draft.location?.displayName
        ? { locationName: draft.location.displayName }
        : {}),
      conceptJson: draft.conceptJson,
    };
  }

  async loadPromptSource(
    draftId: string,
  ): Promise<PromptEvaluationSource | null> {
    const draft = await this.prisma.postDraft.findUnique({
      where: { id: draftId },
      select: {
        id: true,
        caption: true,
        conceptJson: true,
        jobs: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            sortOrder: true,
            prompt: true,
            paramsJson: true,
            createdAt: true,
          },
        },
      },
    });
    if (!draft) {
      return null;
    }
    return {
      draftId: draft.id,
      caption: draft.caption,
      conceptJson: draft.conceptJson,
      jobs: draft.jobs,
    };
  }

  async loadImageSource(
    draftId: string,
  ): Promise<ImageEvaluationSource | null> {
    const draft = await this.prisma.postDraft.findUnique({
      where: { id: draftId },
      select: {
        id: true,
        caption: true,
        conceptJson: true,
        jobs: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            sortOrder: true,
            prompt: true,
            paramsJson: true,
            createdAt: true,
            status: true,
            outputs: {
              orderBy: { candidateIndex: "asc" },
              select: {
                mediaId: true,
                candidateIndex: true,
                media: {
                  select: {
                    url: true,
                    storageKey: true,
                    contentType: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!draft) return null;

    const referenceIds = [
      ...new Set(
        draft.jobs.flatMap((job) => {
          const params = isJsonRecord(job.paramsJson);
          const shot = isJsonRecord(params?._shot);
          return [
            ...jsonStrings(shot?.identityReferenceMediaIds),
            ...jsonStrings(shot?.environmentReferenceMediaIds),
          ];
        }),
      ),
    ];
    const referenceMedia = referenceIds.length
      ? await this.prisma.media.findMany({
          where: { id: { in: referenceIds } },
          select: {
            id: true,
            url: true,
            storageKey: true,
            contentType: true,
          },
        })
      : [];
    return {
      draftId: draft.id,
      caption: draft.caption,
      conceptJson: draft.conceptJson,
      jobs: draft.jobs,
      referenceMedia,
    };
  }

  async complete(input: {
    evaluationId: string;
    evaluatorName: string;
    overallScore: number;
    scoresJson: Prisma.InputJsonValue;
    issuesJson: Prisma.InputJsonValue;
    suggestionsJson: Prisma.InputJsonValue;
  }): Promise<void> {
    await this.prisma.draftEvaluation.updateMany({
      where: { id: input.evaluationId, status: "pending" },
      data: {
        status: "completed",
        evaluatorName: input.evaluatorName,
        overallScore: input.overallScore,
        scoresJson: input.scoresJson,
        issuesJson: input.issuesJson,
        suggestionsJson: input.suggestionsJson,
        leaseExpiresAt: null,
        errorMessage: null,
        completedAt: new Date(),
      },
    });
  }

  async fail(evaluationId: string, message: string): Promise<void> {
    await this.prisma.draftEvaluation.updateMany({
      where: { id: evaluationId, status: "pending" },
      data: {
        status: "failed",
        errorMessage: message.slice(0, 2000),
        leaseExpiresAt: null,
        completedAt: new Date(),
      },
    });
  }

  // 검수 화면용 — draft의 평가 이력(최신 attempt 우선).
  findByDraft(draftId: string) {
    return this.prisma.draftEvaluation.findMany({
      where: { draftId },
      orderBy: [{ kind: "asc" }, { attempt: "desc" }],
    });
  }

  // 오프라인 집계용 — 기간 내 completed 평가 + 휴먼 시그널 원천.
  // 집계 계산은 볼륨이 작아 서비스 계층(TS)에서 한다.
  findCompletedInPeriod(input: {
    from: Date;
    to: Date;
    rubricVersion: string;
  }) {
    return this.prisma.draftEvaluation.findMany({
      where: {
        status: "completed",
        rubricVersion: input.rubricVersion,
        createdAt: { gte: input.from, lt: input.to },
      },
      include: {
        draft: {
          select: {
            id: true,
            status: true,
            caption: true,
            conceptJson: true,
            publishedPostId: true,
            jobs: {
              select: {
                id: true,
                sortOrder: true,
                originJobId: true,
                status: true,
                outputs: { select: { selected: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async createReport(input: {
    periodStart: Date;
    periodEnd: Date;
    rubricVersion: string;
    summaryJson: Prisma.InputJsonValue;
    failurePatternsJson?: Prisma.InputJsonValue;
  }) {
    return this.prisma.evaluationReport.create({
      data: {
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        rubricVersion: input.rubricVersion,
        summaryJson: input.summaryJson,
        ...(input.failurePatternsJson !== undefined
          ? { failurePatternsJson: input.failurePatternsJson }
          : {}),
      },
    });
  }

  listReports(limit: number) {
    return this.prisma.evaluationReport.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  findReport(id: string) {
    return this.prisma.evaluationReport.findUnique({ where: { id } });
  }
}

function isJsonRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function jsonStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
