import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AdminJwtGuard } from "../auth/admin-jwt.guard";
import { CreateEvaluationReportDto } from "./dto/create-evaluation-report.dto";
import { EvaluationsService } from "./evaluations.service";

@Controller("api/admin/v1")
@UseGuards(AdminJwtGuard)
export class EvaluationsController {
  constructor(private readonly evaluations: EvaluationsService) {}

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
