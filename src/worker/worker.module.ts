import { Module } from "@nestjs/common";
import { PrismaModule } from "../domain/database/prisma.module";
import { PrismaService } from "../domain/database/prisma.service";
import { GenerationSettingsService } from "../domain/settings/generation-settings.service";
import { SettingsModule } from "../domain/settings/settings.module";
import { createContentPlanner } from "./content-planner";
import {
  DraftWorkerService,
  draftWorkerConfigFromEnv,
} from "./draft-worker.service";
import { createGeneratedMediaStore } from "./generated-media-store";
import {
  GenerationWorkerService,
  workerConfigFromEnv,
} from "./generation-worker.service";
import { resolveImageGenerationProviders } from "./image-generation.provider";

// 미디어 생성/드래프트 워커. 당분간 opod-admin 프로세스에서 함께 실행한다
// (docs/media-generation-pipeline.md D1). admin HTTP 모듈에 대한 역참조를
// 두지 않는다 — 추후 별도 이미지 분리 시 엔트리포인트만 추가하면 되는 구조 유지.
@Module({
  imports: [PrismaModule, SettingsModule],
  providers: [
    {
      provide: GenerationWorkerService,
      // 프로바이더는 잡 처리 시마다 재해석 — admin 설정(DB)이 env보다 우선.
      useFactory: (
        prisma: PrismaService,
        settings: GenerationSettingsService,
      ) =>
        new GenerationWorkerService(
          prisma,
          async () =>
            resolveImageGenerationProviders(
              await settings.resolveProviderSettings(),
            ),
          createGeneratedMediaStore(),
          workerConfigFromEnv(),
        ),
      inject: [PrismaService, GenerationSettingsService],
    },
    {
      provide: DraftWorkerService,
      useFactory: (prisma: PrismaService) =>
        new DraftWorkerService(
          prisma,
          createContentPlanner(),
          draftWorkerConfigFromEnv(),
        ),
      inject: [PrismaService],
    },
  ],
  // admin의 수동 실행(POST /api/generation/worker/run)이 주입해 쓴다.
  exports: [GenerationWorkerService],
})
export class WorkerModule {}
