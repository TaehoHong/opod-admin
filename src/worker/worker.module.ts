import { Module } from "@nestjs/common";
import { S3Config } from "../domain/config/app-config";
import { AppConfigService } from "../domain/config/app-config.service";
import { PrismaModule } from "../domain/database/prisma.module";
import { GenerationSettingsService } from "../domain/settings/generation-settings.service";
import { SettingsModule } from "../domain/settings/settings.module";
import { resolveContentPlanner } from "./content-planner";
import { DraftWorkerService } from "./draft-worker.service";
import { DraftWorkerRepository } from "./draft-worker.repository";
import {
  createGeneratedMediaStore,
  createReferenceUrlSigner,
} from "./generated-media-store";
import { EvaluationRepository } from "./evaluation.repository";
import { EvaluationWorkerService } from "./evaluation-worker.service";
import { GenerationWorkerService } from "./generation-worker.service";
import { GenerationJobRepository } from "./generation-job.repository";
import { resolveImageGenerationProviders } from "./image-generation.provider";
import { resolveImagePromptBuilder } from "./image-prompt-builder";
import { resolvePlanEvaluator } from "./plan-evaluator";
import { resolvePromptEvaluator } from "./prompt-evaluator";
import { resolveImageEvaluator } from "./image-evaluator";
import { createMediaBytesReader } from "./reference-captioner";
import { LlmLogService } from "../domain/llm-logs/llm-log.service";
import { PostPipelineV3Runner } from "./post-pipeline-v3.runner";
import { StrictJsonAgentClient } from "./strict-json-agent";

function storageEnv(config: S3Config | undefined) {
  return config
    ? {
        S3_BUCKET: config.bucket,
        AWS_REGION: config.region,
        AWS_ACCESS_KEY_ID: config.accessKeyId,
        AWS_SECRET_ACCESS_KEY: config.secretAccessKey,
        S3_PUBLIC_BASE_URL: config.publicBaseUrl,
      }
    : {};
}

