// 평가 워커 — 기획·프롬프트 평가를 비동기·비차단으로 수행한다.
// draft 상태 머신과 게시 파이프라인에 어떤 영향도 주지 않는다
// (docs/plan-prompt-evaluation-agent.md, docs/image-prompt-evaluation-agent.md).
//
// 비용 게이트: 기존 예산·서킷브레이커는 이미지 생성 전용이라 공유하지 않는다.
// 대신 tick당 kind별 1건 + 연속 실패 지수 백오프 + 전용 enable 플래그(기본
// 비활성)로 지출을 제한한다. enable 플래그는 admin_settings가 소유하고 tick마다
// 재해석하므로 설정 화면에서 끄면 다음 tick부터 지출이 멈춘다.

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { EVAL_RUBRIC_VERSION } from "../../prompts/plan-evaluator";
import { AppConfig } from "../domain/config/app-config";
import { PlanEvaluationPromptInput, PlanEvaluator } from "./plan-evaluator";
import {
  PromptEvaluationPromptInput,
  PromptEvaluator,
} from "./prompt-evaluator";
import { ImageEvaluationPromptInput, ImageEvaluator } from "./image-evaluator";
import { lintPromptShots } from "./prompt-lint";
import {
  ClaimedEvaluation,
  EvaluationRepository,
  PromptEvaluationJob,
} from "./evaluation.repository";
import { errorMessage, isRecord } from "./value-utils";
import {
  GeneratedImageEvaluationAgentV3,
  ImagePlanEvaluationAgentV3,
  ImagePromptEvaluationAgentV3,
  PostEvaluationAgentV3,
} from "./v3-evaluators";
import { StrictJsonAgentClient } from "./strict-json-agent";
import {
  GENERATED_IMAGE_EVALUATOR_VERSION,
  IMAGE_PLAN_EVALUATOR_VERSION,
  IMAGE_PROMPT_EVALUATOR_VERSION,
  POST_EVALUATOR_VERSION,
} from "../../prompts/v3-evaluators";
import { generationSetHash } from "./post-pipeline-v3";
import { MediaBytesReader } from "./reference-captioner";

export type EvaluationWorkerConfig = AppConfig["evaluationWorker"];

export type EvaluationKind = "plan" | "image_plan" | "prompt" | "image";

const BACKOFF_MAX_MULTIPLIER = 8;

type PlanShot = {
  sortOrder: number;
  scene: string;
  captureSetup: string;
  characterVisible: boolean;
  referenceIds: string[];
  environmentReferenceIds?: string[];
};

