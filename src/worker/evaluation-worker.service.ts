// 평가 워커 — 기획·프롬프트 평가를 비동기·비차단으로 수행한다.
// draft 상태 머신과 게시 파이프라인에 어떤 영향도 주지 않는다
// (docs/plan-prompt-evaluation-agent.md, docs/image-prompt-evaluation-agent.md).
//
// 비용 게이트: 기존 예산·서킷브레이커는 이미지 생성 전용이라 공유하지 않는다.
// 대신 tick당 kind별 1건 + 연속 실패 지수 백오프 + 전용 enable 플래그(기본
// 비활성)로 지출을 제한한다.

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { EVAL_RUBRIC_VERSION } from "../../prompts/plan-evaluator";
import { AppConfig } from "../domain/config/app-config";
import { PlanEvaluationPromptInput, PlanEvaluator } from "./plan-evaluator";
import {
  PromptEvaluationPromptInput,
  PromptEvaluator,
} from "./prompt-evaluator";
import { lintPromptShots } from "./prompt-lint";
import {
  ClaimedEvaluation,
  EvaluationRepository,
  PromptEvaluationJob,
} from "./evaluation.repository";
import { errorMessage, isRecord } from "./value-utils";

export type EvaluationWorkerConfig = AppConfig["evaluationWorker"];

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
    private readonly config: EvaluationWorkerConfig,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled) {
      return;
    }
    this.logger.log(
      `Evaluation worker enabled (rubric=${EVAL_RUBRIC_VERSION})`,
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
    await this.repository.sweepExpiredLeases(new Date());
    // 평가자가 unconfigured면 클레임 없이 조용히 쉰다 — 실패 행을 쌓지 않는다.
    const [planEvaluator, promptEvaluator] = await Promise.all([
      this.resolvePlanEvaluator(),
      this.resolvePromptEvaluator(),
    ]);
    if (
      planEvaluator.name === "unconfigured" &&
      promptEvaluator.name === "unconfigured"
    ) {
      return;
    }
    if (planEvaluator.name !== "unconfigured") {
      await this.evaluateNextPlan(planEvaluator);
    }
    if (promptEvaluator.name !== "unconfigured") {
      await this.evaluateNextPrompt(promptEvaluator);
    }
  }

  private async evaluateNextPlan(evaluator: PlanEvaluator): Promise<void> {
    const claimed = await this.repository.claim(
      "plan",
      this.config.leaseSeconds,
      this.config.maxAttempts,
      EVAL_RUBRIC_VERSION,
    );
    if (!claimed) {
      return;
    }
    try {
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
  }

  private async evaluateNextPrompt(evaluator: PromptEvaluator): Promise<void> {
    const claimed = await this.repository.claim(
      "prompt",
      this.config.leaseSeconds,
      this.config.maxAttempts,
      EVAL_RUBRIC_VERSION,
    );
    if (!claimed) {
      return;
    }
    try {
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
      characterName:
        stringOr(planInput.characterName) ?? source.characterName,
      bio: stringOr(planInput.bio) ?? source.bio,
      interests: stringsOr(planInput.interests) ?? source.interests,
      personas: personasOr(planInput.personas),
      memories: stringsOr(planInput.memories) ?? [],
      recentCaptions: stringsOr(planInput.recentCaptions) ?? [],
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
