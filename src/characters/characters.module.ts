import { Module } from "@nestjs/common";
import { AdminAuthModule } from "../admin/auth/admin-auth.module";
import { PrismaModule } from "../domain/database/prisma.module";
import { PrismaService } from "../domain/database/prisma.service";
import { GenerationSettingsService } from "../domain/settings/generation-settings.service";
import { SettingsModule } from "../domain/settings/settings.module";
import {
  createLlmReferenceCaptioner,
  createMediaBytesReader,
} from "../worker/reference-captioner";
import { CharactersController } from "./characters.controller";
import { CharactersService } from "./characters.service";
import { PostingPolicyService } from "./posting-policy.service";
import { VisualProfileService } from "./visual-profile.service";

@Module({
  imports: [PrismaModule, AdminAuthModule, SettingsModule],
  controllers: [CharactersController],
  providers: [
    CharactersService,
    PostingPolicyService,
    {
      provide: VisualProfileService,
      // 캡셔닝 비전 LLM — 기획 LLM(planner.*) 설정을 호출 시마다 재해석한다.
      // 셋 중 하나라도 없으면 null → 캡셔닝 요청은 400으로 안내된다.
      useFactory: (
        prisma: PrismaService,
        settings: GenerationSettingsService,
      ) => {
        const readBytes = createMediaBytesReader();
        return new VisualProfileService(prisma, async () => {
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
          );
        });
      },
      inject: [PrismaService, GenerationSettingsService],
    },
  ],
})
export class CharactersModule {}
