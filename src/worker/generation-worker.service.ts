import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { AppConfig } from "../domain/config/app-config";
import { GenerationJobRepository } from "./generation-job.repository";
import {
  GeneratedMediaStore,
  ReferenceUrlSigner,
} from "./generated-media-store";
import {
  GeneratedImage,
  ImageGenerationProgress,
  ImageGenerationProvider,
  ImageGenerationProviders,
  ImageGenerationRequest,
  ImageGenerationRequestError,
} from "./image-generation.provider";
import { errorMessage, isRecord } from "./value-utils";
import {
  LLM_LOG_TYPE,
  LlmLogService,
} from "../domain/llm-logs/llm-log.service";
import { assertVisibleCharacterHasReference } from "./content-planner";
import {
  AspectRatioFormat,
  DEFAULT_ASPECT_RATIOS,
} from "../domain/settings/generation-settings.service";

export type WorkerConfig = AppConfig["worker"];

// fal edit 계열(nano-banana/edit 등)의 image_urls 상한 — 초과 시 422
// value_error. 장면별 레퍼런스 선별(LLM 선별)이 들어와도 전송 직전 안전판으로
// 유지한다 (docs/media-generation-pipeline.md "컨텍스트 선별").
const MAX_REFERENCE_IMAGES = 10;

// 잡 paramsJson._shot.referenceMediaIds — 기획 LLM이 이 샷에 고른 레퍼런스.
// 필드 없음은 구버전 잡의 전체 레퍼런스 폴백, 빈 배열은 명시적 미사용이다.
function shotReferenceMediaIds(paramsJson: unknown): string[] | undefined {
  if (!isRecord(paramsJson) || !isRecord(paramsJson._shot)) {
    return undefined;
  }
  const ids = paramsJson._shot.referenceMediaIds;
  return Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === "string")
    : undefined;
}

function shotTargetModelId(paramsJson: unknown): string | undefined {
  if (!isRecord(paramsJson) || !isRecord(paramsJson._shot)) {
    return undefined;
  }
  const targetModelId = paramsJson._shot.targetModelId;
  return typeof targetModelId === "string" && targetModelId.trim()
    ? targetModelId.trim()
    : undefined;
}

// V3 잡의 인물 레퍼런스 필요 여부. 값이 없는 옛 V3 잡(이 필드 도입 전)은
// 기획 파서가 이미 "필요하면 바인딩 필수"를 통과시킨 잡이므로 false로 본다 —
// 그 잡들이 실제로 인물 바인딩을 갖고 있으면 어차피 통과하고, 없으면 기획이
// 불필요하다고 판단한 컷이다.
function shotIdentityRequired(paramsJson: unknown): boolean {
  return (
    isRecord(paramsJson) &&
    isRecord(paramsJson._shot) &&
    paramsJson._shot.identityRequired === true
  );
}

function shotCharacterVisible(paramsJson: unknown): boolean | undefined {
  if (!isRecord(paramsJson) || !isRecord(paramsJson._shot)) {
    return undefined;
  }
  return typeof paramsJson._shot.characterVisible === "boolean"
    ? paramsJson._shot.characterVisible
    : undefined;
}

function v3Metadata(paramsJson: unknown): Record<string, unknown> | null {
  return isRecord(paramsJson) && isRecord(paramsJson._v3)
    ? paramsJson._v3
    : null;
}

type ShotExecution = {
  route: "t2i" | "edit";
  referenceMediaIds: string[];
};

function withShotExecution(
  paramsJson: unknown,
  execution: ShotExecution,
): Record<string, unknown> {
  const params = isRecord(paramsJson) ? { ...paramsJson } : {};
  delete params._providerProgress;
  const shot = isRecord(params._shot) ? { ...params._shot } : {};
  return { ...params, _shot: { ...shot, execution } };
}

// 프로바이더가 잡 자체를 거부/실패 처리한 경우. 재시도 시 requestId를 버리고
// 새로 제출해야 한다 (transient 오류는 requestId를 유지해 폴링을 이어받는다).
// permanent = 입력 검증 실패(422 등) — 재시도 없이 즉시 failed 처리한다.
export class ProviderJobFailedError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean = false,
  ) {
    super(message);
  }
}

