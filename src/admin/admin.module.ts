import { Module } from "@nestjs/common";
import { CharactersModule } from "../characters/characters.module";
import { PrismaModule } from "../domain/database/prisma.module";
import { PrismaService } from "../domain/database/prisma.service";
import { GenerationSettingsService } from "../domain/settings/generation-settings.service";
import { SettingsModule } from "../domain/settings/settings.module";
import { createLlmContentPlanner } from "../worker/content-planner";
import { resolveImagePromptBuilder } from "../worker/image-prompt-builder";
import { WorkerModule } from "../worker/worker.module";
import { AdminAuthModule } from "./auth/admin-auth.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { DraftsController } from "./drafts/drafts.controller";
import { DraftsService } from "./drafts/drafts.service";
import { GenerationService } from "./generation/generation.service";
import { MediaService } from "./media/media.service";
import { AdminSettingsController } from "./settings/admin-settings.controller";

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
  controllers: [AdminController, DraftsController, AdminSettingsController],
  providers: [
    AdminService,
    DraftsService,
    {
      provide: GenerationService,
      // 위저드 장면 확장 플래너 — draft 기획과 동일한 planner.* 설정을
      // 요청 시마다 재해석한다 (admin 설정 DB > env, 재시작 불필요).
      // 셋 중 하나라도 없으면 null — 위저드는 운영자 원문을 그대로 쓴다.
      useFactory: (
        prisma: PrismaService,
        settings: GenerationSettingsService,
      ) =>
        new GenerationService(
          prisma,
          async () => {
            const resolved = await settings.resolvePlannerSettings();
            const apiUrl = resolved.apiUrl?.trim();
            const apiKey = resolved.apiKey?.trim();
            const model = resolved.model?.trim();
            if (!apiUrl || !apiKey || !model) {
              return null;
            }
            return createLlmContentPlanner({ apiUrl, apiKey, model });
          },
          // 프롬프트 빌더 — draft 파이프라인과 동일하게 planner.* 설정을
          // 재사용하고, 대상 모델은 edit 우선 (레퍼런스 경로가 일반적).
          async () => {
            const [planner, provider] = await Promise.all([
              settings.resolvePlannerSettings(),
              settings.resolveProviderSettings(),
            ]);
            return resolveImagePromptBuilder(planner, {
              targetModelId: provider.editModel ?? provider.t2iModel,
            });
          },
        ),
      inject: [PrismaService, GenerationSettingsService],
    },
    MediaService,
  ],
})
export class AdminModule {}
