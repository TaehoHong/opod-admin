import { Module } from "@nestjs/common";
import { AdminAuthModule } from "../admin/auth/admin-auth.module";
import { AppConfigService } from "../domain/config/app-config.service";
import { PrismaModule } from "../domain/database/prisma.module";
import { GenerationSettingsService } from "../domain/settings/generation-settings.service";
import { SettingsModule } from "../domain/settings/settings.module";
import {
  createLlmReferenceCaptioner,
  createMediaBytesReader,
} from "../worker/reference-captioner";
import { CharactersController } from "./characters.controller";
import { CharacterRepository } from "./character.repository";
import { CharactersService } from "./characters.service";
import { CharacterProfileImageRepository } from "./character-profile-image.repository";
import { CharacterProfileImageService } from "./character-profile-image.service";
import { PostingPolicyRepository } from "./posting-policy.repository";
import { PostingPolicyService } from "./posting-policy.service";
import { VisualProfileRepository } from "./visual-profile.repository";
import { VisualProfileService } from "./visual-profile.service";
import { LlmLogService } from "../domain/llm-logs/llm-log.service";

@Module({
  imports: [PrismaModule, AdminAuthModule, SettingsModule],
  controllers: [CharactersController],
  providers: [
    CharacterRepository,
    CharactersService,
    CharacterProfileImageRepository,
    CharacterProfileImageService,
    PostingPolicyService,
    PostingPolicyRepository,
    VisualProfileRepository,
    {
      provide: VisualProfileService,
      // 캡셔닝 비전 LLM — 기획 LLM(planner.*) 설정을 호출 시마다 재해석한다.
      // 셋 중 하나라도 없으면 null → 캡셔닝 요청은 400으로 안내된다.
      useFactory: (
        visualProfiles: VisualProfileRepository,
        settings: GenerationSettingsService,
        llmLogs: LlmLogService,
        config: AppConfigService,
      ) => {
        const readBytes = createMediaBytesReader(config.s3);
        return new VisualProfileService(visualProfiles, async () => {
          const resolved = await settings.resolvePlannerSettings();
          const apiUrl = resolved.apiUrl?.trim();
          const apiKey = resolved.apiKey?.trim();
          const model = resolved.model?.trim();
          if (!apiUrl || !apiKey || !model) {
            return null;
          }
          return createLlmReferenceCaptioner(
            { apiUrl, apiKey, model },
            readBytes,
            fetch,
            llmLogs,
          );
        });
      },
      inject: [
        VisualProfileRepository,
        GenerationSettingsService,
        LlmLogService,
        AppConfigService,
      ],
    },
  ],
})
export class CharactersModule {}
