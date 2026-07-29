import { Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { LlmLogService } from "../llm-logs/llm-log.service";

@Module({
  providers: [PrismaService, LlmLogService],
  exports: [PrismaService, LlmLogService],
})
export class PrismaModule {}
