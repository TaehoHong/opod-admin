import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { EvaluationWorkerService } from "../../worker/evaluation-worker.service";
import { AdminJwtGuard } from "../auth/admin-jwt.guard";
import { CreateEvaluationReportDto } from "./dto/create-evaluation-report.dto";
import { EvaluationsService } from "./evaluations.service";

@Controller("api/admin/v1")
@UseGuards(AdminJwtGuard)
export class EvaluationsController {
  constructor(
    private readonly evaluations: EvaluationsService,
    private readonly evaluationWorker: EvaluationWorkerService,
  ) {}

  // 평가 워커 수동 실행 — 자동 루프 토글과 무관하게 대기 중인 평가를 종류별로
  // 1건씩 처리한다. 이미지 생성과 달리 단발 LLM 호출이라 결과를 기다려
  // 무엇을 실행했는지 돌려준다.
  @Post("evaluations/worker/run")
  runEvaluationWorker() {
    return this.evaluationWorker.runOnce();
  }

  @Get("drafts/:id/evaluations")
  listForDraft(@Param("id") draftId: string) {
    return this.evaluations.listForDraft(draftId);
  }

  @Post("evaluation-reports")
  createReport(@Body() body: CreateEvaluationReportDto) {
    return this.evaluations.createReport(body);
  }

  @Get("evaluation-reports")
  listReports(@Query("limit") rawLimit?: string) {
    const limit = rawLimit === undefined ? 20 : Number(rawLimit);
    return this.evaluations.listReports(limit);
  }

  @Get("evaluation-reports/:id")
  getReport(@Param("id") id: string) {
    return this.evaluations.getReport(id);
  }
}
