import {
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
import { AdminJwtGuard } from "../auth/admin-jwt.guard";
import { DraftsService } from "./drafts.service";
import { CreateDraftDto } from "./dto/create-draft.dto";
import { RegenerateShotDto } from "./dto/regenerate-shot.dto";
import { RejectDraftDto } from "./dto/reject-draft.dto";
import { SelectShotOutputDto } from "./dto/select-shot-output.dto";
import { UpdateDraftDto } from "./dto/update-draft.dto";

@Controller("api/drafts")
@UseGuards(AdminJwtGuard)
export class DraftsController {
  constructor(private readonly draftsService: DraftsService) {}

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

  @Patch(":id")
  updateDraft(@Param("id") draftId: string, @Body() body: UpdateDraftDto) {
    return this.draftsService.updateDraft({ draftId, ...body });
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