type ClaimedJob = {
  id: string;
  characterId: string;
  prompt: string;
  status: string;
  attemptCount: number;
  candidateCount: number | null;
  provider: string | null;
  providerRequestId: string | null;
  originJobId: string | null;
  draftId: string | null;
  paramsJson: unknown;
  character: {
    visualProfile: {
      negativePrompt: string;
      providerConfig: unknown;
      referenceMedia: {
        mediaId: string;
        media: {
          url: string;
          storageKey: string | null;
          uploadedAt: Date | null;
        };
      }[];
    } | null;
  };
  draft: {
    draftType: string;
    contentType: string;
    location: {
      negativePrompt: string;
      references: {
        mediaId: string;
        media: {
          url: string;
          storageKey: string | null;
          uploadedAt: Date | null;
        };
      }[];
    } | null;
  } | null;
};

/**
 * 게시 포맷을 초안에서 유도한다. draftType을 먼저 보는 이유는 스토리 초안도
 * contentType 기본값이 feed로 들어오기 때문이다.
 *
 * 초안이 없는 잡(비주얼 프로필 테스트 생성)은 feed로 본다 — 인물 확인용
 * 세로 이미지가 맞고, 비율을 안 보내면 모델이 가로로 뽑는다.
 */
export function aspectRatioFormatOf(
  draft: { draftType: string; contentType: string } | null | undefined,
): AspectRatioFormat {
  if (!draft) {
    return "feed";
  }
  if (draft.draftType === "story") {
    return "story";
  }
  return draft.contentType === "reel" ? "reel" : "feed";
}

type CompletedGeneration = {
  images: GeneratedImage[];
  costUsd?: number;
};

