import { Module } from "@nestjs/common";
import { DatabaseModule } from "../core/database/database.module";
import { AiModelRepository } from "./ai-model.repository";
import { AiModelService } from "./ai-model.service";
@Module({
  imports: [DatabaseModule],
  providers: [AiModelRepository, AiModelService],
  exports: [AiModelService],
})
export class AiModelsModule {}
