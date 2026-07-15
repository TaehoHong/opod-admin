import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { parsePageQuery } from "../../domain/database/page";
import { DraftWorkerService } from "../../worker/draft-worker.service";
import { GenerationWorkerService } from "../../worker/generation-worker.service";
import { AdminJwtGuard } from "../auth/admin-jwt.guard";
import { DraftsService } from "./drafts.service";
import { CreateDraftDto } from "./dto/create-draft.dto";
import { GenerateShotDto } from "./dto/generate-shot.dto";
import { RegenerateShotDto } from "./dto/regenerate-shot.dto";
import { RejectDraftDto } from "./dto/reject-draft.dto";
import { SelectShotOutputDto } from "./dto/select-shot-output.dto";
import { UpdateDraftDto } from "./dto/update-draft.dto";

@Controller("api/drafts")
@UseGuards(AdminJwtGuard)
export class DraftsController {
  constructor(
    private readonly draftsService: DraftsService,
    // 수동 실행(plan/publish/generate)용 — 의존 방향은 admin → worker만 허용.
    private readonly draftWorker: DraftWorkerService,
    private readonly generationWorker: GenerationWorkerService,
  ) {}

  @Get()
  listDrafts(
    @Query("status") status?: string,
    @Query("characterId") characterId?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.draftsService.listDrafts({
      status,
      characterId,
      ...parsePageQuery(cursor, limit),
    });
  }

  @Get(":id")
  getDraft(@Param("id") draftId: string) {
    return this.draftsService.getDraft(draftId);
  }

  @Post()
  createDraft(@Body() body: CreateDraftDto) {
    return this.draftsService.createDraft(body);
  }

  // 수동 진행 컷 생성 실행 — draft 상태 컷의 프롬프트/후보 수를 (선택) 수정하고
  // queued로 전환한 뒤 즉시 생성 워커에 태운다 (WORKER_ENABLED 무관).
  @Post(":id/jobs/:jobId/generate")
  async generateShotNow(
    @Param("id") draftId: string,
    @Param("jobId") jobId: string,
    @Body() body: GenerateShotDto,
  ) {
    await this.draftsService.queueShot({ draftId, jobId, ...body });
    await this.generationWorker.runJobNow(jobId);
    return this.draftsService.getDraft(draftId);
  }

  @Patch(":id")
  updateDraft(@Param("id") draftId: string, @Body() body: UpdateDraftDto) {
    return this.draftsService.updateDraft({ draftId, ...body });
  }

  // 수동 기획 실행 — 워커 폴링을 기다리지 않고 이 draft를 즉시 기획한다.
  // 자동 경로와 동일한 claim → planDraft를 타므로 결과(성공/실패)도 동일한
  // 상태 전이로 나타난다. 응답은 기획 반영 후의 draft.
  @Post(":id/plan")
  async planDraftNow(@Param("id") draftId: string) {
    const result = await this.draftWorker.planDraftNow(draftId);
    if (!result.planned) {
      await this.draftsService.getDraft(draftId); // 404를 400보다 먼저 구분한다.
      throw new BadRequestException(
        "Only planned drafts of active characters can be planned now",
      );
    }
    return this.draftsService.getDraft(draftId);
  }

  // 수동 프롬프트 빌드 — 기획과 컷 생성 사이의 별도 스텝. draft 상태 컷의
  // 장면(_shot.scene)을 이미지 프롬프트로 변환해 채운다. 재실행 시 덮어쓴다.
  @Post(":id/build-prompts")
  async buildPromptsNow(@Param("id") draftId: string) {
    const result = await this.draftWorker.buildDraftPromptsNow(draftId);
    if (!result.built) {
      await this.draftsService.getDraft(draftId); // 404를 400보다 먼저 구분한다.
      throw new BadRequestException(
        result.reason ??
          "Only drafts with draft-state shots can build prompts now",
      );
    }
    return this.draftsService.getDraft(draftId);
  }

  // 수동 게시 — approved draft를 scheduledAt과 무관하게 즉시 게시한다.
  @Post(":id/publish")
  async publishDraftNow(@Param("id") draftId: string) {
    const result = await this.draftWorker.publishDraftNow(draftId);
    if (!result.published) {
      await this.draftsService.getDraft(draftId); // 404를 400보다 먼저 구분한다.
      throw new BadRequestException(
        result.reason ??
          "Only approved drafts of active characters can be published now",
      );
    }
    return this.draftsService.getDraft(draftId);
  }

  @Post(":id/approve")
  approveDraft(@Param("id") draftId: string) {
    return this.draftsService.approveDraft(draftId);
  }

  @Post(":id/reject")
  rejectDraft(@Param("id") draftId: string, @Body() body: RejectDraftDto) {
    return this.draftsService.rejectDraft({ draftId, ...body });
  }

  @Post(":id/jobs/:jobId/regenerate")
  regenerateShot(
    @Param("id") draftId: string,
    @Param("jobId") jobId: string,
    @Body() body: RegenerateShotDto,
  ) {
    return this.draftsService.regenerateShot({ draftId, jobId, ...body });
  }

  @Post(":id/jobs/:jobId/select")
  selectShotOutput(
    @Param("id") draftId: string,
    @Param("jobId") jobId: string,
    @Body() body: SelectShotOutputDto,
  ) {
    return this.draftsService.selectShotOutput({ draftId, jobId, ...body });
  }
}
