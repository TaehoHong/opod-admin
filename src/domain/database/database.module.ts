import { Module } from "@nestjs/common";
import { LlmLogRepository } from "../llm-logs/llm-log.repository";
import { LlmLogService } from "../llm-logs/llm-log.service";
import { DatabaseService } from "./database.service";
import { DatabaseTransactionContext } from "./database-transaction-context";

@Module({
  providers: [
    DatabaseService,
    DatabaseTransactionContext,
    LlmLogRepository,
    LlmLogService,
  ],
  exports: [DatabaseService, DatabaseTransactionContext, LlmLogService],
})
export class DatabaseModule {}
