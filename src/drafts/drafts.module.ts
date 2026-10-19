import { Module } from "@nestjs/common";
import { DatabaseModule } from "../core/database/database.module";
import { GenerationModule } from "../generation/generation.module";
import { SettingsModule } from "../settings/settings.module";
import { DraftsRepository } from "./drafts.repository";
import { DraftsService } from "./drafts.service";

@Module({
  imports: [DatabaseModule, GenerationModule, SettingsModule],
  providers: [DraftsRepository, DraftsService],
  exports: [DraftsService],
})
export class DraftsModule {}
