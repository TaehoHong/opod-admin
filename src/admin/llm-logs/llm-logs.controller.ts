import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { parsePageQuery } from "../../domain/database/page";
import { LlmLogService } from "../../domain/llm-logs/llm-log.service";
import { AdminJwtGuard } from "../auth/admin-jwt.guard";
import { TokenUsageService } from "./token-usage.service";

@Controller("api/admin/v1/llm-logs")
@UseGuards(AdminJwtGuard)
export class LlmLogsController {
  constructor(
    private readonly llmLogs: LlmLogService,
    private readonly tokenUsage: TokenUsageService,
  ) {}

  // 토큰 사용량 대시보드. ":id"보다 먼저 선언해야 "usage"가 ID로 잡히지 않는다.
  @Get("usage")
  usage(@Query("days") days?: string) {
    return this.tokenUsage.summarize({ days });
  }

  @Get()
  list(
    @Query("status") status?: string,
    @Query("type") type?: string,
    @Query("provider") provider?: string,
    @Query("model") model?: string,
    @Query("requestId") requestId?: string,
    @Query("generationJobId") generationJobId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.llmLogs.list({
      status,
      type,
      provider,
      model,
      requestId,
      generationJobId,
      from,
      to,
      ...parsePageQuery(cursor, limit),
    });
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.llmLogs.get(id);
  }
}
