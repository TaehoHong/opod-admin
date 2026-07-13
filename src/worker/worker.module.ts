import { Module } from "@nestjs/common";
import { PrismaModule } from "../domain/database/prisma.module";
import { PrismaService } from "../domain/database/prisma.service";
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
import { createImageGenerationProvider } from "./image-generation.provider";

// 미디어 생성/드래프트 워커. 당분간 opod-admin 프로세스에서 함께 실행한다
// (docs/media-generation-pipeline.md D1). admin HTTP 모듈에 대한 역참조를
// 두지 않는다 — 추후 별도 이미지 분리 시 엔트리포인트만 추가하면 되는 구조 유지.
@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: GenerationWorkerService,
      useFactory: (prisma: PrismaService) =>
        new GenerationWorkerService(
          prisma,
          createImageGenerationProvider(),
          createGeneratedMediaStore(),
          workerConfigFromEnv(),
        ),
      inject: [PrismaService],
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
})
export class WorkerModule {}
