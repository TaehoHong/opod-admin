import { Module } from "@nestjs/common";
import { LlmLogRepository } from "../llm-logs/llm-log.repository";
import { LlmLogService } from "../llm-logs/llm-log.service";
import { DatabaseService } from "./database.service";

@Module({
  providers: [DatabaseService, LlmLogRepository, LlmLogService],
  exports: [DatabaseService, LlmLogService],
})
export class DatabaseModule {}
