import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  decodeCursor,
  Page,
  PageInput,
  pageFromRows,
} from "../../domain/database/page";
import { parseFinishPreset } from "../../worker/film-finish";
import type { ImageGenerationProgress } from "../../worker/image-generation.provider";
import { GenerationSettingsService } from "../../domain/settings/generation-settings.service";
import {
  createPostPipelineV3Concept,
  isPostPipelineV3,
  isPostPipelineV4,
} from "../../worker/post-pipeline-v3";
import { DraftJobRow, DraftRow, DraftsRepository } from "./drafts.repository";

type DraftStatus =
  | "planned"
  | "generating"
  | "needs_review"
  | "regenerating"
  | "approved"
  | "rejected"
  | "published"
  | "failed";

const DRAFT_STATUSES: DraftStatus[] = [
  "planned",
  "generating",
  "needs_review",
  "regenerating",
  "approved",
  "rejected",
  "published",
  "failed",
];

// 검수에서 캡션/일정을 고칠 수 있는 상태. planned/generating은 플래너가 덮어쓴다.
const EDITABLE_STATUSES: DraftStatus[] = ["needs_review", "approved"];
// 검수 편집과 정반대 구간이다. 워커 claim이 planned → generating을 원자적으로
// 옮기므로, planned 조건부 갱신이면 실행 중인 단계와 충돌할 수 없다.
const OPERATOR_REQUEST_EDITABLE_STATUSES: DraftStatus[] = ["planned", "failed"];
const OPERATOR_REQUEST_MAX_LENGTH = 2000;
const FILTER_EDITABLE_STATUSES: DraftStatus[] = [
  "generating",
  "regenerating",
  "needs_review",
  "approved",
  "failed",
];

const CAPTION_MAX_LENGTH = 2000;
const HASHTAG_MAX = 5;

type DraftShotOutput = {
  mediaId: string;
  url: string;
  candidateIndex: number;
  selected: boolean;
  filterPreset: string | null;
};

type DraftReference = {
  mediaId: string;
  url?: string;
  available: boolean;
};

type ShotRoute = "t2i" | "edit";

type GenerationTrace = {
  captureSetup?: string;
  characterVisible?: boolean;
  planned: {
    route?: ShotRoute;
    targetModelId?: string;
    references: DraftReference[];
  };
  execution?: {
    route: ShotRoute;
    provider?: string;
    references: DraftReference[];
  };
  matchesPlan?: boolean;
};

type DraftShot = {
  sortOrder: number;
  jobId: string;
  status: string;
  prompt: string;
  // 기획이 만든 장면 원문 (paramsJson._shot.scene) — 프롬프트 추적용.
  scene?: string;
  // 기획 LLM이 이 샷에 고른 레퍼런스 (URL은 표시용으로 해석).
  references?: { mediaId: string; url: string }[];
  generationTrace?: GenerationTrace;
  candidateCount?: number;
  provider?: string;
  providerProgress?: ImageGenerationProgress;
  costUsd?: string;
  errorMessage?: string;
  // 실행이 실제로 돌았는지 판단하는 가장 싼 신호. 재시도 횟수와 소요 시간이
  // 없으면 "queued 그대로인지 한참 돌다 끝난 건지"를 구분할 수 없다.
  attemptCount: number;
  startedAt: string;
  settledAt?: string;
  outputs: DraftShotOutput[];
};

type AdminDraft = {
  id: string;
  characterId: string;
  locationId?: string;
  draftType: string;
  contentType: string;
  caption: string;
  hashtags: string[];
  status: DraftStatus;
  attemptCount: number;
  errorMessage?: string;
  scheduledAt?: string;
  publishedPostId?: string;
  conceptJson?: unknown;
  shots?: DraftShot[];
  createdAt: string;
  updatedAt: string;
};

type ShotMeta = {
  present: boolean;
  scene?: string;
  captureSetup?: string;
  characterVisible?: boolean;
  referenceMediaIds?: string[];
  targetModelId?: string;
  execution?: {
    route: ShotRoute;
    referenceMediaIds: string[];
  };
};

function stringIds(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : undefined;
}

