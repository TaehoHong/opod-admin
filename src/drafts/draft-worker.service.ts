import type { DraftsService } from "./drafts.service";
import type { ReferencePostAgentRunner } from "../post-production/reference-post-agent.runner";
import { BadRequestException } from "@nestjs/common";
import {
  assertNaturalPublishable,
  isNaturalAgent,
} from "../post-production/natural-post-agent";
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { JsonValue } from "../shared/utils/json";
import { AppConfig } from "../core/config/app-config";
import { ContentPlanner } from "../post-production/content-planner";
import { DraftWorkerRepository } from "./draft-worker.repository";
import {
  applyFinishWithMeta,
  downloadMediaBytes,
  FinishedImage,
  FinishPreset,
  mediaSourceBytes,
  parseFinishPreset,
} from "../media/film-finish";
import {
  GeneratedMediaStore,
  localGeneratedMediaStore,
  ReferenceUrlSigner,
} from "../media/generated-media-store";
import { ImagePromptBuilder } from "../post-production/image-prompt-builder";
import { errorMessage, isRecord } from "../shared/utils/value-utils";
import {
  isPostPipelineV3,
  isPostPipelineV4,
} from "../post-production/post-pipeline-v3";

export type DraftWorkerConfig = AppConfig["draftWorker"];

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const AGGREGATE_BATCH = 20;
const PUBLISH_BATCH = 5;
const PUBLISH_LEASE_SECONDS = 15 * 60;
const PUBLISH_RETRY_BACKOFF_MS = 5 * 60 * 1000;

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
    private readonly repository: DraftWorkerRepository,
    // 기획 시마다 재해석한다 — admin 설정(UI)에서 LLM URL/키/모델을 바꾸면
    // 프로세스 재시작 없이 다음 기획부터 반영된다.
    private readonly resolvePlanner: () => Promise<ContentPlanner>,
    // 프롬프트 빌더도 실행 시마다 재해석 (플래너와 동일한 이유).
    private readonly resolvePromptBuilder: () => Promise<ImagePromptBuilder>,
    // 자동 루프 on/off도 tick마다 재해석 — 설정 화면 토글이 프로세스 재시작
    // 없이 반영돼야 한다. 생성 워커와 같은 토글을 공유한다.
    private readonly resolveEnabled: () => Promise<boolean>,
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
    private readonly resolvePipelineV3Enabled: () => Promise<boolean> = () =>
      Promise.resolve(false),
    private readonly runV3Stage:
      | ((
          draftId: string,
          options?: { operatorNote?: string },
        ) => Promise<void>)
      | null = null,
    private readonly resolveScheduledAgentConcept: () => Promise<
      JsonValue | undefined
    > = async () => undefined,
    private readonly referenceLifecycle?: {
      drafts: DraftsService;
      runner: ReferencePostAgentRunner;
      assertCharacterActive?: (characterId: string) => Promise<void>;
      runQueuedJob?: (jobId: string) => Promise<unknown>;
    },
  ) {}

  onModuleInit(): void {
    // 루프는 항상 띄우고 켜짐 여부는 tick이 판단한다.
    this.logger.log(
      `Draft worker loop started (scheduler=${this.config.schedulerEnabled})`,
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
    // 꺼져 있으면 lease 회수도 하지 않는다 — 자동 루프가 아무 일도 하지 않는
    // 상태가 "꺼짐"의 정의다. 만료 lease는 다시 켤 때 회수된다.
    if (!(await this.resolveEnabled())) {
      return;
    }
    await this.referenceLifecycle?.drafts.recoverExpiredReferenceLeases();
    await this.sweepExpiredPlanLeases();
    if (this.config.schedulerEnabled) {
      await this.createScheduledDrafts();
    }
    await this.planClaimedReferenceDrafts();
    await this.planClaimedV3Drafts();
    await this.aggregateReferenceDrafts();
    await this.aggregateGeneratingDrafts();
    await this.publishDueDrafts();
  }

  // ── 수동 실행 (admin 버튼) ──────────────────────────────────────────────
  // 자동 파이프라인과 같은 코드를 타되 타이밍만 운영자가 정한다.
  // 자동 루프 토글과 무관하게 동작한다 (토글은 자동 루프만 제어).

  // 지정 draft를 즉시 기획한다. planned가 아니거나 캐릭터가 inactive면 false.
  // 기획 실패는 자동 경로와 동일하게 planned 복귀/failed 전이로 흡수된다.
  async planDraftNow(
    draftId: string,
    options?: {
      operatorNote?: string;
      expectedStage?: string;
      expectedRevision?: string;
      expectedPromptRevision?: number;
    },
  ): Promise<{ planned: boolean }> {
    const reference = this.referenceLifecycle;
    if (reference && (await reference.drafts.isReferenceDraft(draftId))) {
      if (!options?.expectedStage || !options.expectedRevision)
        throw new BadRequestException(
          "Reference stage and revision are required",
        );
      const claimed = await reference.drafts.claimReferenceDraftNow(
        draftId,
        this.config.planLeaseSeconds,
        options,
      );
      if (!claimed) return { planned: false };
      await this.runReferenceStage(draftId);
      if (options.expectedStage === "generation") {
        const { draft, jobs } =
          await reference.drafts.getReferenceDraftState(draftId);
        const concept = isRecord(draft.conceptJson) ? draft.conceptJson : {};
        const build = isRecord(concept.generationBuild)
          ? concept.generationBuild
          : {};
        const ids = Array.isArray(build.jobIds) ? build.jobIds : [];
        for (const job of jobs) {
          if (job.status !== "queued" || !ids.includes(job.id)) continue;
          await reference.drafts.assertGenerationJobMutable(draftId, job.id);
          if (!reference.runQueuedJob)
            throw new Error("reference_generation_worker_required");
          await reference.runQueuedJob(job.id);
        }
      }
      return { planned: true };
    }
    if (this.runV3Stage) {
      const claimedV3 = await this.repository.claimV3DraftNow(
        draftId,
        this.config.planLeaseSeconds,
      );
      if (claimedV3) {
        await this.runV3Stage(draftId, options);
        return { planned: true };
      }
    }
    return { planned: false };
  }

  // 지정 approved draft를 scheduledAt과 무관하게 즉시 게시한다.
  async publishDraftNow(
    draftId: string,
  ): Promise<{ published: boolean; reason?: string }> {
    const reference = this.referenceLifecycle;
    const isReference =
      !!reference && (await reference.drafts.isReferenceDraft(draftId));
    const draft = isReference
      ? await reference!.drafts.claimReferencePublication(
          draftId,
          this.config.planLeaseSeconds,
        )
      : await this.repository.findApprovedDraft(
          draftId,
          this.config.planLeaseSeconds,
        );
    if (!draft) {
      return { published: false };
    }
    try {
      await this.publishDraft({ ...draft, hashtags: draft.hashtags ?? [] });
      return { published: true };
    } catch (error) {
      const message = errorMessage(error).slice(0, 500);
      if (isReference && draft.leaseExpiresAt) {
        await reference!.drafts.releaseReferencePublication(
          draftId,
          draft.leaseExpiresAt,
          message,
        );
      } else {
        await this.repository.recordPublishError(
          draftId,
          message,
          draft.leaseExpiresAt,
        );
      }
      return { published: false, reason: message };
    }
  }

  // 수동 집계 — 생성 결과를 지금 집계해 검수(needs_review)로 전환한다.
  // 자동 루프(aggregateGeneratingDrafts)와 동일한 연산의 스텝 실행 모드라
  // 워커 루프가 죽어 있어도 검수 단계로 진행할 수 있다.
  async aggregateDraftNow(
    draftId: string,
  ): Promise<{ aggregated: boolean; reason?: string }> {
    if (
      this.referenceLifecycle &&
      (await this.referenceLifecycle.drafts.isReferenceDraft(draftId))
    ) {
      const waiting =
        await this.referenceLifecycle.drafts.listReferenceGenerationWaiting(
          1,
          draftId,
        );
      return {
        aggregated:
          waiting.length > 0 &&
          (await this.referenceLifecycle.runner.aggregateGeneration(draftId)),
      };
    }
    const draft = await this.repository.findAggregateDraft(draftId);
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
    void draftId;
    return { built: false, reason: "기존 Agent는 보관되었습니다." };
  }

  // ── 기획 단계 ────────────────────────────────────────────────────────────

  private async runReferenceStage(draftId: string): Promise<void> {
    const reference = this.referenceLifecycle!;
    try {
      if (!reference.assertCharacterActive)
        throw new Error("reference_character_service_required");
      const { draft } = await reference.drafts.getReferenceDraftState(draftId);
      await reference.assertCharacterActive(draft.characterId);
      await reference.runner.runCurrentStage(draftId);
    } catch (error) {
      await reference.drafts.failReferenceStage(draftId, errorMessage(error));
    }
  }

  private async planClaimedReferenceDrafts(): Promise<void> {
    if (!this.referenceLifecycle) return;
    for (;;) {
      const draftId = await this.referenceLifecycle.drafts.claimReferenceDraft(
        this.config.planLeaseSeconds,
      );
      if (!draftId) return;
      await this.runReferenceStage(draftId);
    }
  }

  private async aggregateReferenceDrafts(): Promise<void> {
    if (!this.referenceLifecycle) return;
    for (const draft of await this.referenceLifecycle.drafts.listReferenceGenerationWaiting(
      AGGREGATE_BATCH,
    ))
      await this.referenceLifecycle.runner.aggregateGeneration(draft.id);
  }

  private async sweepExpiredPlanLeases(): Promise<void> {
    const v3 = await this.repository.sweepExpiredV3Leases(
      this.config.maxAttempts,
    );
    if (v3.requeued > 0 || v3.failed > 0) {
      this.logger.warn(
        `Recovered V3 leases (requeued=${v3.requeued}, failed=${v3.failed})`,
      );
    }
  }

  private async planClaimedV3Drafts(): Promise<void> {
    if (!this.runV3Stage) return;
    for (;;) {
      const draftId = await this.repository.claimV3Draft(
        this.config.planLeaseSeconds,
      );
      if (!draftId) return;
      await this.runV3Stage(draftId);
    }
  }

  // ── 집계 단계 ────────────────────────────────────────────────────────────

  // 컷별 최신 잡 기준: 전부 completed → needs_review, 하나라도 failed → failed.
  private async aggregateGeneratingDrafts(): Promise<void> {
    const drafts = await this.repository.findGeneratingDrafts(AGGREGATE_BATCH);

    for (const draft of drafts) {
      await this.aggregateDraft(draft);
    }
  }

  // 한 초안의 집계 — 자동 루프와 수동 트리거(aggregateDraftNow)가 공유한다.
  private async aggregateDraft(draft: {
    id: string;
    characterId: string;
    status: string;
    conceptJson: unknown;
    jobs: { sortOrder: number; status: string }[];
  }): Promise<"planned" | "failed" | "needs_review" | "caption" | "pending"> {
    if (!isNaturalAgent(draft.conceptJson)) return "pending";
    if (draft.jobs.length === 0) {
      // 기획 트랜잭션이 잡을 못 만든 비정상 상태 — 기획으로 되돌린다.
      await this.repository.requeueDraftWithoutJobs(draft.id, draft.status);
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
      const transitioned = await this.repository.failGeneratedDraft(
        draft.id,
        draft.status,
        "one or more shots failed to generate",
      );
      if (transitioned) {
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
      // V4: 검수 없음 — 컷이 다 나오면 ⑥ 캡션 단계(planned+pending)로 간다.
      if (isPostPipelineV4(draft.conceptJson)) {
        const concept = draft.conceptJson as Record<string, unknown>;
        const pipeline = isRecord(concept.pipeline) ? concept.pipeline : {};
        const transitioned = await this.repository.markDraftCaptionPending(
          draft.id,
          draft.status,
          {
            ...concept,
            pipeline: {
              ...pipeline,
              stage: "caption",
              state: "pending",
              reasonCodes: [],
            },
          } as JsonValue,
        );
        if (transitioned) {
          await this.recordActionLog(
            draft.characterId,
            draft.id,
            "DRAFT_V3_IMAGES_READY",
            "all shots generated; caption stage pending",
          );
        }
        return "caption";
      }
      const transitioned = await this.repository.markDraftNeedsReview(
        draft.id,
        draft.status,
      );
      if (transitioned) {
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
    if (this.referenceLifecycle) {
      const { drafts } = this.referenceLifecycle;
      const ids = await drafts.listReferencePublicationsDue(
        now,
        PUBLISH_BATCH,
        new Date(now.getTime() - PUBLISH_RETRY_BACKOFF_MS),
      );
      for (const { id } of ids) {
        let lease: Date | null = null;
        try {
          const draft = await drafts.claimReferencePublication(
            id,
            PUBLISH_LEASE_SECONDS,
          );
          if (!draft) continue;
          lease = draft.leaseExpiresAt;
          await this.publishDraft({ ...draft, hashtags: draft.hashtags ?? [] });
        } catch (error) {
          this.logger.error(
            `Reference draft ${id} publish failed: ${errorMessage(error)}`,
          );
          if (lease)
            await drafts.releaseReferencePublication(
              id,
              lease,
              errorMessage(error),
            );
        }
      }
    }
    const candidates = await this.repository.findDueDrafts(
      now,
      PUBLISH_BATCH,
      PUBLISH_LEASE_SECONDS,
      new Date(now.getTime() - PUBLISH_RETRY_BACKOFF_MS),
    );
    // repository가 DB claim 전에 수동 초안을 제외한다. 이 필터는 잘못 구성된 구
    // 데이터가 자동 게시되는 것을 막는 마지막 방어선이다.
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
        await this.repository.recordPublishFailure({
          draftId: draft.id,
          characterId: draft.characterId,
          message: errorMessage(error).slice(0, 500),
          leaseExpiresAt: draft.leaseExpiresAt,
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
    leaseExpiresAt: Date | null;
  }): Promise<void> {
    // V4는 ⑥ 캡션 단계가 끝나야 여기 오지만, 운영자가 컬럼을 비울 수는 없어도
    // 경로가 늘어날 수 있으니 안전판을 둔다 — 본문 없는 게시물은 되돌릴 수 없다.
    if (!draft.caption.trim()) {
      throw new Error("caption_missing: draft has no caption to publish");
    }
    // 컷별 최신 completed 잡의 선택 출력 수집.
    const referenceConcept =
      isRecord(draft.conceptJson) &&
      draft.conceptJson.postGenerationAgent === "reference-v1"
        ? draft.conceptJson
        : null;
    if (referenceConcept) {
      if (!this.referenceLifecycle?.assertCharacterActive)
        throw new Error("reference_character_service_required");
      await this.referenceLifecycle.assertCharacterActive(draft.characterId);
    }
    const allJobs = referenceConcept
      ? (
          await this.referenceLifecycle!.drafts.getReferenceDraftState(draft.id)
        ).jobs.map((job) => ({
          ...job,
          outputMediaId:
            job.outputs.find((output) => output.selected)?.mediaId ?? null,
        }))
      : await this.repository.findPublishJobs(draft.id);
    const build =
      referenceConcept && isRecord(referenceConcept.generationBuild)
        ? referenceConcept.generationBuild
        : null;
    const jobIds = build && Array.isArray(build.jobIds) ? build.jobIds : [];
    const jobs = referenceConcept
      ? allJobs.filter((job) => jobIds.includes(job.id))
      : allJobs;
    if (referenceConcept && (!jobIds.length || jobs.length !== jobIds.length))
      throw new Error("reference_generation_incomplete");
    const mediaByShot = new Map<
      number,
      { mediaId: string; filterPreset: string | null }
    >();
    for (const job of jobs) {
      if (!mediaByShot.has(job.sortOrder)) {
        if (job.status !== "completed" || !job.outputMediaId) {
          throw new Error(`shot ${job.sortOrder} has no completed output`);
        }
        const output = job.outputs?.find(
          (candidate) => candidate.mediaId === job.outputMediaId,
        );
        mediaByShot.set(job.sortOrder, {
          mediaId: job.outputMediaId,
          filterPreset: output?.filterPreset ?? null,
        });
      }
    }
    if (mediaByShot.size === 0) {
      throw new Error("draft has no generated media to publish");
    }
    if (isNaturalAgent(draft.conceptJson)) {
      const latest = [...mediaByShot.keys()].map((order) =>
        jobs.find((job) => job.sortOrder === order)!,
      );
      assertNaturalPublishable(
        draft.conceptJson,
        latest.map((job) => ({
          sortOrder: job.sortOrder,
          jobId: job.id,
          mediaId: job.outputMediaId!,
        })),
        this.config.naturalPhotoReviewEnabled !== false,
      );
    }
    const orderedMedia = [...mediaByShot.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, media]) => media);
    const hashtags = draft.hashtags
      .map((tag) => tag.trim().replace(/^#+/, "").trim())
      .filter(Boolean);

    // 선택 이미지마다 저장된 필터를 적용한 새 Media를 게시물에 붙인다.
    // 후보 원본은 유지하고, 구버전 후보(null)는 초안 전체 finish를 상속한다.
    const legacyFinish = parseFinishPreset(
      isRecord(draft.conceptJson) ? draft.conceptJson.finish : undefined,
    );
    const finishedFiles = await Promise.all(
      orderedMedia.map(({ mediaId, filterPreset }) => {
        const finish =
          filterPreset === null
            ? legacyFinish
            : parseFinishPreset(filterPreset);
        return finish
          ? this.finishedUpload(draft.characterId, mediaId, finish)
          : null;
      }),
    );

    await this.repository.persistPublishedPost({
      draftId: draft.id,
      characterId: draft.characterId,
      contentType: draft.contentType,
      caption: draft.caption,
      hashtags,
      leaseExpiresAt: draft.leaseExpiresAt,
      // 메모리 역반영 — 확정 세계관 캐릭터가 다음 기획에서 모순을 내지 않게 한다.
      ...(referenceConcept
        ? { referencePublication: { expectedConceptJson: referenceConcept } }
        : isPostPipelineV3(draft.conceptJson)
          ? {
              memories: selectedPublishedMemories(draft.conceptJson),
            }
          : {
              memoryContent: publishedMemoryContent(
                draft.caption,
                draft.conceptJson,
              ),
            }),
      media: orderedMedia.map(({ mediaId }, index) => ({
        originalMediaId: mediaId,
        finishedFile: finishedFiles[index],
      })),
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
    const media = await this.repository.findMediaForFinish(mediaId);
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
    const policies = await this.repository.findEnabledPostingPolicies();
    const pipelineV3Enabled = await this.resolvePipelineV3Enabled();
    const scheduledConcept = await this.resolveScheduledAgentConcept();
    if (!isNaturalAgent(scheduledConcept)) return;

    const now = new Date();
    for (const policy of policies) {
      const pending = await this.repository.findPendingDraft(
        policy.characterId,
      );
      if (pending) {
        continue;
      }

      const cadence = Math.min(Math.max(policy.weeklyCadence, 1), 21);
      const intervalMs = (7 * 24 * 60 * 60 * 1000) / cadence;
      const lastDraft = await this.repository.findLastDraft(policy.characterId);
      const lastPost = await this.repository.findLastPost(policy.characterId);
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
      const created = await this.repository.createScheduledDraft(
        policy.characterId,
        scheduledAt,
        pipelineV3Enabled,
        ...(scheduledConcept ? [scheduledConcept] : []),
      );
      if (!created) continue;
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
      await this.repository.recordActionLog({
        characterId,
        actionType,
        targetId,
        reason,
      });
    } catch (error) {
      this.logger.error(`Failed to record action log: ${errorMessage(error)}`);
    }
  }
}

// 잡 paramsJson._shot — 기획이 남긴 구조화 컷 계약 (프롬프트 빌드 입력).
// 구버전 수동 초안은 scene만 있으므로 기존 인물 중심 동작을 보수적으로 유지한다.
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

export function selectedPublishedMemories(
  conceptJson: unknown,
): { type: string; content: string; reason: string }[] {
  // v3·v4 공통 — 버전을 직접 비교하면 v4 초안이 게시돼도 기억이 하나도
  // 저장되지 않는다(⑧ 단계가 조용히 빈손).
  if (!isRecord(conceptJson) || !isPostPipelineV3(conceptJson)) return [];
  if (isNaturalAgent(conceptJson) && conceptJson.mode !== "manual") return [];
  const postPlanning = isRecord(conceptJson.postPlanning)
    ? conceptJson.postPlanning
    : {};
  const currentHash =
    typeof postPlanning.hash === "string" ? postPlanning.hash : null;
  if (!currentHash || !Array.isArray(conceptJson.memoryCandidates)) return [];
  const seen = new Set<string>();
  const result: { type: string; content: string; reason: string }[] = [];
  for (const candidate of conceptJson.memoryCandidates) {
    if (
      !isRecord(candidate) ||
      candidate.selected !== true ||
      (isNaturalAgent(conceptJson) && candidate.selectedByOperator !== true) ||
      candidate.sourcePostPlanHash !== currentHash ||
      typeof candidate.type !== "string" ||
      typeof candidate.content !== "string" ||
      !candidate.content.trim()
    )
      continue;
    const type = candidate.type.trim();
    const content = candidate.content.trim();
    const dedupeKey = `${type}\u0000${content}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push({
      type,
      content,
      reason: `${String(conceptJson.pipelineVersion)}: selected candidate from ${currentHash}`,
    });
  }
  return result;
}

function clampHour(value: number, fallback: number): number {
  return Number.isInteger(value) && value >= 0 && value <= 23
    ? value
    : fallback;
}
