import { Module } from "@nestjs/common";
import { CharactersModule } from "../characters/characters.module";
import { PrismaModule } from "../domain/database/prisma.module";
import { SettingsModule } from "../domain/settings/settings.module";
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
  providers: [AdminService, DraftsService, GenerationService, MediaService],
})
export class AdminModule {}