@Injectable()
export class GenerationWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GenerationWorkerService.name);
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private activeTick?: Promise<void>;
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  // 수동 실행(runJobNow)이 백그라운드로 돌린 처리들. 셧다운 시 대기한다.
  private readonly manualRuns = new Set<Promise<void>>();
  private readonly requestInputMediaIds = new WeakMap<
    ImageGenerationRequest,
    string[]
  >();

  constructor(
    private readonly jobs: GenerationJobRepository,
    // 잡 처리 시마다 재해석한다 — admin 설정(UI)에서 키/모델을 바꾸면
    // 프로세스 재시작 없이 다음 잡부터 반영된다.
    private readonly resolveProviders: () => Promise<ImageGenerationProviders>,
    private readonly store: GeneratedMediaStore,
    // 자동 루프 on/off도 tick마다 재해석 — 설정 화면 토글이 프로세스 재시작
    // 없이 반영돼야 한다.
    private readonly resolveEnabled: () => Promise<boolean>,
    private readonly config: WorkerConfig,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
    private readonly downloadBytes: (
      url: string,
      headers?: Record<string, string>,
    ) => Promise<Buffer> = download,
    // 자사 S3 레퍼런스를 프로바이더가 받을 수 있게 서명한다(버킷 비공개 유지).
    // null이면 원본 URL 그대로 전송 (공개 버킷/외부 URL 전제).
    private readonly signReferenceUrl: ReferenceUrlSigner | null = null,
    private readonly llmLogs?: LlmLogService,
    // 포맷별 종횡비도 잡마다 재해석한다. 기본값을 두는 이유는 이 워커를 직접
    // 조립하는 코드(테스트 등)가 설정 서비스를 몰라도 되게 하기 위해서다.
    private readonly resolveAspectRatios: () => Promise<
      Record<AspectRatioFormat, string>
    > = async () => DEFAULT_ASPECT_RATIOS,
  ) {}

  onModuleInit(): void {
    // 루프는 항상 띄우고 켜짐 여부는 tick이 판단한다.
    void this.resolveProviders()
      .then((providers) =>
        this.logger.log(
          `Generation worker loop started (t2i=${providers.t2i.name}, edit=${providers.edit.name}, interval=${this.config.pollIntervalMs}ms)`,
        ),
      )
      .catch((error: unknown) =>
        // 설정이 없으면 잡마다 실패한다 — 시작 시점에 원인을 남긴다.
        this.logger.warn(
          `Generation worker loop started but the image provider is unavailable (interval=${this.config.pollIntervalMs}ms): ${
            error instanceof Error ? error.message : String(error)
          }`,
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
    await Promise.allSettled(this.manualRuns);
  }

  // admin의 수동 실행. 지정 잡(또는 다음 queued 잡)을 claim만 하고
  // 처리는 백그라운드로 넘긴다 — HTTP 응답이 생성 완료를 기다리지 않는다.
  // 자동 루프 토글과 무관하게 동작한다 (토글은 자동 루프만 제어).
  async runJobNow(jobId?: string): Promise<{ jobId: string | null }> {
    const claimed = jobId
      ? await this.claimSpecificJob(jobId)
      : await this.claimNextJob();
    if (!claimed) {
      return { jobId: null };
    }
    const run = this.processJob(claimed)
      .catch((error) =>
        this.logger.error(
          `Manual run ${claimed} failed: ${errorMessage(error)}`,
        ),
      )
      .finally(() => this.manualRuns.delete(run));
    this.manualRuns.add(run);
    return { jobId: claimed };
  }

  // 특정 queued 이미지 잡을 조건부 전이로 claim한다. queued가 아니면 null.
  private async claimSpecificJob(jobId: string): Promise<string | undefined> {
    return this.jobs.claimQueuedImageJob(jobId, this.config.leaseSeconds);
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
      this.logger.error(`Worker tick failed: ${errorMessage(error)}`);
    } finally {
      this.scheduleNext();
    }
  }

  // 한 틱: 좀비 회수 → (서킷/예산 게이트) → claim → 처리. 테스트에서 직접 호출한다.
  async tick(): Promise<void> {
    // 꺼져 있으면 lease 회수도 하지 않는다 — 자동 루프가 아무 일도 하지 않는
    // 상태가 "꺼짐"의 정의다. 만료 lease는 다시 켤 때 회수된다.
    if (!(await this.resolveEnabled())) {
      return;
    }
    await this.sweepExpiredLeases();
    for (let processed = 0; processed < this.config.jobsPerTick; processed++) {
      if (this.circuitOpen() || !(await this.withinDailyBudget())) {
        return;
      }
      const jobId = await this.claimNextJob();
      if (!jobId) {
        return;
      }
      await this.processJob(jobId);
    }
  }

  // lease가 만료된 running 잡을 회수한다. 시도 여유가 있으면 queued로 되돌리고,
  // 소진했으면 failed 처리한다. 배포/크래시로 중단된 잡의 유일한 복구 경로.
  private async sweepExpiredLeases(): Promise<void> {
    const now = new Date();
    const requeued = await this.jobs.requeueExpiredLeases(
      now,
      this.config.maxAttempts,
    );
    if (requeued > 0) {
      this.logger.warn(`Requeued ${requeued} expired-lease job(s)`);
    }

    const exhausted = await this.jobs.findExhaustedLeases(
      now,
      this.config.maxAttempts,
    );
    for (const job of exhausted) {
      const message = `lease expired after ${job.attemptCount} attempt(s)`;
      if (await this.jobs.markFailed(job.id, message)) {
        await this.recordActionLog(job.characterId, job.id, {
          actionType: "GENERATION_JOB_FAILED",
          reason: message,
        });
      }
    }
  }

  private circuitOpen(): boolean {
    return Date.now() < this.circuitOpenUntil;
  }

  private async withinDailyBudget(): Promise<boolean> {
    if (this.config.dailyBudgetUsd === undefined) {
      return true;
    }
    const spent = await this.jobs.sumCostSince(startOfKstDay());
    const within =
      spent + this.config.jobCostEstimateUsd <= this.config.dailyBudgetUsd;
    if (!within) {
      this.logger.warn(
        `Daily generation budget reached (${spent.toFixed(2)}/${this.config.dailyBudgetUsd} USD); pausing claims`,
      );
    }
    return within;
  }

  // FOR UPDATE SKIP LOCKED으로 queued 이미지 잡 하나를 원자적으로 집는다.
  // 여러 워커 인스턴스가 떠도 같은 잡을 중복 처리하지 않는다.
  private async claimNextJob(): Promise<string | undefined> {
    return this.jobs.claimNextQueuedImageJob(this.config.leaseSeconds);
  }

  private async processJob(jobId: string): Promise<void> {
    const job = (await this.jobs.findForProcessing(jobId)) as ClaimedJob | null;
    if (!job || job.status !== "running") {
      return;
    }

    try {
      // 레퍼런스가 있으면 edit(컨디셔닝) 모델, 없으면 t2i 모델. 단,
      // characterVisible=true인 구조화 잡은 레퍼런스 없이 실행하지 않는다.
      const request = await this.buildRequest(job);
      const providers = await this.resolveProviders();
      const provider =
        request.references.length > 0 ? providers.edit : providers.t2i;
      const targetModelId = shotTargetModelId(job.paramsJson);
      if (
        targetModelId &&
        provider.name.startsWith("fal:") &&
        provider.name !== `fal:${targetModelId}`
      ) {
        this.logger.warn(
          `Job ${job.id}: planned target model ${targetModelId} does not match resolved provider ${provider.name}`,
        );
      }
      const result = await this.generate(job, provider, request);
      await this.persistSuccess(job, result, provider.name);
      this.consecutiveFailures = 0;
      this.logger.log(`Job ${job.id} completed via ${provider.name}`);
    } catch (error) {
      await this.handleFailure(job, error);
    }
  }

  private async generate(
    job: ClaimedJob,
    provider: ImageGenerationProvider,
    request: ImageGenerationRequest,
  ): Promise<CompletedGeneration> {
    let requestId = job.providerRequestId ?? undefined;
    provider.setLogContext?.({
      requestId: job.originJobId ?? job.id,
      characterId: job.characterId,
      generationJobId: job.id,
      inputMediaIds: this.requestInputMediaIds.get(request) ?? [],
    });
    // 이전 시도가 다른 프로바이더로 제출했던 잡은 이어받을 수 없으므로 새로 제출한다.
    // (시도 사이에 레퍼런스가 승격되어 라우팅이 바뀐 경우도 여기에 해당한다.)
    if (!requestId || job.provider !== provider.name) {
      const submitted = await provider.submit(request);
      requestId = submitted.requestId;
      job.providerRequestId = requestId;
      job.provider = provider.name;
      const referenceMediaIds = this.requestInputMediaIds.get(request) ?? [];
      const paramsJson = withShotExecution(job.paramsJson, {
        route: referenceMediaIds.length > 0 ? "edit" : "t2i",
        referenceMediaIds,
      });
      job.paramsJson = paramsJson;
      // 제출 직후 기록해야 크래시 후 재수용 시 이중 제출을 막는다.
      await this.jobs.recordProviderSubmission({
        jobId: job.id,
        providerRequestId: requestId,
        provider: provider.name,
        paramsJson,
        sentPrompt: submitted.sentPrompt,
      });
      job.prompt = submitted.sentPrompt || job.prompt;
    }

    let lastProgress = "";
    let progressWrites = Promise.resolve();
    const persistProgress = (progress: ImageGenerationProgress) => {
      const serialized = JSON.stringify(progress);
      if (serialized === lastProgress) return;
      lastProgress = serialized;
      progressWrites = progressWrites
        .then(() =>
          this.jobs.recordProviderProgress({ jobId: job.id, progress }),
        )
        .catch((error: unknown) => {
          this.logger.warn(
            `Job ${job.id}: provider progress could not be persisted: ${errorMessage(error)}`,
          );
        });
    };
    const unsubscribe = provider.subscribeProgress?.(
      requestId,
      persistProgress,
    );
    const deadline = Date.now() + this.config.providerTimeoutMs;
    try {
      for (;;) {
        const result = await provider.poll(requestId);
        if (result.status === "completed") {
          return result;
        }
        if (result.status === "failed") {
          throw new ProviderJobFailedError(
            result.errorMessage,
            result.permanent === true,
          );
        }
        if (result.progress) persistProgress(result.progress);
        if (Date.now() >= deadline) {
          // 아직 큐에서 시작 전이라면 과금 전에 취소를 시도한다 (베스트에포트).
          await provider.cancel?.(requestId);
          throw new Error(
            `provider polling timed out after ${this.config.providerTimeoutMs}ms`,
          );
        }
        await this.extendLease(job.id);
        await this.sleep(this.config.providerPollIntervalMs);
      }
    } finally {
      unsubscribe?.();
      await progressWrites;
    }
  }

  private async buildRequest(job: ClaimedJob): Promise<ImageGenerationRequest> {
    const profile = job.character.visualProfile;
    // 인물 정체성 레퍼런스와 선택 장소의 환경 레퍼런스를 구분해 해석한다.
    const uploadedIdentity = (profile?.referenceMedia ?? []).filter(
      (reference) => reference.media.uploadedAt,
    );
    const uploadedEnvironment = (job.draft?.location?.references ?? []).filter(
      (reference) => reference.media.uploadedAt,
    );
    const uploaded = [...uploadedIdentity, ...uploadedEnvironment];
    const identityIds = new Set(
      uploadedIdentity.map((reference) => reference.mediaId),
    );
    // 기획 LLM이 이 샷에 고른 레퍼런스 (docs/media-generation-pipeline.md
    // "컨텍스트 선별"). 필드 없음은 구버전 잡 호환을 위해 전체를 쓰고,
    // 빈 배열은 인물 없는 샷이므로 레퍼런스를 보내지 않는다.
    const selectedIds = shotReferenceMediaIds(job.paramsJson);
    const v3 = v3Metadata(job.paramsJson);
    const selected =
      selectedIds === undefined
        ? uploadedIdentity
        : selectedIds
            .map((mediaId) =>
              uploaded.find((reference) => reference.mediaId === mediaId),
            )
            .filter(
              (reference): reference is (typeof uploaded)[number] =>
                reference !== undefined,
            );
    const characterVisible = shotCharacterVisible(job.paramsJson);
    const ordered =
      !v3 && characterVisible === false
        ? selected.filter((reference) => !identityIds.has(reference.mediaId))
        : selected;
    if (v3 && selectedIds) {
      const bindings = Array.isArray(v3.referenceBindings)
        ? v3.referenceBindings
        : [];
      const bindingIds = bindings.map((binding) =>
        isRecord(binding) && typeof binding.referenceId === "string"
          ? binding.referenceId
          : null,
      );
      const actualIds = ordered.map((reference) => reference.mediaId);
      if (
        bindingIds.some((id) => id === null) ||
        bindingIds.length !== selectedIds.length ||
        bindingIds.some((id, index) => id !== selectedIds[index]) ||
        actualIds.length !== selectedIds.length ||
        actualIds.some((id, index) => id !== selectedIds[index])
      ) {
        throw new ProviderJobFailedError(
          `shot ${job.id} V3 reference binding/asset order mismatch`,
          true,
        );
      }
    }
    // V2: 캐릭터가 보이면 인물 레퍼런스가 있어야 한다(기획이 그 판단을 안 함).
    // V3/V4: 그 판단은 이미지 기획 계약(identityPreservationRequired)이 소유하고
    // 파서가 "필요하면 바인딩 필수"를 이미 강제한다. 여기서 characterVisible로
    // 다시 판단하면 손·팔뚝만 보이는 컷(보이지만 인물 레퍼런스 불필요)을
    // 실패시킨다 — 2026-08-16 한소이 첫 V4 초안에서 실제로 났다. 서린은
    // 항상 체형 레퍼런스를 묶어서 이 가드가 우연히 안 걸렸을 뿐이다.
    const requiresIdentity = v3
      ? shotIdentityRequired(job.paramsJson)
      : characterVisible === true ||
        (characterVisible === undefined &&
          ordered.some((reference) => identityIds.has(reference.mediaId)));
    try {
      assertVisibleCharacterHasReference(
        requiresIdentity,
        ordered.filter((reference) => identityIds.has(reference.mediaId))
          .length,
        `shot ${job.id}`,
      );
    } catch (error) {
      throw new ProviderJobFailedError(errorMessage(error), true);
    }
    // fal edit 계열의 image_urls 상한(10장 초과 시 422 value_error) 안전판.
    if (ordered.length > MAX_REFERENCE_IMAGES) {
      this.logger.warn(
        `Job ${job.id}: ${ordered.length} reference images exceed the provider limit; sending first ${MAX_REFERENCE_IMAGES}`,
      );
    }
    // 자사 S3 객체(storageKey 있음)는 presigned URL로 서명해 보낸다 —
    // 버킷을 공개로 열지 않아도 프로바이더가 다운로드할 수 있다.
    const referenceImageUrls = await Promise.all(
      ordered
        .slice(0, MAX_REFERENCE_IMAGES)
        .map((reference) =>
          this.signReferenceUrl && reference.media.storageKey
            ? this.signReferenceUrl(reference.media.storageKey)
            : Promise.resolve(reference.media.url),
        ),
    );
    // 우선순위: 포맷 종횡비 < 프로필 기본값(providerConfig) < 잡 파라미터.
    // 종횡비를 맨 아래 두는 이유는 그것이 "기본값"이기 때문이다 — 명시적으로
    // 설정한 값은 언제나 이긴다. 예전에는 데이터에만 맡겼는데 아무도 설정하지
    // 않아 전 게시물이 모델 기본값(가로)으로 나왔다.
    // 밑줄 접두 키(_wizard 등)는 파이프라인 메타데이터 — 프로바이더에 보내지 않는다.
    const aspectRatios = await this.resolveAspectRatios();
    const format = aspectRatioFormatOf(job.draft);
    const extraParams = stripMetaKeys({
      aspect_ratio: aspectRatios[format],
      ...(isRecord(profile?.providerConfig) ? profile.providerConfig : {}),
      ...(isRecord(job.paramsJson) ? job.paramsJson : {}),
    });
    const request: ImageGenerationRequest = {
      idempotencyKey: job.id,
      profile: requiresIdentity
        ? "photoreal_identity_v1"
        : "photoreal_scene_v1",
      prompt: job.prompt,
      negativePrompt:
        [
          profile?.negativePrompt,
          job.draft?.location?.negativePrompt,
          v3 && typeof v3.negativePrompt === "string"
            ? v3.negativePrompt
            : undefined,
        ]
          .map((value) => value?.trim())
          .filter(Boolean)
          .join(", ") || undefined,
      references: ordered
        .slice(0, MAX_REFERENCE_IMAGES)
        .map((reference, index) => {
          const identity = identityIds.has(reference.mediaId);
          const earlierIdentity = ordered
            .slice(0, index)
            .some((candidate) => identityIds.has(candidate.mediaId));
          return {
            id: reference.mediaId,
            role: identity
              ? requiresIdentity
                ? ("identity" as const)
                : ("outfit" as const)
              : ("background" as const),
            ...(identity && requiresIdentity && !earlierIdentity
              ? { primary: true }
              : {}),
            url: referenceImageUrls[index],
          };
        }),
      candidateCount: job.candidateCount ?? this.config.candidateCount,
      extraParams:
        Object.keys(extraParams).length > 0 ? extraParams : undefined,
      metadata: {
        character_id: job.characterId,
        generation_job_id: job.id,
        ...(job.draftId ? { draft_id: job.draftId } : {}),
      },
    };
    this.requestInputMediaIds.set(
      request,
      ordered
        .slice(0, MAX_REFERENCE_IMAGES)
        .map((reference) => reference.mediaId)
        .filter(Boolean),
    );
    return request;
  }

  // 출력 다운로드 → 우리 스토리지 업로드 → Media(uploadedAt 확정, isAiGenerated)
  // → 후보 기록 → completed 전이. 영속화는 한 트랜잭션으로 묶는다.
  private async persistSuccess(
    job: ClaimedJob,
    result: CompletedGeneration,
    providerName: string,
  ): Promise<void> {
    const stored: {
      image: GeneratedImage;
      url: string;
      storageKey?: string;
      contentType: string;
      byteSize: number;
    }[] = [];
    for (const image of result.images) {
      const bytes = image.dataBase64
        ? decodeBase64Image(image.dataBase64)
        : await this.downloadBytes(image.url, image.downloadHeaders);
      if (
        image.sha256 &&
        createHash("sha256").update(bytes).digest("hex") !==
          image.sha256.toLowerCase()
      ) {
        throw new Error("generated media SHA-256 verification failed");
      }
      const contentType = image.contentType ?? "image/png";
      const file = await this.store({
        bytes,
        contentType,
        keyPrefix: `pod/generated/character/${job.characterId}`,
      });
      stored.push({
        image,
        url: file.url,
        storageKey: file.storageKey,
        contentType,
        byteSize: bytes.byteLength,
      });
    }
    const costUsd = result.costUsd ?? this.config.jobCostEstimateUsd;

    await this.jobs.persistSuccess({
      jobId: job.id,
      characterId: job.characterId,
      files: stored,
      costUsd,
      providerName,
    });
  }

  private async handleFailure(job: ClaimedJob, error: unknown): Promise<void> {
    const message = errorMessage(error).slice(0, 500);
    this.logger.warn(
      `Job ${job.id} attempt ${job.attemptCount} failed: ${message}`,
    );

    // 입력 검증 실패(permanent)는 프로바이더 장애가 아니다 — 재시도해도 항상
    // 같은 결과이므로 즉시 실패 처리하고, 서킷브레이커에도 집계하지 않는다.
    const permanent =
      (error instanceof ProviderJobFailedError && error.permanent) ||
      (error instanceof ImageGenerationRequestError && error.permanent);
    if (!permanent) {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= this.config.circuitBreakerThreshold) {
        this.circuitOpenUntil =
          Date.now() + this.config.circuitBreakerCooldownMs;
        this.consecutiveFailures = 0;
        this.logger.error(
          `Circuit breaker opened for ${this.config.circuitBreakerCooldownMs}ms after consecutive failures`,
        );
      }
    }

    if (permanent || job.attemptCount >= this.config.maxAttempts) {
      await this.failRunningLlmLog(job, error);
      if (await this.jobs.markFailed(job.id, message)) {
        await this.recordActionLog(job.characterId, job.id, {
          actionType: "GENERATION_JOB_FAILED",
          reason: message,
        });
      }
      return;
    }

    await this.jobs.requeueForRetry({
      jobId: job.id,
      message,
      // 프로바이더가 잡을 거부한 경우에만 requestId를 버리고 재제출한다.
      // transient 오류는 requestId를 유지해 다음 시도가 폴링을 이어받는다.
      // submit 단계의 영구 입력 오류에는 requestId가 아직 없다. transient
      // submit 오류는 같은 idempotency key로 다시 시도한다.
      clearProviderRequestId: error instanceof ProviderJobFailedError,
    });
  }

  private async failRunningLlmLog(
    job: ClaimedJob,
    error: unknown,
  ): Promise<void> {
    if (!this.llmLogs || !job.providerRequestId) {
      return;
    }
    try {
      const handle = await this.llmLogs.findRunning({
        type: LLM_LOG_TYPE.imageGenerate,
        generationJobId: job.id,
        providerRequestId: job.providerRequestId,
      });
      await this.llmLogs.fail(handle, error, {
        providerRequestId: job.providerRequestId,
      });
    } catch {
      // Provider가 이미 실패 처리했거나 로그 완료 갱신이 실패한 경우다.
    }
  }

  private async extendLease(jobId: string): Promise<void> {
    await this.jobs.extendLease(jobId, this.config.leaseSeconds);
  }

  private async recordActionLog(
    characterId: string,
    jobId: string,
    input: { actionType: string; reason: string },
  ): Promise<void> {
    try {
      await this.jobs.recordActionLog({
        characterId,
        jobId,
        actionType: input.actionType,
        reason: input.reason,
      });
    } catch (error) {
      this.logger.error(`Failed to record action log: ${errorMessage(error)}`);
    }
  }
}

// 예산 게이트/오늘 지출 집계의 KST 자정 기준 (설정 API에서도 재사용).
export function startOfKstDay(now: Date = new Date()): Date {
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kst = new Date(now.getTime() + kstOffsetMs);
  kst.setUTCHours(0, 0, 0, 0);
  return new Date(kst.getTime() - kstOffsetMs);
}

async function download(
  url: string,
  headers?: Record<string, string>,
): Promise<Buffer> {
  const response = await fetch(url, {
    ...(headers ? { headers } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`generated media download failed (${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function decodeBase64Image(value: string): Buffer {
  const normalized = value.replace(/\s/g, "");
  if (
    !normalized ||
    normalized.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      normalized,
    )
  ) {
    throw new Error("generated media contains invalid base64 data");
  }
  return Buffer.from(normalized, "base64");
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 밑줄 접두 키는 파이프라인 메타데이터(예: 위저드의 _wizard) — 프로바이더
// API 파라미터가 아니므로 제출 전에 걸러낸다.
function stripMetaKeys(
  params: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([key]) => !key.startsWith("_")),
  );
}