// 미디어 생성/드래프트 워커. 당분간 opod-admin 프로세스에서 함께 실행한다
// (docs/media-generation-pipeline.md D1). admin HTTP 모듈에 대한 역참조를
// 두지 않는다 — 추후 별도 이미지 분리 시 엔트리포인트만 추가하면 되는 구조 유지.
@Module({
  imports: [PrismaModule, SettingsModule],
  providers: [
    GenerationJobRepository,
    DraftWorkerRepository,
    {
      provide: PostPipelineV3Runner,
      useFactory: (
        drafts: DraftWorkerRepository,
        settings: GenerationSettingsService,
        llmLogs: LlmLogService,
        config: AppConfigService,
      ) => new PostPipelineV3Runner(drafts, settings, llmLogs, config),
      inject: [
        DraftWorkerRepository,
        GenerationSettingsService,
        LlmLogService,
        AppConfigService,
      ],
    },
    {
      provide: GenerationWorkerService,
      // 프로바이더는 잡 처리 시마다 재해석 — admin 설정(DB)이 env보다 우선.
      useFactory: (
        jobs: GenerationJobRepository,
        settings: GenerationSettingsService,
        llmLogs: LlmLogService,
        config: AppConfigService,
      ) =>
        new GenerationWorkerService(
          jobs,
          async () =>
            resolveImageGenerationProviders(
              await settings.resolveProviderSettings(),
              fetch,
              llmLogs,
            ),
          createGeneratedMediaStore(storageEnv(config.s3)),
          async () =>
            (await settings.resolveWorkerToggles()).generation.enabled,
          config.worker,
          undefined,
          undefined,
          // 비공개 S3 레퍼런스를 프로바이더가 받을 수 있게 presigned URL로 서명.
          createReferenceUrlSigner(storageEnv(config.s3)) ?? undefined,
          llmLogs,
          // 워커는 값만 필요하다 — 출처(db/default)는 설정 화면 표시용이다.
          async () => {
            const ratios = await settings.resolveAspectRatios();
            return {
              feed: ratios.feed.value,
              story: ratios.story.value,
              reel: ratios.reel.value,
            };
          },
        ),
      inject: [
        GenerationJobRepository,
        GenerationSettingsService,
        LlmLogService,
        AppConfigService,
      ],
    },
    {
      provide: DraftWorkerService,
      // 플래너도 기획 시마다 재해석 — admin 설정(DB)이 env보다 우선.
      useFactory: (
        drafts: DraftWorkerRepository,
        settings: GenerationSettingsService,
        llmLogs: LlmLogService,
        config: AppConfigService,
        v3: PostPipelineV3Runner,
      ) =>
        new DraftWorkerService(
          drafts,
          async () =>
            resolveContentPlanner(
              await settings.resolvePlannerSettings(),
              fetch,
              llmLogs,
            ),
          // 프롬프트 빌더는 기획 LLM 설정을 재사용한다 (캡셔너·위저드 전례).
          // 대상 모델은 edit 우선 — 레퍼런스 있는 캐릭터가 일반 경로.
          async () => {
            const [planner, provider] = await Promise.all([
              settings.resolvePlannerSettings(),
              settings.resolveProviderSettings(),
            ]);
            return resolveImagePromptBuilder(
              planner,
              {
                t2iModelId: provider.t2iModel ?? provider.editModel,
                editModelId: provider.editModel,
              },
              fetch,
              llmLogs,
            );
          },
          // draft 워커는 생성 워커와 같은 토글을 공유한다.
          async () =>
            (await settings.resolveWorkerToggles()).generation.enabled,
          config.draftWorker,
          undefined,
          // 게시 마감본 업로드/원본 읽기 — 생성 워커와 같은 스토어·서명자.
          createGeneratedMediaStore(storageEnv(config.s3)),
          createReferenceUrlSigner(storageEnv(config.s3)),
          undefined,
          undefined,
          async () => (await settings.resolvePipelineV3()).enabled,
          (draftId) => v3.runCurrentStage(draftId),
        ),
      inject: [
        DraftWorkerRepository,
        GenerationSettingsService,
        LlmLogService,
        AppConfigService,
        PostPipelineV3Runner,
      ],
    },
    EvaluationRepository,
    {
      provide: EvaluationWorkerService,
      // 평가자도 실행 시마다 재해석 — evaluator.* 설정(DB) 우선, 미설정은
      // 플래너 상속. 파이프라인 비차단이므로 admin 역참조도 상태 전이도 없다.
      useFactory: (
        evaluations: EvaluationRepository,
        settings: GenerationSettingsService,
        llmLogs: LlmLogService,
        config: AppConfigService,
      ) =>
        new EvaluationWorkerService(
          evaluations,
          async () =>
            resolvePlanEvaluator(
              await settings.resolveEvaluatorSettings(),
              fetch,
              llmLogs,
            ),
          async () =>
            resolvePromptEvaluator(
              await settings.resolveEvaluatorSettings(),
              fetch,
              llmLogs,
            ),
          async () =>
            resolveImageEvaluator(
              await settings.resolveEvaluatorSettings(),
              createMediaBytesReader(config.s3),
              fetch,
              llmLogs,
            ),
          async () =>
            (await settings.resolveWorkerToggles()).evaluation.enabled,
          config.evaluationWorker,
          async () => {
            const resolved = await settings.resolveEvaluatorSettings();
            return resolved.apiUrl && resolved.apiKey && resolved.model
              ? new StrictJsonAgentClient(
                  {
                    apiUrl: resolved.apiUrl,
                    apiKey: resolved.apiKey,
                    model: resolved.model,
                  },
                  fetch,
                  llmLogs,
                )
              : null;
          },
          createMediaBytesReader(config.s3),
        ),
      inject: [
        EvaluationRepository,
        GenerationSettingsService,
        LlmLogService,
        AppConfigService,
      ],
    },
  ],
  // admin의 수동 실행이 주입해 쓴다 — 생성(generation/worker/run), draft 즉시
  // 기획/게시(drafts/:id/plan, drafts/:id/publish), 평가
  // (evaluations/worker/run).
  // EvaluationRepository는 admin 평가 조회·리포트 집계가 함께 쓴다.
  exports: [
    GenerationWorkerService,
    DraftWorkerService,
    EvaluationWorkerService,
    EvaluationRepository,
  ],
})
export class WorkerModule {}
