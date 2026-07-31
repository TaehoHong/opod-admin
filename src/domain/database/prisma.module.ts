import { Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { LlmLogRepository } from "../llm-logs/llm-log.repository";
import { LlmLogService } from "../llm-logs/llm-log.service";

@Module({
  providers: [PrismaService, LlmLogRepository, LlmLogService],
  exports: [PrismaService, LlmLogService],
})
export class PrismaModule {}
