import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../domain/database/prisma.service";
import { ContentPlanner } from "./content-planner";
import {
  applyFinishWithMeta,
  downloadMediaBytes,
  FinishedImage,
  FinishPreset,
  mediaSourceBytes,
  parseFinishPreset,
} from "./film-finish";
import {
  GeneratedMediaStore,
  localGeneratedMediaStore,
  ReferenceUrlSigner,
} from "./generated-media-store";
import { ImagePromptBuilder } from "./image-prompt-builder";
import { errorMessage, isRecord, parsePositiveNumber } from "./value-utils";

export type DraftWorkerConfig = {
  enabled: boolean;
  pollIntervalMs: number;
  // 기획(LLM) 단계 lease. 만료된 generating(잡 없음) draft는 스윕이 회수한다.
  planLeaseSeconds: number;
  maxAttempts: number;
  // draft당 컷 수 (= 생성 잡 수).
  maxShots: number;
  schedulerEnabled: boolean;
};

export function draftWorkerConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): DraftWorkerConfig {
  return {
    enabled: env.WORKER_ENABLED === "true" || env.WORKER_ENABLED === "1",
    pollIntervalMs: parsePositiveNumber(env.WORKER_POLL_INTERVAL_MS) ?? 15_000,
    planLeaseSeconds: parsePositiveNumber(env.DRAFT_PLAN_LEASE_SECONDS) ?? 120,
    maxAttempts: parsePositiveNumber(env.DRAFT_MAX_ATTEMPTS) ?? 3,
    maxShots: parsePositiveNumber(env.DRAFT_MAX_SHOTS) ?? 2,
    schedulerEnabled:
      env.DRAFT_SCHEDULER_ENABLED === "true" ||
      env.DRAFT_SCHEDULER_ENABLED === "1",
  };
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const AGGREGATE_BATCH = 20;
const PUBLISH_BATCH = 5;

// 집계(자동 루프·수동 트리거 공용)가 읽는 초안 형태.
const AGGREGATE_DRAFT_SELECT = {
  id: true,
  characterId: true,
  status: true,
  jobs: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { sortOrder: true, status: true },
  },
} satisfies Prisma.PostDraftSelect;

type PlannedDraft = {
  id: string;
  characterId: string;
  status: string;
  attemptCount: number;
  conceptJson: unknown;
  character: {
    displayName: string;
    bio: string;
    interests: string[];
    personas: { title: string; content: string }[];
    memories: { content: string }[];
    posts: { content: string }[];
    visualProfile: {
      appearancePrompt: string;
      stylePrompt: string;
      referenceMedia: { mediaId: string; description: string }[];
    } | null;
  };
};

