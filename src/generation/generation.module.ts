import { Module } from "@nestjs/common";
import { DatabaseModule } from "../core/database/database.module";
import { LlmLogService } from "../llm-logs/llm-log.service";
import { createLlmContentPlanner } from "../post-production/content-planner";
import { resolveImagePromptBuilder } from "../post-production/image-prompt-builder";
import { GenerationSettingsService } from "../settings/generation-settings.service";
import { SettingsModule } from "../settings/settings.module";
import { GenerationRepository } from "./generation.repository";
import { GenerationService } from "./generation.service";

@Module({
  imports: [DatabaseModule, SettingsModule],
  providers: [
    GenerationRepository,
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
  ],
  exports: [GenerationService],
})
export class GenerationModule {}