@Injectable()
export class EvaluationWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EvaluationWorkerService.name);
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private activeTick?: Promise<void>;
  private consecutiveFailures = 0;

  constructor(
    private readonly repository: EvaluationRepository,
    // 평가 시마다 재해석 — evaluator.* 설정(DB)이 env보다 우선하고,
    // 미설정 필드는 플래너 설정을 상속한다.
    private readonly resolvePlanEvaluator: () => Promise<PlanEvaluator>,
    private readonly resolvePromptEvaluator: () => Promise<PromptEvaluator>,
    private readonly resolveImageEvaluator: () => Promise<ImageEvaluator>,
    // 자동 루프 on/off도 tick마다 재해석 — 설정 화면 토글이 프로세스 재시작
    // 없이 반영돼야 한다.
    private readonly resolveEnabled: () => Promise<boolean>,
    private readonly config: EvaluationWorkerConfig,
    private readonly resolveV3Client:
      (() => Promise<StrictJsonAgentClient | null>) | null = null,
    private readonly readV3Media: MediaBytesReader | null = null,
  ) {}

  onModuleInit(): void {
    // 루프는 항상 띄우고 켜짐 여부는 tick이 판단한다.
    this.logger.log(
      `Evaluation worker loop started (rubric=${EVAL_RUBRIC_VERSION}, interval=${this.config.pollIntervalMs}ms)`,
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
    // 연속 실패 시 폴링 간격을 지수로 늘린다 (최대 8배) — 잘못된 설정이나
    // 장애 중 평가 LLM 지출이 새는 것을 막는 최소 게이트.
    const multiplier = Math.min(
      2 ** this.consecutiveFailures,
      BACKOFF_MAX_MULTIPLIER,
    );
    this.timer = setTimeout(() => {
      this.activeTick = this.runTick();
    }, this.config.pollIntervalMs * multiplier);
  }

  private async runTick(): Promise<void> {
    try {
      await this.tick();
    } catch (error) {
      this.logger.error(
        `Evaluation worker tick failed: ${errorMessage(error)}`,
      );
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
    await this.repository.sweepExpiredLeases(new Date());
    await this.evaluatePending();
  }

  // admin의 수동 실행. 자동 루프 토글과 무관하게 대기 중인 평가를 kind별로
  // 1건씩 처리하고, 실제로 실행한 종류를 돌려준다 (생성 워커의 runJobNow와
  // 달리 단발 LLM 호출이라 응답을 기다린다).
  async runOnce(): Promise<{ evaluated: EvaluationKind[] }> {
    await this.repository.sweepExpiredLeases(new Date());
    return { evaluated: await this.evaluatePending() };
  }

  private async evaluatePending(): Promise<EvaluationKind[]> {
    // 평가자가 unconfigured면 클레임 없이 조용히 쉰다 — 실패 행을 쌓지 않는다.
    const [planEvaluator, promptEvaluator, imageEvaluator] = await Promise.all([
      this.resolvePlanEvaluator(),
      this.resolvePromptEvaluator(),
      this.resolveImageEvaluator(),
    ]);
    const evaluated: EvaluationKind[] = [];
    const v3Client = this.resolveV3Client ? await this.resolveV3Client() : null;
    if (
      planEvaluator.name === "unconfigured" &&
      promptEvaluator.name === "unconfigured" &&
      imageEvaluator.name === "unconfigured" &&
      !v3Client
    ) {
      return evaluated;
    }
    if (
      planEvaluator.name !== "unconfigured" &&
      (await this.evaluateNextPlan(planEvaluator, v3Client))
    ) {
      evaluated.push("plan");
    }
    if (v3Client && (await this.evaluateNextImagePlanV3(v3Client))) {
      evaluated.push("image_plan");
    }
    if (
      promptEvaluator.name !== "unconfigured" &&
      (await this.evaluateNextPrompt(promptEvaluator, v3Client))
    ) {
      evaluated.push("prompt");
    }
    if (
      imageEvaluator.name !== "unconfigured" &&
      (await this.evaluateNextImage(imageEvaluator, v3Client))
    ) {
      evaluated.push("image");
    }
    return evaluated;
  }

  private async evaluateNextImagePlanV3(
    client: StrictJsonAgentClient,
  ): Promise<boolean> {
    const claimed = await this.repository.claim(
      "image_plan",
      this.config.leaseSeconds,
      this.config.maxAttempts,
      IMAGE_PLAN_EVALUATOR_VERSION,
    );
    if (!claimed) return false;
    try {
      const source = await this.repository.loadPlanSource(claimed.draftId);
      const concept =
        source && isRecord(source.conceptJson) ? source.conceptJson : {};
      const artifact = isRecord(concept.imagePlanning)
        ? concept.imagePlanning
        : null;
      if (
        !artifact ||
        !isRecord(artifact.input) ||
        !isRecord(artifact.output)
      ) {
        throw new Error("draft has no V3 ImagePlan artifact to evaluate");
      }
      const result = await new ImagePlanEvaluationAgentV3(client).evaluate(
        { planningInput: artifact.input, imagePlan: artifact.output },
        { requestId: claimed.draftId, characterId: claimed.characterId },
      );
      await this.completeV3(
        claimed,
        IMAGE_PLAN_EVALUATOR_VERSION,
        artifact,
        result,
      );
      this.consecutiveFailures = 0;
    } catch (error) {
      await this.failV3(claimed, error, "ImagePlan");
    }
    return true;
  }

  // 반환값은 "이번에 클레임해서 처리했는가"다. 평가 실패도 처리에 포함된다 —
  // 수동 실행이 "대기 건이 없었다"와 "돌렸는데 실패했다"를 구분해야 한다.
  private async evaluateNextPlan(
    evaluator: PlanEvaluator,
    v3Client: StrictJsonAgentClient | null,
  ): Promise<boolean> {
    const claimed = await this.repository.claim(
      "plan",
      this.config.leaseSeconds,
      this.config.maxAttempts,
      EVAL_RUBRIC_VERSION,
    );
    if (!claimed) {
      return false;
    }
    try {
      const source = await this.repository.loadPlanSource(claimed.draftId);
      const concept =
        source && isRecord(source.conceptJson) ? source.conceptJson : {};
      const artifact = isRecord(concept.postPlanning)
        ? concept.postPlanning
        : null;
      if (
        v3Client &&
        artifact &&
        isRecord(artifact.input) &&
        isRecord(artifact.output)
      ) {
        const result = await new PostEvaluationAgentV3(v3Client).evaluate(
          { planningInput: artifact.input, postPlan: artifact.output },
          { requestId: claimed.draftId, characterId: claimed.characterId },
        );
        await this.completeV3(
          claimed,
          POST_EVALUATOR_VERSION,
          artifact,
          result,
        );
        this.consecutiveFailures = 0;
        return true;
      }
      const input = await this.buildPlanInput(claimed);
      const result = await evaluator.evaluate(input, {
        requestId: claimed.draftId,
        characterId: claimed.characterId,
      });
      await this.repository.complete({
        evaluationId: claimed.evaluationId,
        evaluatorName: evaluator.name,
        overallScore: result.overallScore,
        scoresJson: { scores: result.scores },
        issuesJson: result.issues,
        suggestionsJson: result.suggestions,
      });
      this.consecutiveFailures = 0;
      this.logger.log(
        `Plan evaluated: draft=${claimed.draftId} score=${result.overallScore}`,
      );
    } catch (error) {
      this.consecutiveFailures += 1;
      await this.repository.fail(claimed.evaluationId, errorMessage(error));
      this.logger.warn(
        `Plan evaluation failed: draft=${claimed.draftId} — ${errorMessage(error)}`,
      );
    }
    return true;
  }

  private async evaluateNextPrompt(
    evaluator: PromptEvaluator,
    v3Client: StrictJsonAgentClient | null,
  ): Promise<boolean> {
    const claimed = await this.repository.claim(
      "prompt",
      this.config.leaseSeconds,
      this.config.maxAttempts,
      EVAL_RUBRIC_VERSION,
    );
    if (!claimed) {
      return false;
    }
    try {
      const source = await this.repository.loadPromptSource(claimed.draftId);
      const concept =
        source && isRecord(source.conceptJson) ? source.conceptJson : {};
      const artifact = isRecord(concept.promptBuild)
        ? concept.promptBuild
        : null;
      if (
        v3Client &&
        artifact &&
        isRecord(artifact.input) &&
        isRecord(artifact.output)
      ) {
        const jobs = source?.jobs ?? [];
        const lint = lintPromptShots(
          jobs.map((job) => ({
            sortOrder: job.sortOrder,
            characterVisible:
              isRecord(job.paramsJson) &&
              isRecord(job.paramsJson._shot) &&
              job.paramsJson._shot.characterVisible === true,
            prompt: job.prompt,
          })),
        );
        const result = await new ImagePromptEvaluationAgentV3(
          v3Client,
        ).evaluate(
          {
            promptBuildPackage: artifact.input,
            promptResult: artifact.output,
            lint: Object.fromEntries(
              [...lint.entries()].map(([sortOrder, issues]) => [
                sortOrder,
                issues,
              ]),
            ),
          },
          { requestId: claimed.draftId, characterId: claimed.characterId },
        );
        await this.completeV3(
          claimed,
          IMAGE_PROMPT_EVALUATOR_VERSION,
          artifact,
          result,
        );
        this.consecutiveFailures = 0;
        return true;
      }
      const { input, jobIds } = await this.buildPromptInput(claimed);
      const result = await evaluator.evaluate(input, {
        requestId: claimed.draftId,
        characterId: claimed.characterId,
      });
      await this.repository.complete({
        evaluationId: claimed.evaluationId,
        evaluatorName: evaluator.name,
        overallScore: result.overallScore,
        // 평가 시점의 잡 id를 고정 기록한다 — 이후 컷 재생성으로 최신 잡이
        // 바뀌어도 어느 프롬프트를 심사했는지 추적 가능해야 한다.
        scoresJson: {
          shots: result.shots.map((shot) => ({
            ...shot,
            jobId: jobIds.get(shot.sortOrder),
            lint: input.shots.find((s) => s.sortOrder === shot.sortOrder)
              ?.lintIssues,
          })),
          crossShot: result.crossShot,
        },
        issuesJson: [
          ...result.shots.flatMap((shot) =>
            shot.issues.map((detail) => ({
              dimension: `shot_${shot.sortOrder}`,
              detail,
            })),
          ),
          ...result.crossShot.issues.map((detail) => ({
            dimension: "cross_shot",
            detail,
          })),
        ],
        suggestionsJson: result.shots.flatMap((shot) => shot.suggestions),
      });
      this.consecutiveFailures = 0;
      this.logger.log(
        `Prompts evaluated: draft=${claimed.draftId} score=${result.overallScore}`,
      );
    } catch (error) {
      this.consecutiveFailures += 1;
      await this.repository.fail(claimed.evaluationId, errorMessage(error));
      this.logger.warn(
        `Prompt evaluation failed: draft=${claimed.draftId} — ${errorMessage(error)}`,
      );
    }
    return true;
  }

  private async evaluateNextImage(
    evaluator: ImageEvaluator,
    v3Client: StrictJsonAgentClient | null,
  ): Promise<boolean> {
    const claimed = await this.repository.claim(
      "image",
      // 후보·레퍼런스 바이트 읽기 + 비전 호출은 텍스트 평가보다 길다. 기본
      // 120초 lease를 그대로 쓰면 정상 처리 중 sweep되어 중복 과금될 수 있다.
      Math.max(this.config.leaseSeconds, 240),
      this.config.maxAttempts,
      EVAL_RUBRIC_VERSION,
    );
    if (!claimed) return false;

    try {
      const source = await this.repository.loadImageSource(claimed.draftId);
      const concept =
        source && isRecord(source.conceptJson) ? source.conceptJson : {};
      const imageArtifact = isRecord(concept.imagePlanning)
        ? concept.imagePlanning
        : null;
      const promptArtifact = isRecord(concept.promptBuild)
        ? concept.promptBuild
        : null;
      if (
        v3Client &&
        this.readV3Media &&
        source &&
        imageArtifact &&
        isRecord(imageArtifact.output) &&
        promptArtifact &&
        isRecord(promptArtifact.input)
      ) {
        const latestPerShot = new Map<number, (typeof source.jobs)[number]>();
        for (const job of source.jobs) {
          if (!latestPerShot.has(job.sortOrder)) {
            latestPerShot.set(job.sortOrder, job);
          }
        }
        const selected = [...latestPerShot.values()]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((job) => ({
            sortOrder: job.sortOrder,
            jobId: job.id,
            media: job.outputs.find((output) => output.selected),
          }));
        if (selected.length === 0 || selected.some((item) => !item.media)) {
          throw new Error(
            "V3 generated evaluation requires one selected image per shot",
          );
        }
        const logicalInput = {
          imagePlan: imageArtifact.output,
          subjectContract: promptArtifact.input.subjectContract,
          referenceSlots: promptArtifact.input.referenceSlots,
          selectedImages: selected.map((item) => ({
            sortOrder: item.sortOrder,
            jobId: item.jobId,
            mediaId: item.media?.mediaId,
          })),
        };
        const result = await new GeneratedImageEvaluationAgentV3(
          v3Client,
        ).evaluate(
          logicalInput,
          {
            requestId: claimed.draftId,
            characterId: claimed.characterId,
            inputMediaIds: [
              ...source.referenceMedia.map((media) => media.id),
              ...selected.flatMap((item) =>
                item.media ? [item.media.mediaId] : [],
              ),
            ],
          },
          await visionUserContent(
            logicalInput,
            selected,
            source.referenceMedia,
            this.readV3Media,
          ),
        );
        await this.completeV3(
          claimed,
          GENERATED_IMAGE_EVALUATOR_VERSION,
          {
            revision: 1,
            hash: selectedSetHash(selected),
          },
          result,
        );
        this.consecutiveFailures = 0;
        return true;
      }
      const { input, outputMediaIds, jobIds } =
        await this.buildImageInput(claimed);
      const result = await evaluator.evaluate(input, {
        requestId: claimed.draftId,
        characterId: claimed.characterId,
      });
      await this.repository.complete({
        evaluationId: claimed.evaluationId,
        evaluatorName: evaluator.name,
        overallScore: result.overallScore,
        scoresJson: {
          shots: result.shots.map((shot) => ({
            ...shot,
            jobId: jobIds.get(shot.sortOrder),
            candidates: shot.candidates.map((candidate) => ({
              ...candidate,
              mediaId: outputMediaIds.get(
                `${shot.sortOrder}:${candidate.candidateIndex}`,
              ),
            })),
          })),
          crossShot: result.crossShot,
        },
        issuesJson: [
          ...result.shots.flatMap((shot) =>
            shot.candidates.flatMap((candidate) => [
              ...candidate.hardFailures.map((detail) => ({
                dimension: `shot_${shot.sortOrder}_candidate_${candidate.candidateIndex}`,
                type: "hard_failure",
                detail,
              })),
              ...candidate.issues.map((detail) => ({
                dimension: `shot_${shot.sortOrder}_candidate_${candidate.candidateIndex}`,
                type: "issue",
                detail,
              })),
            ]),
          ),
          ...result.crossShot.hardFailures.map((detail) => ({
            dimension: "cross_shot",
            type: "hard_failure",
            detail,
          })),
          ...result.crossShot.issues.map((detail) => ({
            dimension: "cross_shot",
            type: "issue",
            detail,
          })),
        ],
        suggestionsJson: result.shots.flatMap((shot) =>
          shot.candidates.flatMap((candidate) => candidate.suggestions),
        ),
      });
      this.consecutiveFailures = 0;
      this.logger.log(
        `Images evaluated: draft=${claimed.draftId} score=${result.overallScore}`,
      );
    } catch (error) {
      this.consecutiveFailures += 1;
      await this.repository.fail(claimed.evaluationId, errorMessage(error));
      this.logger.warn(
        `Image evaluation failed: draft=${claimed.draftId} — ${errorMessage(error)}`,
      );
    }
    return true;
  }

  // 기획 평가 입력은 conceptJson.planInput 스냅숏을 그대로 쓴다 — 기획
  // 시점의 페르소나·메모리·최근 캡션과 대조해야 공정한 평가다.
  private async buildPlanInput(
    claimed: ClaimedEvaluation,
  ): Promise<PlanEvaluationPromptInput> {
    const source = await this.repository.loadPlanSource(claimed.draftId);
    if (!source) {
      throw new Error("draft not found for plan evaluation");
    }
    const concept = isRecord(source.conceptJson) ? source.conceptJson : {};
    const plan = isRecord(concept.plan) ? concept.plan : undefined;
    if (!plan || typeof plan.caption !== "string") {
      throw new Error("draft has no persisted plan to evaluate");
    }
    const planInput = isRecord(concept.planInput) ? concept.planInput : {};
    return {
      contentLanguage: source.contentLanguage,
      characterName: stringOr(planInput.characterName) ?? source.characterName,
      bio: stringOr(planInput.bio) ?? source.bio,
      interests: stringsOr(planInput.interests) ?? source.interests,
      personas: personasOr(planInput.personas),
      memories: stringsOr(planInput.memories) ?? [],
      recentCaptions: stringsOr(planInput.recentCaptions) ?? [],
      referenceCatalog: referenceCatalogOr(planInput.referenceCatalog),
      locationCatalog: locationCatalogOr(planInput.locationCatalog),
      ...(source.locationName ? { locationName: source.locationName } : {}),
      plan: {
        caption: plan.caption,
        hashtags: stringsOr(plan.hashtags) ?? [],
        shots: planShots(plan.shots),
      },
    };
  }

  private async buildPromptInput(claimed: ClaimedEvaluation): Promise<{
    input: PromptEvaluationPromptInput;
    jobIds: Map<number, string>;
  }> {
    const source = await this.repository.loadPromptSource(claimed.draftId);
    if (!source) {
      throw new Error("draft not found for prompt evaluation");
    }
    // 컷별 최신 잡만 평가한다 (검수 화면과 같은 기준). 빈 프롬프트는 아직
    // 빌드 전이므로 제외한다.
    const latestPerShot = new Map<number, PromptEvaluationJob>();
    for (const job of source.jobs) {
      if (!latestPerShot.has(job.sortOrder)) {
        latestPerShot.set(job.sortOrder, job);
      }
    }
    const jobs = [...latestPerShot.values()]
      .filter((job) => job.prompt.trim() !== "")
      .sort((a, b) => a.sortOrder - b.sortOrder);
    if (jobs.length === 0) {
      throw new Error("draft has no built prompts to evaluate");
    }
    const shots = jobs.map((job) => {
      const shotMeta = isRecord(job.paramsJson)
        ? isRecord(job.paramsJson._shot)
          ? job.paramsJson._shot
          : {}
        : {};
      return {
        sortOrder: job.sortOrder,
        scene: stringOr(shotMeta.scene) ?? "",
        captureSetup: stringOr(shotMeta.captureSetup) ?? "",
        characterVisible: shotMeta.characterVisible === true,
        ...(stringOr(shotMeta.targetModelId)
          ? { targetModelId: stringOr(shotMeta.targetModelId) }
          : {}),
        prompt: job.prompt,
        lintIssues: [] as string[],
      };
    });
    const lint = lintPromptShots(
      shots.map((shot) => ({
        sortOrder: shot.sortOrder,
        characterVisible: shot.characterVisible,
        prompt: shot.prompt,
      })),
    );
    for (const shot of shots) {
      shot.lintIssues = (lint.get(shot.sortOrder) ?? []).map(
        (issue) => `[${issue.rule}] ${issue.detail}`,
      );
    }
    return {
      input: { planCaption: source.caption, shots },
      jobIds: new Map(jobs.map((job) => [job.sortOrder, job.id])),
    };
  }

  private async buildImageInput(claimed: ClaimedEvaluation): Promise<{
    input: ImageEvaluationPromptInput;
    outputMediaIds: Map<string, string>;
    jobIds: Map<number, string>;
  }> {
    const source = await this.repository.loadImageSource(claimed.draftId);
    if (!source) throw new Error("draft not found for image evaluation");

    const latestPerShot = new Map<number, (typeof source.jobs)[number]>();
    for (const job of source.jobs) {
      if (!latestPerShot.has(job.sortOrder))
        latestPerShot.set(job.sortOrder, job);
    }
    const jobs = [...latestPerShot.values()].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
    if (jobs.length === 0) {
      throw new Error("draft has no completed image candidates to evaluate");
    }
    if (
      jobs.some((job) => job.status !== "completed" || job.outputs.length === 0)
    ) {
      throw new Error("draft latest image jobs are not all completed");
    }

    const mediaById = new Map(
      source.referenceMedia.map((media) => [media.id, media]),
    );
    const shots = jobs.map((job) => {
      const params = isRecord(job.paramsJson) ? job.paramsJson : {};
      const shotMeta = isRecord(params._shot) ? params._shot : {};
      const media = (ids: string[]) =>
        ids.flatMap((mediaId) => {
          const item = mediaById.get(mediaId);
          return item ? [{ mediaId, ...item }] : [];
        });
      return {
        sortOrder: job.sortOrder,
        scene: stringOr(shotMeta.scene) ?? "",
        captureSetup: stringOr(shotMeta.captureSetup) ?? "",
        prompt: job.prompt,
        identityReferences: media(
          stringsOr(shotMeta.identityReferenceMediaIds) ?? [],
        ),
        environmentReferences: media(
          stringsOr(shotMeta.environmentReferenceMediaIds) ?? [],
        ),
        candidates: job.outputs.map((output) => ({
          mediaId: output.mediaId,
          candidateIndex: output.candidateIndex,
          ...output.media,
        })),
      };
    });
    return {
      input: { caption: source.caption, shots },
      outputMediaIds: new Map(
        jobs.flatMap((job) =>
          job.outputs.map(
            (output) =>
              [
                `${job.sortOrder}:${output.candidateIndex}`,
                output.mediaId,
              ] as const,
          ),
        ),
      ),
      jobIds: new Map(jobs.map((job) => [job.sortOrder, job.id])),
    };
  }

  private async completeV3(
    claimed: ClaimedEvaluation,
    evaluatorVersion: string,
    artifact: Record<string, unknown>,
    result: Record<string, unknown>,
  ): Promise<void> {
    await this.repository.complete({
      evaluationId: claimed.evaluationId,
      evaluatorName: evaluatorVersion,
      overallScore: evaluationAverage(result),
      scoresJson: {
        _meta: {
          evaluatorVersion,
          targetRevision:
            typeof artifact.revision === "number" ? artifact.revision : null,
          targetHash: typeof artifact.hash === "string" ? artifact.hash : null,
        },
        result,
      } as Prisma.InputJsonValue,
      issuesJson: evaluationIssues(result) as Prisma.InputJsonValue,
      suggestionsJson: null,
    });
  }

  private async failV3(
    claimed: ClaimedEvaluation,
    error: unknown,
    label: string,
  ): Promise<void> {
    this.consecutiveFailures += 1;
    await this.repository.fail(claimed.evaluationId, errorMessage(error));
    this.logger.warn(
      `${label} evaluation failed: draft=${claimed.draftId} — ${errorMessage(error)}`,
    );
  }
}

// 점수는 세대마다 다른 깊이에 있다. 텍스트 평가 3종은 `result.scores`가 평면
// `{차원: 숫자}`이고, V3 생성 이미지 평가는 `shots[].dimensions.<차원>.score`와
// `setDimensions.<차원>.score`로 두 단계 더 깊다.
//
// 원래 구현은 `key === "score"`인 키로만 하위로 내려갔다. shot 레코드의 키는
// `sortOrder`/`issues`/`dimensions`뿐이라 거기서 멈췄고, 숫자를 하나도 못 모아
// 0을 반환했다 — 실제 평균이 4.8인데 화면에는 `이미지 심사 0.0/5`.
//
// 고칠 때의 함정: 무작정 전 계층을 순회하면 `sortOrder: 0`을 점수로 주워 담는다.
// 그래서 **내려가는 것은 자유롭게, 수확은 `score` 키에서만** 한다.
export function evaluationAverage(result: Record<string, unknown>): number {
  const numbers: number[] = [];
  const push = (value: unknown): void => {
    if (typeof value === "number" && Number.isFinite(value))
      numbers.push(value);
  };
  const harvest = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(harvest);
      return;
    }
    if (!isRecord(value)) return;
    // 계약이 없어 평가 대상이 아닌 차원은 화면에서도 빠진다 — 평균에도 넣지 않는다.
    if (value.applicable === false) return;
    for (const [key, item] of Object.entries(value)) {
      if (key === "score") push(item);
      else harvest(item);
    }
  };
  if (isRecord(result.scores)) {
    // 평면 `{차원: 숫자}` 또는 `{차원: {score}}` 둘 다 온다.
    for (const score of Object.values(result.scores)) {
      if (typeof score === "number") push(score);
      else harvest(score);
    }
  }
  harvest(result.shots);
  harvest(result.setDimensions);
  return numbers.length
    ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length
    : 0;
}

