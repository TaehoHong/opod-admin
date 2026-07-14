import { Module } from "@nestjs/common";
import { PrismaModule } from "../domain/database/prisma.module";
import { PrismaService } from "../domain/database/prisma.service";
import { GenerationSettingsService } from "../domain/settings/generation-settings.service";
import { SettingsModule } from "../domain/settings/settings.module";
import { resolveContentPlanner } from "./content-planner";
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
      // 플래너도 기획 시마다 재해석 — admin 설정(DB)이 env보다 우선.
      useFactory: (
        prisma: PrismaService,
        settings: GenerationSettingsService,
      ) =>
        new DraftWorkerService(
          prisma,
          async () =>
            resolveContentPlanner(await settings.resolvePlannerSettings()),
          draftWorkerConfigFromEnv(),
        ),
      inject: [PrismaService, GenerationSettingsService],
    },
  ],
  // admin의 수동 실행이 주입해 쓴다 — 생성(generation/worker/run)과
  // draft 즉시 기획/게시(drafts/:id/plan, drafts/:id/publish).
  exports: [GenerationWorkerService, DraftWorkerService],
})
export class WorkerModule {}