function providerProgressFromParams(
  paramsJson: unknown,
): ImageGenerationProgress | undefined {
  if (
    paramsJson == null ||
    typeof paramsJson !== "object" ||
    Array.isArray(paramsJson)
  ) {
    return undefined;
  }
  const value = (paramsJson as Record<string, unknown>)._providerProgress;
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const progress = value as Record<string, unknown>;
  const status = progress.status;
  if (status !== "queued" && status !== "running" && status !== "cancelling") {
    return undefined;
  }
  const phase = progress.phase;
  const validPhase =
    phase === "preparing" ||
    phase === "generating" ||
    phase === "quality_check" ||
    phase === "finalizing"
      ? phase
      : undefined;
  const amount =
    typeof progress.progress === "number" &&
    Number.isFinite(progress.progress) &&
    progress.progress >= 0 &&
    progress.progress <= 1
      ? progress.progress
      : undefined;
  return {
    status,
    ...(validPhase ? { phase: validPhase } : {}),
    ...(typeof progress.stage === "string" || progress.stage === null
      ? { stage: progress.stage }
      : {}),
    ...(amount !== undefined ? { progress: amount } : {}),
    ...(typeof progress.updatedAt === "string"
      ? { updatedAt: progress.updatedAt }
      : {}),
  };
}

// paramsJson._shot — 기획과 provider 제출 시점의 실행 메타데이터.
function shotMeta(paramsJson: unknown): ShotMeta {
  if (typeof paramsJson !== "object" || paramsJson === null) {
    return { present: false };
  }
  const shot = (paramsJson as Record<string, unknown>)._shot;
  if (typeof shot !== "object" || shot === null) {
    return { present: false };
  }
  const record = shot as Record<string, unknown>;
  const scene =
    typeof record.scene === "string" && record.scene ? record.scene : undefined;
  const captureSetup =
    typeof record.captureSetup === "string" && record.captureSetup
      ? record.captureSetup
      : undefined;
  const characterVisible =
    typeof record.characterVisible === "boolean"
      ? record.characterVisible
      : undefined;
  const referenceMediaIds = stringIds(record.referenceMediaIds);
  const targetModelId =
    typeof record.targetModelId === "string" && record.targetModelId
      ? record.targetModelId
      : undefined;
  const executionRecord =
    typeof record.execution === "object" && record.execution !== null
      ? (record.execution as Record<string, unknown>)
      : undefined;
  const executionRoute =
    executionRecord?.route === "t2i" || executionRecord?.route === "edit"
      ? executionRecord.route
      : undefined;
  const executionIds = stringIds(executionRecord?.referenceMediaIds);

  return {
    present: true,
    ...(scene ? { scene } : {}),
    ...(captureSetup ? { captureSetup } : {}),
    ...(characterVisible !== undefined ? { characterVisible } : {}),
    ...(referenceMediaIds !== undefined ? { referenceMediaIds } : {}),
    ...(targetModelId ? { targetModelId } : {}),
    ...(executionRoute
      ? {
          execution: {
            route: executionRoute,
            referenceMediaIds: executionIds ?? [],
          },
        }
      : {}),
  };
}

function referencesFor(
  mediaIds: string[],
  urls: Map<string, string>,
): DraftReference[] {
  return mediaIds.map((mediaId) => {
    const url = urls.get(mediaId);
    return {
      mediaId,
      ...(url ? { url } : {}),
      available: url !== undefined,
    };
  });
}

function sameIds(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((mediaId, index) => mediaId === right[index])
  );
}

function generationTrace(
  meta: ShotMeta,
  provider: string | null,
  urls: Map<string, string>,
): GenerationTrace | undefined {
  if (!meta.present) {
    return undefined;
  }

  const plannedRoute =
    meta.referenceMediaIds === undefined
      ? undefined
      : meta.referenceMediaIds.length > 0
        ? "edit"
        : "t2i";
  const comparisons: boolean[] = [];
  if (meta.execution) {
    if (plannedRoute) {
      comparisons.push(plannedRoute === meta.execution.route);
    }
    if (meta.referenceMediaIds) {
      comparisons.push(
        sameIds(meta.referenceMediaIds, meta.execution.referenceMediaIds),
      );
    }
    if (meta.targetModelId && provider) {
      comparisons.push(provider === `fal:${meta.targetModelId}`);
    }
  }

  return {
    ...(meta.captureSetup ? { captureSetup: meta.captureSetup } : {}),
    ...(meta.characterVisible !== undefined
      ? { characterVisible: meta.characterVisible }
      : {}),
    planned: {
      ...(plannedRoute ? { route: plannedRoute } : {}),
      ...(meta.targetModelId ? { targetModelId: meta.targetModelId } : {}),
      references: referencesFor(meta.referenceMediaIds ?? [], urls),
    },
    ...(meta.execution
      ? {
          execution: {
            route: meta.execution.route,
            ...(provider ? { provider } : {}),
            references: referencesFor(meta.execution.referenceMediaIds, urls),
          },
          ...(comparisons.length > 0
            ? { matchesPlan: comparisons.every(Boolean) }
            : {}),
        }
      : {}),
  };
}

