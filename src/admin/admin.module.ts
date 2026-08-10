import { Module } from "@nestjs/common";
import { S3Config } from "../domain/config/app-config";
import { AppConfigService } from "../domain/config/app-config.service";
import { CharactersModule } from "../characters/characters.module";
import { PrismaModule } from "../domain/database/prisma.module";
import { GenerationSettingsService } from "../domain/settings/generation-settings.service";
import { SettingsModule } from "../domain/settings/settings.module";
import { createLlmContentPlanner } from "../worker/content-planner";
import { createReferenceUrlSigner } from "../worker/generated-media-store";
import { resolveImagePromptBuilder } from "../worker/image-prompt-builder";
import { WorkerModule } from "../worker/worker.module";
import { AdminAuthModule } from "./auth/admin-auth.module";
import { AdminAnalyticsRepository } from "./admin-analytics.repository";
import { AdminContentRepository } from "./admin-content.repository";
import { AdminController } from "./admin.controller";
import { AdminCreditPaymentRepository } from "./admin-credit-payment.repository";
import { AdminModerationRepository } from "./admin-moderation.repository";
import { AdminService } from "./admin.service";
import { AdminUserRepository } from "./admin-user.repository";
import { DraftsController } from "./drafts/drafts.controller";
import { DraftsRepository } from "./drafts/drafts.repository";
import { DraftsService } from "./drafts/drafts.service";
import { GenerationRepository } from "./generation/generation.repository";
import { GenerationService } from "./generation/generation.service";
import { FilmFinishController } from "./media/film-finish.controller";
import { FilmFinishService } from "./media/film-finish.service";
import { MediaRepository } from "./media/media.repository";
import { MediaService } from "./media/media.service";
import { AdminSettingsController } from "./settings/admin-settings.controller";
import { SettingsAuditRepository } from "./settings/settings-audit.repository";
import { LlmLogService } from "../domain/llm-logs/llm-log.service";
import { LlmLogsController } from "./llm-logs/llm-logs.controller";
import { TokenUsageRepository } from "./llm-logs/token-usage.repository";
import { TokenUsageService } from "./llm-logs/token-usage.service";
import { LocationsController } from "./locations/locations.controller";
import { LocationsRepository } from "./locations/locations.repository";
import { LocationsService } from "./locations/locations.service";
import { EvaluationsController } from "./evaluations/evaluations.controller";
import { EvaluationsService } from "./evaluations/evaluations.service";
import { PostWorkspaceController } from "./post-workspace/post-workspace.controller";
import { PostWorkspaceRepository } from "./post-workspace/post-workspace.repository";
import { PostWorkspaceService } from "./post-workspace/post-workspace.service";

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

@Module({
  // WorkerModule은 수동 실행(generation/worker/run)용 — 의존 방향은
  // admin → worker만 허용 (역방향 금지, docs/media-generation-pipeline.md D1).
  imports: [
    PrismaModule,
    AdminAuthModule,
    CharactersModule,
    SettingsModule,
    WorkerModule,
  ],
  controllers: [
    AdminController,
    DraftsController,
    AdminSettingsController,
    FilmFinishController,
    LlmLogsController,
    LocationsController,
    EvaluationsController,
    PostWorkspaceController,
  ],
  providers: [
    AdminService,
    AdminUserRepository,
    AdminContentRepository,
    AdminCreditPaymentRepository,
    AdminModerationRepository,
    AdminAnalyticsRepository,
    DraftsService,
    DraftsRepository,
    GenerationRepository,
    SettingsAuditRepository,
    TokenUsageService,
    TokenUsageRepository,
    LocationsService,
    LocationsRepository,
    EvaluationsService,
    PostWorkspaceService,
    PostWorkspaceRepository,
    {
      provide: GenerationService,
      // 위저드 장면 확장 플래너 — draft 기획과 동일한 planner.* 설정을
      // 요청 시마다 재해석한다 (admin 설정 DB > env, 재시작 불필요).
      // 셋 중 하나라도 없으면 null — 위저드는 운영자 원문을 그대로 쓴다.
      useFactory: (
        generation: GenerationRepository,
        settings: GenerationSettingsService,
        llmLogs: LlmLogService,
      ) =>
        new GenerationService(
          generation,
          async () => {
            const resolved = await settings.resolvePlannerSettings();
            const apiUrl = resolved.apiUrl?.trim();
            const apiKey = resolved.apiKey?.trim();
            const model = resolved.model?.trim();
            if (!apiUrl || !apiKey || !model) {
              return null;
            }
            return createLlmContentPlanner(
              { apiUrl, apiKey, model },
              fetch,
              llmLogs,
            );
          },
          // 프롬프트 빌더 — draft 파이프라인과 동일하게 planner.* 설정을
          // 재사용하고, 대상 모델은 edit 우선 (레퍼런스 경로가 일반적).
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
        ),
      inject: [GenerationRepository, GenerationSettingsService, LlmLogService],
    },
    MediaService,
    MediaRepository,
    {
      provide: FilmFinishService,
      // 비공개 S3 원본은 레퍼런스 전달과 동일하게 presigned URL로 읽는다.
      useFactory: (media: MediaRepository, config: AppConfigService) =>
        new FilmFinishService(
          media,
          createReferenceUrlSigner(storageEnv(config.s3)),
        ),
      inject: [MediaRepository, AppConfigService],
    },
  ],
})
export class AdminModule {}