// PostDraft 상태 머신을 굴리는 워커.
// planned --claim--> generating(기획, lease) --잡 생성--> generating(lease 해제)
// 컷별 최신 잡이 전부 completed → needs_review, 하나라도 failed → failed.
// approved + scheduledAt 도래 → 트랜잭션 게시 → published + 메모리 역반영.
@Injectable()
export class DraftWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DraftWorkerService.name);
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private activeTick?: Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    // 기획 시마다 재해석한다 — admin 설정(UI)에서 LLM URL/키/모델을 바꾸면
    // 프로세스 재시작 없이 다음 기획부터 반영된다.
    private readonly resolvePlanner: () => Promise<ContentPlanner>,
    // 프롬프트 빌더도 실행 시마다 재해석 (플래너와 동일한 이유).
    private readonly resolvePromptBuilder: () => Promise<ImagePromptBuilder>,
    private readonly config: DraftWorkerConfig,
    private readonly random: () => number = Math.random,
    // 게시 직전 마감본 업로드용 (초안 검수 미리보기와 동일 연산).
    private readonly store: GeneratedMediaStore = localGeneratedMediaStore,
    private readonly signReferenceUrl: ReferenceUrlSigner | null = null,
    private readonly finishImage: (
      bytes: Buffer,
      preset: FinishPreset,
    ) => Promise<FinishedImage> = applyFinishWithMeta,
    private readonly downloadBytes: (
      url: string,
    ) => Promise<Buffer> = downloadMediaBytes,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled) {
      return;
    }
    void this.resolvePlanner()
      .then((planner) =>
        this.logger.log(
          `Draft worker enabled (planner=${planner.name}, scheduler=${this.config.schedulerEnabled})`,
        ),
      )
      .catch(() =>
        this.logger.log(
          `Draft worker enabled (scheduler=${this.config.schedulerEnabled})`,
        ),
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
      this.logger.error(`Draft worker tick failed: ${errorMessage(error)}`);
    } finally {
      this.scheduleNext();
    }
  }

  // 테스트에서 직접 호출한다.
  async tick(): Promise<void> {
    await this.sweepExpiredPlanLeases();
    if (this.config.schedulerEnabled) {
      await this.createScheduledDrafts();
    }
    await this.planClaimedDrafts();
    await this.aggregateGeneratingDrafts();
    await this.publishDueDrafts();
  }

  // ── 수동 실행 (admin 버튼) ──────────────────────────────────────────────
  // 자동 파이프라인과 같은 코드를 타되 타이밍만 운영자가 정한다.
  // WORKER_ENABLED와 무관하게 동작한다 (자동 루프만 env로 제어).

  // 지정 draft를 즉시 기획한다. planned가 아니거나 캐릭터가 inactive면 false.
  // 기획 실패는 자동 경로와 동일하게 planned 복귀/failed 전이로 흡수된다.
  async planDraftNow(draftId: string): Promise<{ planned: boolean }> {
    const claimed = await this.prisma.postDraft.updateMany({
      where: {
        id: draftId,
        status: "planned",
        draftType: "post",
        character: { status: "active" },
      },
      data: {
        status: "generating",
        leaseExpiresAt: new Date(
          Date.now() + this.config.planLeaseSeconds * 1000,
        ),
        attemptCount: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      return { planned: false };
    }
    await this.planDraft(draftId);
    return { planned: true };
  }

  // 지정 approved draft를 scheduledAt과 무관하게 즉시 게시한다.
  async publishDraftNow(
    draftId: string,
  ): Promise<{ published: boolean; reason?: string }> {
    const draft = await this.prisma.postDraft.findFirst({
      where: {
        id: draftId,
        status: "approved",
        draftType: "post",
        character: { status: "active" },
      },
      select: {
        id: true,
        characterId: true,
        contentType: true,
        caption: true,
        hashtags: true,
        conceptJson: true,
      },
    });
    if (!draft) {
      return { published: false };
    }
    try {
      await this.publishDraft(draft);
      return { published: true };
    } catch (error) {
      const message = errorMessage(error).slice(0, 500);
      await this.prisma.postDraft.updateMany({
        where: { id: draftId, status: "approved" },
        data: { errorMessage: message },
      });
      return { published: false, reason: message };
    }
  }

  // 수동 집계 — 생성 결과를 지금 집계해 검수(needs_review)로 전환한다.
  // 자동 루프(aggregateGeneratingDrafts)와 동일한 연산의 스텝 실행 모드라
  // 워커 루프가 죽어 있어도 검수 단계로 진행할 수 있다.
  async aggregateDraftNow(
    draftId: string,
  ): Promise<{ aggregated: boolean; reason?: string }> {
    const draft = await this.prisma.postDraft.findFirst({
      where: {
        id: draftId,
        status: { in: ["generating", "regenerating"] },
        leaseExpiresAt: null,
      },
      select: AGGREGATE_DRAFT_SELECT,
    });
    if (!draft) {
      return { aggregated: false };
    }
    const outcome = await this.aggregateDraft(draft);
    if (outcome === "pending") {
      return {
        aggregated: false,
        reason: "Some shots have not completed yet",
      };
    }
    return { aggregated: true };
  }

  // 수동 초안의 draft 상태 컷 프롬프트를 빌더로 생성해 채운다.
  // 기획(planDraftNow)과 컷 생성 실행 사이의 별도 스텝 — 수동 = 자동의 스텝
  // 실행 모드. 컷이 draft 상태인 동안은 재실행(덮어쓰기)해도 안전하다.
  async buildDraftPromptsNow(
    draftId: string,
  ): Promise<{ built: boolean; reason?: string }> {
    const draft = await this.prisma.postDraft.findFirst({
      where: { id: draftId, draftType: "post" },
      select: {
        id: true,
        characterId: true,
        conceptJson: true,
        character: {
          select: {
            visualProfile: {
              select: { appearancePrompt: true, stylePrompt: true },
            },
          },
        },
      },
    });
    if (!draft) {
      return { built: false };
    }
    const jobs = await this.prisma.generationJob.findMany({
      where: { draftId, mediaType: "image" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, sortOrder: true, status: true, paramsJson: true },
    });
    // 컷별 최신 잡만 대상 — 재생성 이력이 있어도 현행 잡만 빌드한다.
    const latestPerShot = new Map<number, (typeof jobs)[number]>();
    for (const job of jobs) {
      if (!latestPerShot.has(job.sortOrder)) {
        latestPerShot.set(job.sortOrder, job);
      }
    }
    const targets = [...latestPerShot.values()]
      .filter((job) => job.status === "draft")
      .sort((a, b) => a.sortOrder - b.sortOrder);
    if (targets.length === 0) {
      return {
        built: false,
        reason: "draft has no draft-state shots to build prompts for",
      };
    }
    const shots: { scene: string }[] = [];
    for (const job of targets) {
      const scene = shotSceneOf(job.paramsJson);
      if (!scene) {
        return {
          built: false,
          reason: `shot ${job.sortOrder} has no planned scene`,
        };
      }
      shots.push({ scene });
    }
    const profile = draft.character.visualProfile;
    const builder = await this.resolvePromptBuilder();
    let prompts: string[];
    try {
      prompts = (
        await builder.build({
          appearancePrompt: profile?.appearancePrompt ?? "",
          stylePrompt: profile?.stylePrompt ?? "",
          shots,
        })
      ).prompts;
    } catch (error) {
      return { built: false, reason: errorMessage(error).slice(0, 500) };
    }
    const concept = isRecord(draft.conceptJson) ? draft.conceptJson : {};
    await this.prisma.$transaction(async (tx) => {
      for (const [index, job] of targets.entries()) {
        // 빌드 중 큐잉된 잡은 조건 불일치로 건드리지 않는다 (재실행 안전).
        await tx.generationJob.updateMany({
          where: { id: job.id, status: "draft" },
          data: { prompt: prompts[index] },
        });
      }
      await tx.postDraft.update({
        where: { id: draft.id },
        data: {
          conceptJson: { ...concept, builderName: builder.name } as never,
        },
      });
      await tx.characterActionLog.create({
        data: {
          characterId: draft.characterId,
          actionType: "DRAFT_PROMPTS_BUILT",
          targetTable: "post_drafts",
          targetId: draft.id,
          reason: `shot prompts built via ${builder.name} (${targets.length} shot(s))`,
        },
      });
    });
    this.logger.log(
      `Draft ${draft.id} prompts built (${targets.length} shot(s))`,
    );
    return { built: true };
  }

  // ── 기획 단계 ────────────────────────────────────────────────────────────

  private async sweepExpiredPlanLeases(): Promise<void> {
    const now = new Date();
    const requeued = await this.prisma.postDraft.updateMany({
      where: {
        status: "generating",
        leaseExpiresAt: { lt: now },
        attemptCount: { lt: this.config.maxAttempts },
      },
      data: { status: "planned", leaseExpiresAt: null },
    });
    if (requeued.count > 0) {
      this.logger.warn(`Requeued ${requeued.count} expired planning draft(s)`);
    }
    await this.prisma.postDraft.updateMany({
      where: {
        status: "generating",
        leaseExpiresAt: { lt: now },
        attemptCount: { gte: this.config.maxAttempts },
      },
      data: {
        status: "failed",
        errorMessage: "planning lease expired",
        leaseExpiresAt: null,
      },
    });
  }

  private async planClaimedDrafts(): Promise<void> {
    for (;;) {
      const draftId = await this.claimPlannedDraft();
      if (!draftId) {
        return;
      }
      await this.planDraft(draftId);
    }
  }

  // planned draft를 SKIP LOCKED으로 집는다. inactive 캐릭터의 draft는 보류.
  // 수동 진행 초안(conceptJson.mode = 'manual')은 자동 기획이 집지 않는다 —
  // 운영자가 단계마다 버튼으로 진행하며(planDraftNow), 자동으로 넘어가지 않는다.
  private async claimPlannedDraft(): Promise<string | undefined> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE opod.post_drafts
      SET status = 'generating',
          lease_expires_at = now() + make_interval(secs => ${this.config.planLeaseSeconds}),
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

  private async planDraft(draftId: string): Promise<void> {
    const draft = (await this.prisma.postDraft.findUnique({
      where: { id: draftId },
      include: {
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
                  select: { mediaId: true, description: true },
                },
              },
            },
          },
        },
      },
    })) as PlannedDraft | null;
    if (!draft || draft.status !== "generating") {
      return;
    }

    try {
      const concept = isRecord(draft.conceptJson) ? draft.conceptJson : {};
      const sceneHint = String(concept.sceneHint ?? "").trim() || undefined;
      // 수동 진행 초안: 컷 잡을 draft(비claim) 상태로 만들어 생성 워커가
      // 자동으로 집지 않게 한다 — 운영자가 컷별 "이미지 생성 실행"으로 진행.
      const manualMode = concept.mode === "manual";
      const planner = await this.resolvePlanner();
      // 캡션 있는 레퍼런스만 카탈로그로 — LLM이 샷별로 어울리는 컷을 고른다.
      const referenceCatalog = (
        draft.character.visualProfile?.referenceMedia ?? []
      )
        .filter((reference) => reference.description)
        .map((reference) => ({
          id: reference.mediaId,
          description: reference.description,
        }));
      const planInput = {
        characterName: draft.character.displayName,
        bio: draft.character.bio,
        interests: draft.character.interests,
        personas: draft.character.personas,
        memories: draft.character.memories.map((memory) => memory.content),
        recentCaptions: draft.character.posts
          .map((post) => post.content)
          .filter(Boolean),
        sceneHint,
        maxShots: this.config.maxShots,
        ...(referenceCatalog.length > 0 ? { referenceCatalog } : {}),
      };
      const plan = await planner.plan(planInput);

      // 기획·빌드 LLM을 직렬로 부르면 기본 리스(120s)를 넘길 수 있어,
      // 스윕이 중간에 회수해 이중 기획하지 않도록 리스를 연장한다.
      await this.prisma.postDraft.updateMany({
        where: { id: draft.id, status: "generating" },
        data: {
          leaseExpiresAt: new Date(
            Date.now() + this.config.planLeaseSeconds * 1000,
          ),
        },
      });

      // 자동 모드는 기획 직후 프롬프트 빌드까지 한 시도로 진행한다 (빌드
      // 실패 = 기획 실패, 같은 재시도 경로). 수동 모드는 컷 프롬프트를 비워
      // 두고 운영자가 "프롬프트 빌드" 버튼으로 별도 진행한다.
      const profile = draft.character.visualProfile;
      const builder = manualMode ? null : await this.resolvePromptBuilder();
      const built = builder
        ? await builder.build({
            appearancePrompt: profile?.appearancePrompt ?? "",
            stylePrompt: profile?.stylePrompt ?? "",
            shots: plan.shots.map((shot) => ({ scene: shot.scene })),
          })
        : null;

      await this.prisma.$transaction(async (tx) => {
        const transitioned = await tx.postDraft.updateMany({
          where: { id: draft.id, status: "generating" },
          data: {
            caption: plan.caption,
            hashtags: plan.hashtags,
            // 기존 키(source/mode/sceneHint)는 보존하고 기획 산출물을 덧쓴다.
            // planInput은 "기획이 어떤 데이터를 받았는지" 추적용 스냅샷.
            conceptJson: {
              ...concept,
              plannerName: planner.name,
              ...(builder ? { builderName: builder.name } : {}),
              planInput: planInput as unknown as Record<string, unknown>,
              plan: plan as unknown as Record<string, unknown>,
            } as never,
            leaseExpiresAt: null,
            errorMessage: null,
          },
        });
        if (transitioned.count === 0) {
          throw new Error("draft left the generating state during planning");
        }
        for (const [index, shot] of plan.shots.entries()) {
          // 커스텀/구버전 플래너가 referenceIds를 생략해도 동작해야 한다.
          const referenceIds = shot.referenceIds ?? [];
          await tx.generationJob.create({
            data: {
              characterId: draft.characterId,
              mediaType: "image",
              // 수동 모드는 빈 프롬프트 — "프롬프트 빌드" 단계에서 채운다.
              prompt: built ? built.prompts[index] : "",
              draftId: draft.id,
              sortOrder: index,
              ...(manualMode ? { status: "draft" as const } : {}),
              // _shot: 파이프라인 메타데이터 (프로바이더 미전달) —
              // scene은 프롬프트 추적용, referenceMediaIds는 LLM이 이 샷에
              // 고른 레퍼런스로 buildRequest가 image_urls를 구성할 때 쓴다.
              paramsJson: {
                _shot: {
                  scene: shot.scene,
                  ...(referenceIds.length > 0
                    ? { referenceMediaIds: referenceIds }
                    : {}),
                },
              },
            },
          });
        }
        await tx.characterActionLog.create({
          data: {
            characterId: draft.characterId,
            actionType: "DRAFT_PLANNED",
            targetTable: "post_drafts",
            targetId: draft.id,
            reason: `draft planned via ${planner.name}${
              builder ? `, prompts via ${builder.name}` : ""
            } (${plan.shots.length} shot(s))`,
          },
        });
      });
      this.logger.log(`Draft ${draft.id} planned (${plan.shots.length} shots)`);
    } catch (error) {
      await this.handlePlanningFailure(draft, error);
    }
  }

  private async handlePlanningFailure(
    draft: PlannedDraft,
    error: unknown,
  ): Promise<void> {
    const message = errorMessage(error).slice(0, 500);
    this.logger.error(
      `Draft ${draft.id} planning failed: ${message}`,
      error instanceof Error ? error.stack : undefined,
    );
    if (draft.attemptCount >= this.config.maxAttempts) {
      const transitioned = await this.prisma.postDraft.updateMany({
        where: { id: draft.id, status: "generating" },
        data: { status: "failed", errorMessage: message, leaseExpiresAt: null },
      });
      if (transitioned.count > 0) {
        await this.recordActionLog(
          draft.characterId,
          draft.id,
          "DRAFT_FAILED",
          message,
        );
      }
      return;
    }
    await this.prisma.postDraft.updateMany({
      where: { id: draft.id, status: "generating" },
      data: { status: "planned", errorMessage: message, leaseExpiresAt: null },
    });
  }

  // ── 집계 단계 ────────────────────────────────────────────────────────────

  // 컷별 최신 잡 기준: 전부 completed → needs_review, 하나라도 failed → failed.
  private async aggregateGeneratingDrafts(): Promise<void> {
    const drafts = await this.prisma.postDraft.findMany({
      where: {
        status: { in: ["generating", "regenerating"] },
        leaseExpiresAt: null,
      },
      take: AGGREGATE_BATCH,
      select: AGGREGATE_DRAFT_SELECT,
    });

    for (const draft of drafts) {
      await this.aggregateDraft(draft);
    }
  }

  // 한 초안의 집계 — 자동 루프와 수동 트리거(aggregateDraftNow)가 공유한다.
  private async aggregateDraft(draft: {
    id: string;
    characterId: string;
    status: string;
    jobs: { sortOrder: number; status: string }[];
  }): Promise<"planned" | "failed" | "needs_review" | "pending"> {
    if (draft.jobs.length === 0) {
      // 기획 트랜잭션이 잡을 못 만든 비정상 상태 — 기획으로 되돌린다.
      await this.prisma.postDraft.updateMany({
        where: { id: draft.id, status: draft.status as never },
        data: { status: "planned" },
      });
      return "planned";
    }
    const latestPerShot = new Map<number, string>();
    for (const job of draft.jobs) {
      if (!latestPerShot.has(job.sortOrder)) {
        latestPerShot.set(job.sortOrder, job.status);
      }
    }
    const statuses = [...latestPerShot.values()];
    if (statuses.some((status) => status === "failed")) {
      const transitioned = await this.prisma.postDraft.updateMany({
        where: { id: draft.id, status: draft.status as never },
        data: {
          status: "failed",
          errorMessage: "one or more shots failed to generate",
        },
      });
      if (transitioned.count > 0) {
        await this.recordActionLog(
          draft.characterId,
          draft.id,
          "DRAFT_FAILED",
          "one or more shots failed to generate",
        );
      }
      return "failed";
    }
    if (statuses.every((status) => status === "completed")) {
      const transitioned = await this.prisma.postDraft.updateMany({
        where: { id: draft.id, status: draft.status as never },
        data: { status: "needs_review", errorMessage: null },
      });
      if (transitioned.count > 0) {
        await this.recordActionLog(
          draft.characterId,
          draft.id,
          "DRAFT_READY_FOR_REVIEW",
          "all shots generated; waiting for admin review",
        );
      }
      return "needs_review";
    }
    return "pending";
  }

  // ── 게시 단계 ────────────────────────────────────────────────────────────

  private async publishDueDrafts(): Promise<void> {
    const now = new Date();
    const candidates = await this.prisma.postDraft.findMany({
      where: {
        status: "approved",
        draftType: "post",
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
        character: { status: "active" },
      },
      orderBy: { scheduledAt: "asc" },
      // 수동 진행 초안을 JS에서 걸러내므로 배치보다 넉넉히 읽는다.
      take: PUBLISH_BATCH * 4,
      select: {
        id: true,
        characterId: true,
        contentType: true,
        caption: true,
        hashtags: true,
        conceptJson: true,
      },
    });
    // 수동 진행 초안(mode='manual')은 자동 게시하지 않는다 — "지금 게시" 버튼 전용.
    const due = candidates
      .filter(
        (draft) =>
          !(isRecord(draft.conceptJson) && draft.conceptJson.mode === "manual"),
      )
      .slice(0, PUBLISH_BATCH);

    for (const draft of due) {
      try {
        await this.publishDraft(draft);
      } catch (error) {
        this.logger.error(
          `Draft ${draft.id} publish failed: ${errorMessage(error)}`,
        );
        await this.prisma.postDraft.updateMany({
          where: { id: draft.id, status: "approved" },
          data: { errorMessage: errorMessage(error).slice(0, 500) },
        });
      }
    }
  }

  private async publishDraft(draft: {
    id: string;
    characterId: string;
    contentType: string;
    caption: string;
    hashtags: string[];
    conceptJson: unknown;
  }): Promise<void> {
    // 컷별 최신 completed 잡의 선택 출력 수집.
    const jobs = await this.prisma.generationJob.findMany({
      where: { draftId: draft.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { sortOrder: true, status: true, outputMediaId: true },
    });
    const mediaByShot = new Map<number, string>();
    for (const job of jobs) {
      if (!mediaByShot.has(job.sortOrder)) {
        if (job.status !== "completed" || !job.outputMediaId) {
          throw new Error(`shot ${job.sortOrder} has no completed output`);
        }
        mediaByShot.set(job.sortOrder, job.outputMediaId);
      }
    }
    if (mediaByShot.size === 0) {
      throw new Error("draft has no generated media to publish");
    }
    const orderedMediaIds = [...mediaByShot.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, mediaId]) => mediaId);
    const hashtags = draft.hashtags
      .map((tag) => tag.trim().replace(/^#+/, "").trim())
      .filter(Boolean);

    // 게시 마감 — 검수에서 고른 프리셋(conceptJson.finish)을 적용한 새 Media를
    // 만들어 게시물에 붙인다. 후보(원본)는 그대로 남는다. 미리보기와 동일한
    // 결정적 연산이라 검수에서 본 그대로 나간다. 프리셋 없음 = 원본 게시.
    const finish = parseFinishPreset(
      isRecord(draft.conceptJson) ? draft.conceptJson.finish : undefined,
    );
    const finishedFiles = finish
      ? await Promise.all(
          orderedMediaIds.map((mediaId) =>
            this.finishedUpload(draft.characterId, mediaId, finish),
          ),
        )
      : null;

    await this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.postDraft.updateMany({
        where: { id: draft.id, status: "approved" },
        data: { status: "published", errorMessage: null },
      });
      if (transitioned.count === 0) {
        throw new Error("draft left the approved state before publish");
      }
      const publishMediaIds: string[] = [];
      for (const [index, mediaId] of orderedMediaIds.entries()) {
        const file = finishedFiles?.[index];
        if (!file) {
          publishMediaIds.push(mediaId);
          continue;
        }
        const media = await tx.media.create({
          data: {
            mediaType: "image",
            url: file.url,
            storageKey: file.storageKey,
            contentType: file.contentType,
            byteSize: file.byteSize,
            width: file.width,
            height: file.height,
            isAiGenerated: true,
            uploadedAt: new Date(),
          },
          select: { id: true },
        });
        publishMediaIds.push(media.id);
      }
      const post = await tx.post.create({
        data: {
          characterId: draft.characterId,
          contentType: draft.contentType as never,
          content: draft.caption,
          hashtags: {
            create: hashtags.map((name) => ({
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
        where: { id: draft.id },
        data: { publishedPostId: post.id },
      });
      await tx.characterActionLog.create({
        data: {
          characterId: draft.characterId,
          actionType: "POST_CREATED",
          targetTable: "posts",
          targetId: post.id,
          reason: `auto-published from draft ${draft.id}`,
        },
      });
      // 메모리 역반영 — 확정 세계관 캐릭터가 다음 기획에서 모순을 내지 않게 한다.
      await tx.characterMemory.create({
        data: {
          characterId: draft.characterId,
          content: publishedMemoryContent(draft.caption, draft.conceptJson),
          reason: "auto: post published from draft",
        },
      });
    });
    this.logger.log(`Draft ${draft.id} published`);
  }

  // 마감본 생성·업로드 (트랜잭션 밖 — 생성 워커의 persistSuccess와 같은 패턴).
  // 이미지가 아니면 null을 돌려 원본 미디어를 그대로 게시한다.
  private async finishedUpload(
    characterId: string,
    mediaId: string,
    preset: FinishPreset,
  ): Promise<{
    url: string;
    storageKey?: string;
    contentType: string;
    byteSize: number;
    width: number;
    height: number;
  } | null> {
    const media = await this.prisma.media.findUnique({
      where: { id: mediaId },
      select: { mediaType: true, url: true, storageKey: true },
    });
    if (!media) {
      throw new Error(`publish media ${mediaId} not found`);
    }
    if (media.mediaType !== "image") {
      return null;
    }
    const source = await mediaSourceBytes(
      media,
      this.signReferenceUrl,
      this.downloadBytes,
    );
    const finished = await this.finishImage(source, preset);
    const stored = await this.store({
      bytes: finished.bytes,
      contentType: finished.contentType,
      keyPrefix: `pod/generated/character/${characterId}`,
    });
    return {
      url: stored.url,
      storageKey: stored.storageKey,
      contentType: finished.contentType,
      byteSize: finished.bytes.byteLength,
      width: finished.width,
      height: finished.height,
    };
  }

  // ── 스케줄러 ────────────────────────────────────────────────────────────

  // enabled 정책 캐릭터에 진행 중 draft가 없고 간격(7/weeklyCadence일)이 지났으면
  // 다음 KST 시간창 내 랜덤 시각으로 planned draft를 생성한다.
  private async createScheduledDrafts(): Promise<void> {
    const policies = await this.prisma.characterPostingPolicy.findMany({
      where: { enabled: true, character: { status: "active" } },
      select: {
        characterId: true,
        weeklyCadence: true,
        hourStartKst: true,
        hourEndKst: true,
      },
    });

    const now = new Date();
    for (const policy of policies) {
      const pending = await this.prisma.postDraft.findFirst({
        where: {
          characterId: policy.characterId,
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
      if (pending) {
        continue;
      }

      const cadence = Math.min(Math.max(policy.weeklyCadence, 1), 21);
      const intervalMs = (7 * 24 * 60 * 60 * 1000) / cadence;
      const lastDraft = await this.prisma.postDraft.findFirst({
        where: { characterId: policy.characterId },
        orderBy: { createdAt: "desc" },
        select: { scheduledAt: true, createdAt: true },
      });
      const lastPost = await this.prisma.post.findFirst({
        where: { characterId: policy.characterId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      const lastAt =
        lastDraft?.scheduledAt ?? lastDraft?.createdAt ?? lastPost?.createdAt;
      if (lastAt && now.getTime() < lastAt.getTime() + intervalMs) {
        continue;
      }

      const scheduledAt = this.nextSlotInWindow(
        now,
        policy.hourStartKst,
        policy.hourEndKst,
      );
      await this.prisma.postDraft.create({
        data: {
          characterId: policy.characterId,
          conceptJson: { source: "scheduler" },
          scheduledAt,
        },
      });
      await this.recordActionLog(
        policy.characterId,
        policy.characterId,
        "DRAFT_SCHEDULED",
        `scheduler queued a draft for ${scheduledAt.toISOString()}`,
      );
    }
  }

  // 오늘(KST) 시간창 내 now 이후의 랜덤 시각. 창이 지났으면 내일 창.
  private nextSlotInWindow(
    now: Date,
    hourStartKst: number,
    hourEndKst: number,
  ): Date {
    const start = clampHour(hourStartKst, 18);
    const end = clampHour(hourEndKst, 22);
    const [windowStart, windowEnd] = start < end ? [start, end] : [18, 22];

    const kstNow = new Date(now.getTime() + KST_OFFSET_MS);
    const kstDayStart = new Date(kstNow);
    kstDayStart.setUTCHours(0, 0, 0, 0);

    for (let dayOffset = 0; ; dayOffset += 1) {
      const windowOpenMs =
        kstDayStart.getTime() +
        dayOffset * 24 * 60 * 60 * 1000 +
        windowStart * 60 * 60 * 1000;
      const windowCloseMs =
        windowOpenMs + (windowEnd - windowStart) * 60 * 60 * 1000;
      const earliestMs = Math.max(windowOpenMs, kstNow.getTime());
      if (earliestMs < windowCloseMs) {
        const slotMs =
          earliestMs + this.random() * (windowCloseMs - earliestMs);
        return new Date(Math.floor(slotMs) - KST_OFFSET_MS);
      }
    }
  }

  private async recordActionLog(
    characterId: string,
    targetId: string,
    actionType: string,
    reason: string,
  ): Promise<void> {
    try {
      await this.prisma.characterActionLog.create({
        data: {
          characterId,
          actionType,
          targetTable: "post_drafts",
          targetId,
          reason,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to record action log: ${errorMessage(error)}`);
    }
  }
}

// 잡 paramsJson._shot.scene — 기획이 남긴 컷 장면 원문 (프롬프트 빌드 입력).
function shotSceneOf(paramsJson: unknown): string | null {
  if (!isRecord(paramsJson) || !isRecord(paramsJson._shot)) {
    return null;
  }
  const scene = paramsJson._shot.scene;
  return typeof scene === "string" && scene.trim() ? scene.trim() : null;
}

export function publishedMemoryContent(
  caption: string,
  conceptJson: unknown,
): string {
  const kstDate = new Date(Date.now() + KST_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
  const scenes: string[] = [];
  if (isRecord(conceptJson) && isRecord(conceptJson.plan)) {
    const shots = conceptJson.plan.shots;
    if (Array.isArray(shots)) {
      for (const shot of shots.slice(0, 2)) {
        if (isRecord(shot) && typeof shot.scene === "string") {
          scenes.push(shot.scene);
        }
      }
    }
  }
  const captionPart = caption.slice(0, 80);
  return scenes.length > 0
    ? `${kstDate} 게시: "${captionPart}" (장면: ${scenes.join(" / ")})`
    : `${kstDate} 게시: "${captionPart}"`;
}

function clampHour(value: number, fallback: number): number {
  return Number.isInteger(value) && value >= 0 && value <= 23
    ? value
    : fallback;
}