function evaluationIssues(result: Record<string, unknown>): unknown[] {
  const issues = Array.isArray(result.issues) ? result.issues : [];
  const shotIssues = Array.isArray(result.shots)
    ? result.shots.flatMap((shot) =>
        isRecord(shot) && Array.isArray(shot.issues) ? shot.issues : [],
      )
    : [];
  const setIssues = Array.isArray(result.setIssues) ? result.setIssues : [];
  return [...issues, ...shotIssues, ...setIssues];
}

function selectedSetHash(
  selected: {
    sortOrder: number;
    jobId: string;
    media:
      | { mediaId: string; candidateIndex: number; selected: boolean }
      | undefined;
  }[],
): string {
  return generationSetHash(
    selected.map((item) => ({
      sortOrder: item.sortOrder,
      jobId: item.jobId,
      mediaId: item.media?.mediaId,
    })),
  );
}

async function visionUserContent(
  logicalInput: unknown,
  selected: {
    sortOrder: number;
    media:
      | {
          mediaId: string;
          media: { url: string; storageKey: string | null };
        }
      | undefined;
  }[],
  references: {
    id: string;
    url: string;
    storageKey: string | null;
    contentType: string | null;
  }[],
  readBytes: MediaBytesReader,
): Promise<unknown[]> {
  const assets = [
    ...references.map((media) => ({
      label: `Reference media ${media.id}`,
      media,
    })),
    ...selected.flatMap((item) =>
      item.media
        ? [
            {
              label: `Selected image for shot ${item.sortOrder} media ${item.media.mediaId}`,
              media: {
                id: item.media.mediaId,
                ...item.media.media,
              },
            },
          ]
        : [],
    ),
  ];
  const blocks: unknown[] = [
    { type: "text", text: JSON.stringify(logicalInput) },
  ];
  for (const asset of assets) {
    const { bytes, contentType } = await readBytes(asset.media);
    blocks.push(
      { type: "text", text: asset.label },
      {
        type: "image_url",
        image_url: {
          url: `data:${contentType};base64,${bytes.toString("base64")}`,
          detail: "high",
        },
      },
    );
  }
  return blocks;
}

