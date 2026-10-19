import { AiModelsModule } from "../ai-models/ai-models.module";
import { PostAgentPromptsModule } from "../post-agent-prompts/post-agent-prompts.module";
import { PostGenerationAgentsController } from "../post-generation-agents/post-generation-agents.controller";
import { Module } from "@nestjs/common";
import { S3Config } from "../core/config/app-config";
import { AppConfigService } from "../core/config/app-config.service";
import { CharactersModule } from "../characters/characters.module";
import { DatabaseModule } from "../core/database/database.module";
import { SettingsModule } from "../settings/settings.module";
import { createReferenceUrlSigner } from "../media/generated-media-store";
import { PostProductionModule } from "../post-production/post-production.module";
import { AdminAuthModule } from "../auth/admin-auth.module";
import { AdminAnalyticsRepository } from "./admin-analytics.repository";
import { AdminContentRepository } from "./admin-content.repository";
import { AdminController } from "./admin.controller";
import { AdminCreditPaymentRepository } from "./admin-credit-payment.repository";
import { AdminModerationRepository } from "./admin-moderation.repository";
import { AdminService } from "./admin.service";
import { AdminUserRepository } from "./admin-user.repository";
import { DraftsModule } from "../drafts/drafts.module";
import { GenerationModule } from "../generation/generation.module";
import { DraftsController } from "../drafts/drafts.controller";
import { FilmFinishController } from "../media/film-finish.controller";
import { FilmFinishService } from "../media/film-finish.service";
import { MediaRepository } from "../media/media.repository";
import { MediaService } from "../media/media.service";
import { AdminSettingsController } from "../settings/admin-settings.controller";
import { SettingsAuditRepository } from "../settings/settings-audit.repository";
import { LlmLogsController } from "../llm-logs/llm-logs.controller";
import { TokenUsageRepository } from "../llm-logs/token-usage.repository";
import { TokenUsageService } from "../llm-logs/token-usage.service";
import { LocationsController } from "../locations/locations.controller";
import { LocationsModule } from "../locations/locations.module";
import { PostWorkspaceController } from "../post-workspace/post-workspace.controller";
import { PostWorkspaceRepository } from "../post-workspace/post-workspace.repository";
import { PostWorkspaceService } from "../post-workspace/post-workspace.service";
import { PostReactionRepository } from "./post-reaction.repository";
import { PostReactionService } from "./post-reaction.service";

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
    LocationsModule,
    DatabaseModule,
    DraftsModule,
    GenerationModule,
    AiModelsModule,
    PostAgentPromptsModule,
    AdminAuthModule,
    CharactersModule,
    SettingsModule,
    PostProductionModule,
  ],
  controllers: [
    AdminController,
    PostGenerationAgentsController,
    DraftsController,
    AdminSettingsController,
    FilmFinishController,
    LlmLogsController,
    LocationsController,
    PostWorkspaceController,
  ],
  providers: [
    AdminService,
    AdminUserRepository,
    AdminContentRepository,
    PostReactionRepository,
    PostReactionService,
    AdminCreditPaymentRepository,
    AdminModerationRepository,
    AdminAnalyticsRepository,
    SettingsAuditRepository,
    TokenUsageService,
    TokenUsageRepository,
    PostWorkspaceService,
    PostWorkspaceRepository,
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
