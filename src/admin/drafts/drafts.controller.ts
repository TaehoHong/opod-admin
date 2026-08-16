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
import { UpdateOperatorRequestDto } from "./dto/update-operator-request.dto";
import { RunStageDto } from "./dto/run-stage.dto";
import { UpdateShotOutputFilterDto } from "./dto/update-shot-output-filter.dto";
import { UpdateDraftPlanDto } from "./dto/update-draft-plan.dto";
import { UpdateDraftPromptsDto } from "./dto/update-draft-prompts.dto";

@Controller("api/admin/v1/drafts")
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
  // 큐에 넣기와 바로 실행은 다른 행동이다. runNow=false면 큐에만 넣고 자동
  // 루프에 맡긴다(루프가 꺼져 있으면 아래 /run으로 운영자가 밀어야 한다).
  @Post(":id/jobs/:jobId/generate")
  async generateShotNow(
    @Param("id") draftId: string,
    @Param("jobId") jobId: string,
    @Body() body: GenerateShotDto,
  ) {
    const { runNow = true, ...queue } = body;
    await this.draftsService.queueShot({ draftId, jobId, ...queue });
    if (runNow) await this.generationWorker.runJobNow(jobId);
    return this.draftsService.getDraft(draftId);
  }

  // 이미 큐에 있는 컷을 지금 실행한다 — 자동 루프가 꺼져 있을 때 운영자가
  // 대기 잡을 미는 버튼. queued가 아니면 400.
  @Post(":id/jobs/:jobId/run")
  async runQueuedShotNow(
    @Param("id") draftId: string,
    @Param("jobId") jobId: string,
  ) {
    await this.draftsService.assertShotBelongsToDraft(draftId, jobId);
    const result = await this.generationWorker.runJobNow(jobId);
    if (!result.jobId) {
      throw new BadRequestException(
        "Only a queued shot can be run now — it may already be running or finished",
      );
    }
    return this.draftsService.getDraft(draftId);
  }

  @Patch(":id")
  updateDraft(@Param("id") draftId: string, @Body() body: UpdateDraftDto) {
    return this.draftsService.updateDraft({ draftId, ...body });
  }

  // 운영자 요청 수정. 검수 편집(PATCH :id)과 상태 조건이 정반대다 — 이건 아직
  // Agent가 돌기 전(planned)이나 실패 후(failed)에 입력을 보완하는 경로다.
  @Patch(":id/operator-request")
  updateOperatorRequest(
    @Param("id") draftId: string,
    @Body() body: UpdateOperatorRequestDto,
  ) {
    return this.draftsService.updateOperatorRequest({ draftId, ...body });
  }

  @Patch(":id/plan")
  updateDraftPlan(
    @Param("id") draftId: string,
    @Body() body: UpdateDraftPlanDto,
  ) {
    return this.draftsService.updatePlan({ draftId, ...body });
  }

  @Patch(":id/prompts")
  updateDraftPrompts(
    @Param("id") draftId: string,
    @Body() body: UpdateDraftPromptsDto,
  ) {
    return this.draftsService.updatePrompts({ draftId, ...body });
  }

  // 수동 기획 실행 — 워커 폴링을 기다리지 않고 이 draft를 즉시 기획한다.
  // 자동 경로와 동일한 claim → planDraft를 타므로 결과(성공/실패)도 동일한
  // 상태 전이로 나타난다. 응답은 기획 반영 후의 draft.
  @Post(":id/plan")
  async planDraftNow(
    @Param("id") draftId: string,
    @Body() body: RunStageDto = {},
  ) {
    const result = await this.draftWorker.planDraftNow(
      draftId,
      body.note?.trim() ? { operatorNote: body.note.trim() } : undefined,
    );
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

  // 수동 집계 — 컷 생성 결과를 지금 집계해 검수(needs_review)로 전환한다.
  // 컷별 최신 잡이 전부 completed여야 하며, 실패 컷이 있으면 failed로 전이된다.
  @Post(":id/aggregate")
  async aggregateDraftNow(@Param("id") draftId: string) {
    const result = await this.draftWorker.aggregateDraftNow(draftId);
    if (!result.aggregated) {
      await this.draftsService.getDraft(draftId); // 404를 400보다 먼저 구분한다.
      throw new BadRequestException(
        result.reason ?? "Only generating drafts can be aggregated for review",
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

  // 재생성도 생성 실행(generate)과 같이 새 잡을 곧바로 돌린다 — 수동 = 자동의
  // 스텝 실행 모드. 큐에만 넣으면 자동 루프가 꺼진 환경에서 영영 안 돈다.
  @Post(":id/jobs/:jobId/regenerate")
  async regenerateShot(
    @Param("id") draftId: string,
    @Param("jobId") jobId: string,
    @Body() body: RegenerateShotDto,
  ) {
    const { runNow = true, ...regenerate } = body;
    const { newJobId } = await this.draftsService.regenerateShot({
      draftId,
      jobId,
      ...regenerate,
    });
    if (runNow) await this.generationWorker.runJobNow(newJobId);
    return this.draftsService.getDraft(draftId);
  }

  @Post(":id/jobs/:jobId/select")
  selectShotOutput(
    @Param("id") draftId: string,
    @Param("jobId") jobId: string,
    @Body() body: SelectShotOutputDto,
  ) {
    return this.draftsService.selectShotOutput({ draftId, jobId, ...body });
  }

  @Patch(":id/jobs/:jobId/outputs/:mediaId/filter")
  updateShotOutputFilter(
    @Param("id") draftId: string,
    @Param("jobId") jobId: string,
    @Param("mediaId") mediaId: string,
    @Body() body: UpdateShotOutputFilterDto,
  ) {
    return this.draftsService.updateShotOutputFilter({
      draftId,
      jobId,
      mediaId,
      ...body,
    });
  }
}