function stringOr(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringsOr(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
}

function personasOr(value: unknown): { title: string; content: string }[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) =>
    isRecord(item) &&
    typeof item.title === "string" &&
    typeof item.content === "string"
      ? [{ title: item.title, content: item.content }]
      : [],
  );
}

function referenceCatalogOr(
  value: unknown,
): { id: string; description: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = stringOr(item.id);
    const description = stringOr(item.description);
    return id && description ? [{ id, description }] : [];
  });
}

function locationCatalogOr(value: unknown): {
  id: string;
  name: string;
  description: string;
  references: { id: string; description: string }[];
}[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = stringOr(item.id);
    const name = stringOr(item.name);
    if (!id || !name) return [];
    return [
      {
        id,
        name,
        description: stringOr(item.description) ?? "",
        references: referenceCatalogOr(item.references),
      },
    ];
  });
}

function planShots(value: unknown): PlanShot[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item, index) =>
    isRecord(item)
      ? [
          {
            sortOrder:
              typeof item.sortOrder === "number" ? item.sortOrder : index,
            scene: stringOr(item.scene) ?? "",
            captureSetup: stringOr(item.captureSetup) ?? "",
            characterVisible: item.characterVisible === true,
            referenceIds: stringsOr(item.referenceIds) ?? [],
            environmentReferenceIds:
              stringsOr(item.environmentReferenceIds) ?? [],
          },
        ]
      : [],
  );
}