@Injectable()
export class DraftsService {
  constructor(
    private readonly repository: DraftsRepository,
    private readonly settings: GenerationSettingsService,
  ) {}

  async listDrafts(
    input: { status?: string; characterId?: string } & PageInput,
  ): Promise<Page<AdminDraft>> {
    const status = this.parseOptionalStatus(input.status);
    const characterId = input.characterId?.trim();
    const filter = {
      ...(status ? { status } : {}),
      ...(characterId ? { characterId } : {}),
    };
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.repository.cursorMatchesFilter(cursorId, filter))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const drafts = await this.repository.findMany({
      ...filter,
      take: input.limit + 1,
      ...(cursorId ? { cursorId } : {}),
    });
    return pageFromRows(
      drafts.map((draft) => this.toDraft(draft)),
      input.limit,
    );
  }

  async getDraft(draftId: string): Promise<AdminDraft> {
    const draft = await this.repository.findDraft(draftId);
    if (!draft) {
      throw new BadRequestException("Draft not found");
    }
    const jobs = await this.repository.findDraftJobs(draftId);

    // 컷별 최신 잡만 노출한다 (재생성 이력은 최신이 대체).
    const latestPerShot = new Map<number, DraftJobRow>();
    for (const job of jobs) {
      if (!latestPerShot.has(job.sortOrder)) {
        latestPerShot.set(job.sortOrder, job);
      }
    }
    // 샷별 선별 레퍼런스의 표시용 URL을 한 번에 해석한다.
    const latestJobs = [...latestPerShot.values()];
    const referenceIds = [
      ...new Set(
        latestJobs.flatMap((job) => {
          const meta = shotMeta(job.paramsJson);
          return [
            ...(meta.referenceMediaIds ?? []),
            ...(meta.execution?.referenceMediaIds ?? []),
          ];
        }),
      ),
    ];
    const referenceUrls = new Map(
      referenceIds.length > 0
        ? (await this.repository.findMediaUrls(referenceIds)).map(
            (media) => [media.id, media.url] as const,
          )
        : [],
    );

    const shots = [...latestPerShot.entries()]
      .sort(([a], [b]) => a - b)
      .map(([sortOrder, job]) => {
        const meta = shotMeta(job.paramsJson);
        const providerProgress =
          job.status === "running"
            ? providerProgressFromParams(job.paramsJson)
            : undefined;
        const references = (meta.referenceMediaIds ?? [])
          .filter((mediaId) => referenceUrls.has(mediaId))
          .map((mediaId) => ({
            mediaId,
            url: referenceUrls.get(mediaId) as string,
          }));
        const trace = generationTrace(meta, job.provider, referenceUrls);
        return {
          sortOrder,
          jobId: job.id,
          status: job.status,
          prompt: job.prompt,
          ...(meta.scene ? { scene: meta.scene } : {}),
          ...(references.length > 0 ? { references } : {}),
          ...(trace ? { generationTrace: trace } : {}),
          ...(job.candidateCount != null
            ? { candidateCount: job.candidateCount }
            : {}),
          ...(job.provider ? { provider: job.provider } : {}),
          ...(providerProgress ? { providerProgress } : {}),
          ...(job.costUsd != null ? { costUsd: job.costUsd.toString() } : {}),
          ...(job.errorMessage ? { errorMessage: job.errorMessage } : {}),
          attemptCount: job.attemptCount,
          startedAt: job.createdAt.toISOString(),
          // 아직 끝나지 않은 잡의 updatedAt은 "지금까지"일 뿐이라 소요 시간으로
          // 읽으면 안 된다. 종료된 잡에만 내린다.
          ...(job.status === "completed" || job.status === "failed"
            ? { settledAt: job.updatedAt.toISOString() }
            : {}),
          outputs: job.outputs.map((output) => ({
            mediaId: output.mediaId,
            url: output.media.url,
            candidateIndex: output.candidateIndex,
            selected: output.selected,
            filterPreset: output.filterPreset,
          })),
        };
      });

    return { ...this.toDraft(draft), shots };
  }

  // 운영자의 게시물 만들기 진입점은 항상 수동이다. 자동 draft는 스케줄러가
  // 별도로 만들며, 같은 상태 머신을 쓰되 conceptJson.source만 다르다.
  async createDraft(input: {
    characterId: string;
    sceneHint?: string;
    scheduledAt?: string;
    contentType?: string;
  }): Promise<AdminDraft> {
    if (!(await this.repository.characterExists(input.characterId))) {
      throw new BadRequestException("Character not found");
    }
    const contentType = input.contentType?.trim() || "feed";
    if (contentType !== "feed" && contentType !== "reel") {
      throw new BadRequestException("Draft content type must be feed or reel");
    }
    const scheduledAt = this.parseOptionalDate(input.scheduledAt);
    const sceneHint = input.sceneHint?.trim();
    if (sceneHint && sceneHint.length > OPERATOR_REQUEST_MAX_LENGTH) {
      throw new BadRequestException(
        `Scene hint must be at most ${OPERATOR_REQUEST_MAX_LENGTH} characters`,
      );
    }
    const pipelineV3 = await this.settings.resolvePipelineV3();

    const draft = await this.repository.createDraft({
      characterId: input.characterId,
      contentType,
      conceptJson: pipelineV3.enabled
        ? createPostPipelineV3Concept({
            source: "manual",
            mode: "manual",
            ...(sceneHint ? { operatorRequest: sceneHint } : {}),
          })
        : {
            source: "manual",
            mode: "manual",
            ...(sceneHint ? { sceneHint } : {}),
          },
      ...(scheduledAt ? { scheduledAt } : {}),
    });
    await this.recordActionLog(
      input.characterId,
      draft.id,
      "DRAFT_CREATED",
      `manual draft created${sceneHint ? ` (hint: ${sceneHint.slice(0, 100)})` : ""}`,
    );
    return this.toDraft(draft);
  }

  async updatePlan(input: {
    draftId: string;
    caption: string;
    hashtags: string[];
    shots: { sortOrder: number; scene: string }[];
  }): Promise<AdminDraft> {
    const draft = await this.repository.findPlanEditDraft(input.draftId);
    if (!draft) throw new BadRequestException("Draft not found");
    const concept = this.record(draft.conceptJson);
    if (
      concept.mode !== "manual" ||
      draft.status !== "generating" ||
      draft.leaseExpiresAt
    ) {
      throw new BadRequestException(
        "Only paused manual drafts can edit the content plan",
      );
    }
    const plan = this.record(concept.plan);
    const planShots = Array.isArray(plan.shots) ? plan.shots : [];
    const latestJobs = new Map<number, (typeof draft.jobs)[number]>();
    for (const job of draft.jobs) {
      if (!latestJobs.has(job.sortOrder)) latestJobs.set(job.sortOrder, job);
    }
    if (
      input.shots.length !== planShots.length ||
      input.shots.some((shot) => !latestJobs.has(shot.sortOrder))
    ) {
      throw new BadRequestException(
        "Plan shots must match the current draft shots",
      );
    }
    const caption = input.caption.trim();
    if (!caption || caption.length > CAPTION_MAX_LENGTH) {
      throw new BadRequestException(
        `Draft caption must be between 1 and ${CAPTION_MAX_LENGTH} characters`,
      );
    }
    const scenes = new Map(
      input.shots.map((shot) => [shot.sortOrder, shot.scene.trim()]),
    );
    if ([...scenes.values()].some((scene) => !scene)) {
      throw new BadRequestException("Plan shot scene is required");
    }
    const updatedPlanShots = planShots.map((value, index) => {
      const shot = this.record(value);
      const sortOrder =
        typeof shot.sortOrder === "number" ? shot.sortOrder : index;
      return {
        ...shot,
        scene: scenes.get(sortOrder) ?? shot.scene,
      };
    });
    const shots = [...latestJobs.entries()].map(([sortOrder, job]) => {
      const params = this.record(job.paramsJson);
      return {
        jobId: job.id,
        paramsJson: {
          ...params,
          _shot: {
            ...this.record(params._shot),
            scene: scenes.get(sortOrder),
          },
        },
      };
    });
    const hashtags = this.cleanHashtags(input.hashtags);
    const transitioned = await this.repository.updatePlan({
      draftId: input.draftId,
      caption,
      hashtags,
      conceptJson: {
        ...concept,
        plan: { ...plan, caption, hashtags, shots: updatedPlanShots },
      } as Prisma.InputJsonValue,
      shots: shots as { jobId: string; paramsJson: Prisma.InputJsonValue }[],
    });
    if (!transitioned) {
      throw new BadRequestException("Draft plan is no longer editable");
    }
    return this.getDraft(input.draftId);
  }

  async updatePrompts(input: {
    draftId: string;
    items: { jobId: string; prompt: string }[];
  }): Promise<AdminDraft> {
    const draft = await this.repository.findPlanEditDraft(input.draftId);
    if (!draft) throw new BadRequestException("Draft not found");
    const concept = this.record(draft.conceptJson);
    if (concept.mode !== "manual" || draft.status !== "generating") {
      throw new BadRequestException(
        "Only manual draft-state prompts can be edited",
      );
    }
    const currentIds = new Set(draft.jobs.map((job) => job.id));
    const items = input.items.map((item) => ({
      jobId: item.jobId,
      prompt: item.prompt.trim(),
    }));
    if (
      items.length !== currentIds.size ||
      items.some((item) => !item.prompt || !currentIds.has(item.jobId))
    ) {
      throw new BadRequestException(
        "Prompts must be provided for every current draft shot",
      );
    }
    if (
      !(await this.repository.updatePrompts({ draftId: input.draftId, items }))
    ) {
      throw new BadRequestException("Draft prompts are no longer editable");
    }
    return this.getDraft(input.draftId);
  }

  async updateDraft(input: {
    draftId: string;
    caption?: string;
    hashtags?: string[];
    scheduledAt?: string | null;
    finish?: string | null;
    reason?: string;
  }): Promise<AdminDraft> {
    const data: Record<string, unknown> = {};
    if (input.caption !== undefined) {
      const caption = input.caption.trim();
      if (!caption) {
        throw new BadRequestException("Draft caption is required");
      }
      if (caption.length > CAPTION_MAX_LENGTH) {
        throw new BadRequestException(
          `Draft caption must be at most ${CAPTION_MAX_LENGTH} characters`,
        );
      }
      data.caption = caption;
    }
    if (input.hashtags !== undefined) {
      data.hashtags = this.cleanHashtags(input.hashtags);
    }
    if (input.scheduledAt !== undefined) {
      data.scheduledAt =
        input.scheduledAt === null
          ? null
          : this.parseOptionalDate(input.scheduledAt);
    }
    if (input.finish !== undefined) {
      // 게시 마감 프리셋 — conceptJson 메타에 저장한다 (게시글 단위 선택).
      // null/"none"은 프리셋 해제(원본 게시). 다른 키는 보존한다.
      const clear = input.finish === null || input.finish === "none";
      const preset = clear ? null : parseFinishPreset(input.finish);
      if (!clear && !preset) {
        throw new BadRequestException("Unknown finish preset");
      }
      const existing = await this.repository.findDraftConcept(input.draftId);
      if (!existing) {
        throw new BadRequestException("Draft not found");
      }
      const concept =
        existing.conceptJson &&
        typeof existing.conceptJson === "object" &&
        !Array.isArray(existing.conceptJson)
          ? { ...(existing.conceptJson as Record<string, unknown>) }
          : {};
      if (preset) {
        concept.finish = preset;
      } else {
        delete concept.finish;
      }
      data.conceptJson = concept;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException("Nothing to update");
    }

    // V4에는 검수 상태가 없다. 캡션·해시태그·일정은 ⑥ 캡션이 끝난 게시 대기에서,
    // 마감 프리셋은 ⑤ 완료 이후(캡션 대기 포함)에서 고친다 — 캡션 대기 중의
    // 캡션 편집은 ⑥ 실행이 덮어쓰므로 허용하지 않는다.
    const captionLike =
      input.caption !== undefined ||
      input.hashtags !== undefined ||
      input.scheduledAt !== undefined;
    const transitioned = await this.repository.updateEditableDraft(
      input.draftId,
      EDITABLE_STATUSES,
      data,
      captionLike ? ["publish"] : ["caption", "publish"],
    );
    if (!transitioned) {
      await this.assertDraftExists(input.draftId);
      throw new BadRequestException(
        "Only needs_review or approved drafts (or V4 drafts waiting to publish) can be edited",
      );
    }
    if (
      input.caption !== undefined ||
      input.hashtags !== undefined ||
      input.finish !== undefined
    ) {
      await this.repository.markManual(input.draftId);
    }
    if (input.caption !== undefined || input.hashtags !== undefined) {
      // 편집 이유는 측정 원자료다(아키텍처 §20.8 — 편집 당사자의 1차 라벨).
      const draft = await this.getDraft(input.draftId);
      await this.recordActionLog(
        draft.characterId,
        input.draftId,
        "DRAFT_CAPTION_EDITED",
        input.reason?.trim() || "caption edited by operator",
      );
      return draft;
    }
    return this.getDraft(input.draftId);
  }

  // 운영자가 파이프라인에 의도를 전달하는 유일한 통로다. 평가 Agent의 지적은
  // 러너가 읽지 않고 Agent 입력 계약에도 자리가 없으므로, 재실행에 무언가를
  // 반영하려면 이 값을 바꾸는 수밖에 없다.
  async updateOperatorRequest(input: {
    draftId: string;
    operatorRequest?: string | null;
  }): Promise<AdminDraft> {
    const trimmed = input.operatorRequest?.trim() ?? "";
    if (trimmed.length > OPERATOR_REQUEST_MAX_LENGTH) {
      throw new BadRequestException(
        `Operator request must be at most ${OPERATOR_REQUEST_MAX_LENGTH} characters`,
      );
    }
    const existing = await this.repository.findDraftConcept(input.draftId);
    if (!existing) {
      throw new BadRequestException("Draft not found");
    }
    const concept =
      existing.conceptJson &&
      typeof existing.conceptJson === "object" &&
      !Array.isArray(existing.conceptJson)
        ? { ...(existing.conceptJson as Record<string, unknown>) }
        : {};
    // V2 플래너는 sceneHint를 읽는다. V2 draft에 operatorRequest를 써봐야 아무도
    // 읽지 않으므로, 저장을 성공으로 보고하지 않는다.
    if (!isPostPipelineV3(concept)) {
      throw new BadRequestException(
        "Only post-pipeline-v3/v4 drafts have an operator request",
      );
    }
    // 빈 값은 "지정 없음"으로 되돌리는 것이다. 런타임도 공백을 요청 없음으로
    // 본다(`operatorRequest()` in post-pipeline-v3.runner.ts).
    if (trimmed) {
      concept.operatorRequest = trimmed;
    } else {
      delete concept.operatorRequest;
    }
    const transitioned = await this.repository.updateEditableDraft(
      input.draftId,
      OPERATOR_REQUEST_EDITABLE_STATUSES,
      { conceptJson: concept },
    );
    if (!transitioned) {
      throw new BadRequestException(
        "Only drafts waiting for a stage run can change the operator request",
      );
    }
    await this.repository.markManual(input.draftId);
    return this.getDraft(input.draftId);
  }

  async updateMemoryCandidates(input: {
    draftId: string;
    selectedKeys: string[];
  }): Promise<AdminDraft> {
    const existing = await this.repository.findDraftConcept(input.draftId);
    if (!existing) throw new BadRequestException("Draft not found");
    const concept = this.record(existing.conceptJson);
    if (!isPostPipelineV3(concept) || concept.mode !== "manual") {
      throw new BadRequestException(
        "Only manual post-pipeline-v3/v4 drafts can select memory candidates",
      );
    }
    const postPlanHash = this.record(concept.postPlanning).hash;
    const candidates = Array.isArray(concept.memoryCandidates)
      ? concept.memoryCandidates
      : [];
    const currentKeys = new Set(
      candidates.flatMap((value) => {
        const candidate = this.record(value);
        return typeof candidate.key === "string" &&
          candidate.sourcePostPlanHash === postPlanHash
          ? [candidate.key]
          : [];
      }),
    );
    if (input.selectedKeys.some((key) => !currentKeys.has(key))) {
      throw new BadRequestException(
        "Selected memory candidates must belong to the current post plan",
      );
    }
    const selected = new Set(input.selectedKeys);
    const nextCandidates = candidates.map((value) => {
      const candidate = this.record(value);
      return typeof candidate.key === "string" && currentKeys.has(candidate.key)
        ? { ...candidate, selected: selected.has(candidate.key) }
        : candidate;
    });
    const transitioned = await this.repository.updateEditableDraft(
      input.draftId,
      OPERATOR_REQUEST_EDITABLE_STATUSES,
      {
        conceptJson: {
          ...concept,
          memoryCandidates: nextCandidates,
        } as Prisma.InputJsonValue,
      },
    );
    if (!transitioned) {
      throw new BadRequestException(
        "Memory candidates can only change while the current stage is waiting or failed",
      );
    }
    await this.repository.markManual(input.draftId);
    return this.getDraft(input.draftId);
  }

  async approveDraft(draftId: string): Promise<AdminDraft> {
    const current = await this.getDraft(draftId);
    if (current.status !== "needs_review") {
      throw new BadRequestException("Only needs_review drafts can be approved");
    }
    if (
      !current.shots?.length ||
      current.shots.some(
        (shot) => !shot.outputs.some((output) => output.selected),
      )
    ) {
      throw new BadRequestException(
        "Select one image for every shot before approval",
      );
    }
    const transitioned = await this.repository.approveDraft(draftId);
    if (!transitioned) {
      await this.assertDraftExists(draftId);
      throw new BadRequestException("Only needs_review drafts can be approved");
    }
    const draft = await this.getDraft(draftId);
    await this.recordActionLog(
      draft.characterId,
      draftId,
      "DRAFT_APPROVED",
      draft.scheduledAt
        ? `draft approved; publish at ${draft.scheduledAt}`
        : "draft approved; publish immediately",
    );
    return draft;
  }

  async rejectDraft(input: {
    draftId: string;
    reason?: string;
  }): Promise<AdminDraft> {
    const transitioned = await this.repository.rejectDraft(input.draftId);
    if (!transitioned) {
      await this.assertDraftExists(input.draftId);
      throw new BadRequestException("Only needs_review drafts can be rejected");
    }
    const draft = await this.getDraft(input.draftId);
    await this.recordActionLog(
      draft.characterId,
      input.draftId,
      "DRAFT_REJECTED",
      input.reason?.trim() || "draft rejected",
    );
    return draft;
  }

  // 수동 진행 컷 실행 준비 — draft 상태 컷의 프롬프트/후보 수를 반영하고
  // queued로 전환한다. 실제 실행(runJobNow)은 컨트롤러가 이어서 호출한다.
  async queueShot(input: {
    draftId: string;
    jobId: string;
    prompt?: string;
    candidateCount?: number;
  }): Promise<void> {
    const prompt = input.prompt?.trim();
    if (input.prompt !== undefined && !prompt) {
      throw new BadRequestException("Shot prompt cannot be empty");
    }
    // 프롬프트 빌드 전(빈 프롬프트) 컷은 생성 실행을 막는다 — 운영자가
    // 직접 프롬프트를 넘긴 경우는 예외.
    if (!prompt) {
      const existing = await this.repository.findDraftShotPrompt(
        input.draftId,
        input.jobId,
      );
      if (existing && !existing.prompt.trim()) {
        throw new BadRequestException(
          "Shot prompt is empty — run prompt build first or provide a prompt",
        );
      }
    }
    const transitioned = await this.repository.queueDraftShot({
      draftId: input.draftId,
      jobId: input.jobId,
      ...(prompt ? { prompt } : {}),
      ...(input.candidateCount != null
        ? { candidateCount: input.candidateCount }
        : {}),
    });
    if (!transitioned) {
      await this.assertDraftExists(input.draftId);
      throw new BadRequestException(
        "Only draft-state shots of this draft can start generation",
      );
    }
    await this.repository.markManual(input.draftId);
    const job = await this.repository.findShotIdentity(input.jobId);
    if (job) {
      await this.recordActionLog(
        job.characterId,
        input.draftId,
        "DRAFT_SHOT_GENERATION_STARTED",
        `shot ${job.sortOrder} generation started manually`,
      );
    }
  }

  // 컷 재생성: 같은 (draftId, sortOrder)로 새 잡을 만들고 draft를 regenerating으로.
  // 새 잡 id를 돌려준다 — 컨트롤러가 곧바로 runJobNow로 실행한다(수동 = 자동의
  // 스텝 실행 모드). 큐에만 넣고 끝내면 자동 워커 루프가 꺼진 개발 환경에서
  // 아무도 집어가지 않는다(2026-08-16 한소이 초안에서 실제로 4분간 queued 방치).
  async regenerateShot(input: {
    draftId: string;
    jobId: string;
    prompt?: string;
  }): Promise<{ draft: AdminDraft; newJobId: string }> {
    const job = await this.repository.findRegenerationSource(
      input.draftId,
      input.jobId,
    );
    if (!job) {
      throw new BadRequestException("Draft shot job not found");
    }
    if (job.status !== "completed" && job.status !== "failed") {
      throw new BadRequestException(
        "Only completed or failed draft shots can be regenerated",
      );
    }
    const prompt = input.prompt?.trim() || job.prompt;

    const result = await this.repository.regenerateShot({
      draftId: input.draftId,
      source: job,
      prompt,
    });
    if (result.outcome === "stale-job") {
      throw new BadRequestException(
        "Only the latest draft shot can be regenerated",
      );
    }
    if (result.outcome === "draft-not-found") {
      throw new BadRequestException("Draft not found");
    }
    if (result.outcome === "invalid-draft-status") {
      throw new BadRequestException(
        "This draft is not in a state where shots can be regenerated",
      );
    }
    await this.repository.markManual(input.draftId);
    return {
      draft: await this.getDraft(input.draftId),
      newJobId: result.jobId,
    };
  }

  // best-of-N 후보 선택 교체.
  async selectShotOutput(input: {
    draftId: string;
    jobId: string;
    mediaId: string;
  }): Promise<AdminDraft> {
    const existing = await this.repository.findDraftConcept(input.draftId);
    if (existing && isPostPipelineV4(existing.conceptJson)) {
      // V4: 프롬프트당 1장, 고를 것이 없다(아키텍처 §20.0 결정 3).
      throw new BadRequestException(
        "V4 drafts have no candidate selection — each shot has one image",
      );
    }
    const job = await this.repository.findCompletedShotCandidates(
      input.draftId,
      input.jobId,
    );
    if (!job) {
      throw new BadRequestException("Completed draft shot job not found");
    }
    if (!job.outputs.some((output) => output.mediaId === input.mediaId)) {
      throw new BadRequestException(
        "Media is not a candidate output of this job",
      );
    }

    await this.repository.selectShotOutput(input.jobId, input.mediaId);
    await this.repository.markManual(input.draftId);
    return this.getDraft(input.draftId);
  }

  async updateShotOutputFilter(input: {
    draftId: string;
    jobId: string;
    mediaId: string;
    filterPreset: string;
  }): Promise<AdminDraft> {
    if (
      input.filterPreset !== "none" &&
      !parseFinishPreset(input.filterPreset)
    ) {
      throw new BadRequestException("Unknown filter preset");
    }
    const output = await this.repository.findEditableOutput({
      draftId: input.draftId,
      jobId: input.jobId,
      mediaId: input.mediaId,
      draftStatuses: FILTER_EDITABLE_STATUSES,
    });
    if (!output) {
      throw new BadRequestException("Completed candidate output not found");
    }
    await this.repository.updateOutputFilter(output.id, input.filterPreset);
    await this.repository.markManual(input.draftId);
    return this.getDraft(input.draftId);
  }

  // 큐에 있는 컷을 지금 실행하기 전 소속 확인 — 다른 초안의 잡을 이 경로로
  // 밀 수 없게 한다. 실행 자체는 워커의 조건부 claim(queued만)이 소유한다.
  async assertShotBelongsToDraft(
    draftId: string,
    jobId: string,
  ): Promise<void> {
    if (!(await this.repository.shotBelongsToDraft(draftId, jobId))) {
      await this.assertDraftExists(draftId);
      throw new BadRequestException("Draft shot job not found");
    }
  }

  private async assertDraftExists(draftId: string): Promise<void> {
    if (!(await this.repository.draftExists(draftId))) {
      throw new BadRequestException("Draft not found");
    }
  }

  private record(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private parseOptionalStatus(status?: string): DraftStatus | undefined {
    const value = status?.trim();
    if (!value) {
      return undefined;
    }
    if ((DRAFT_STATUSES as string[]).includes(value)) {
      return value as DraftStatus;
    }
    throw new BadRequestException(
      `Draft status must be one of ${DRAFT_STATUSES.join(", ")}`,
    );
  }

  private parseOptionalDate(value?: string): Date | undefined {
    const text = value?.trim();
    if (!text) {
      return undefined;
    }
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException("Invalid scheduledAt datetime");
    }
    return date;
  }

  private cleanHashtags(values: string[]): string[] {
    if (!Array.isArray(values)) {
      throw new BadRequestException("hashtags must be an array");
    }
    const cleaned: string[] = [];
    for (const value of values) {
      if (typeof value !== "string") {
        continue;
      }
      const tag = value.trim().replace(/^#+/, "").trim();
      if (tag && !cleaned.includes(tag)) {
        cleaned.push(tag);
      }
      if (cleaned.length >= HASHTAG_MAX) {
        break;
      }
    }
    return cleaned;
  }

  private async recordActionLog(
    characterId: string,
    draftId: string,
    actionType: string,
    reason: string,
  ): Promise<void> {
    await this.repository.recordActionLog({
      characterId,
      draftId,
      actionType,
      reason,
    });
  }

  private toDraft(draft: DraftRow): AdminDraft {
    return {
      id: draft.id,
      characterId: draft.characterId,
      ...(draft.locationId ? { locationId: draft.locationId } : {}),
      draftType: draft.draftType,
      contentType: draft.contentType,
      caption: draft.caption,
      hashtags: draft.hashtags,
      status: draft.status,
      attemptCount: draft.attemptCount,
      ...(draft.errorMessage ? { errorMessage: draft.errorMessage } : {}),
      ...(draft.scheduledAt
        ? { scheduledAt: draft.scheduledAt.toISOString() }
        : {}),
      ...(draft.publishedPostId
        ? { publishedPostId: draft.publishedPostId }
        : {}),
      ...(draft.conceptJson != null ? { conceptJson: draft.conceptJson } : {}),
      createdAt: draft.createdAt.toISOString(),
      updatedAt: draft.updatedAt.toISOString(),
    };
  }
}
