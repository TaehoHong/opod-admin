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
import { parsePageQuery } from "../domain/database/page";
import { AdminApiKeyGuard } from "./admin-api-key.guard";
import { AdminService } from "./admin.service";

@Controller("api")
@UseGuards(AdminApiKeyGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("characters")
  listCharacters(
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("status") status?: string,
  ) {
    return this.adminService.listCharacters({
      status,
      ...parsePageQuery(cursor, limit),
    });
  }

  @Post("characters")
  createCharacter(
    @Body()
    body: {
      publicId: string;
      displayName: string;
      bio: string;
      interests?: string[];
    },
  ) {
    return this.adminService.createCharacter(body);
  }

  @Patch("characters/:id/status")
  updateCharacterStatus(
    @Param("id") characterId: string,
    @Body()
    body: Omit<Parameters<AdminService["updateCharacterStatus"]>[0], "id">,
  ) {
    return this.adminService.updateCharacterStatus({
      id: characterId,
      ...body,
    });
  }

  @Patch("characters/:id")
  updateCharacter(
    @Param("id") characterId: string,
    @Body()
    body: Omit<Parameters<AdminService["updateCharacter"]>[0], "id">,
  ) {
    return this.adminService.updateCharacter({ id: characterId, ...body });
  }

  @Get("characters/:id/memory")
  listCharacterMemory(@Param("id") characterId: string) {
    return this.adminService.listCharacterMemory(characterId);
  }

  @Post("characters/:id/memory")
  createCharacterMemory(
    @Param("id") characterId: string,
    @Body()
    body: Omit<
      Parameters<AdminService["createCharacterMemory"]>[0],
      "characterId"
    >,
  ) {
    return this.adminService.createCharacterMemory({
      characterId,
      ...body,
    });
  }

  @Post("posts")
  createPost(
    @Body()
    body: Parameters<AdminService["createPost"]>[0],
  ) {
    return this.adminService.createPost(body);
  }

  @Post("posts/:id/comments")
  createPostComment(
    @Param("id") postId: string,
    @Body()
    body: Omit<Parameters<AdminService["createPostComment"]>[0], "postId">,
  ) {
    return this.adminService.createPostComment({ postId, ...body });
  }

  @Post("posts/:id/reactions")
  createPostReaction(
    @Param("id") postId: string,
    @Body()
    body: Omit<Parameters<AdminService["createPostReaction"]>[0], "postId">,
  ) {
    return this.adminService.createPostReaction({ postId, ...body });
  }

  @Post("media/uploads")
  startMediaUpload(
    @Body()
    body: Parameters<AdminService["startMediaUpload"]>[0],
  ) {
    return this.adminService.startMediaUpload(body);
  }

  @Get("media")
  listMedia(
    @Query("mediaType") mediaType?: string,
    @Query("uploaded") uploaded?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.adminService.listMedia({
      mediaType,
      uploaded,
      ...parsePageQuery(cursor, limit),
    });
  }

  @Get("media/:id")
  getMedia(@Param("id") mediaId: string) {
    return this.adminService.getMedia(mediaId);
  }

  @Post("media/:id/confirm-upload")
  confirmMediaUpload(@Param("id") mediaId: string) {
    return this.adminService.confirmMediaUpload(mediaId);
  }

  @Post("credits/grants")
  grantCredits(
    @Body()
    body: Parameters<AdminService["grantCredits"]>[0],
  ) {
    return this.adminService.grantCredits(body);
  }

  @Get("credits/ledger")
  listCreditLedger(
    @Query("userId") userId?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.adminService.listCreditLedger({
      userId,
      ...parsePageQuery(cursor, limit),
    });
  }

  @Get("users")
  listUsers(
    @Query("q") q?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.adminService.listUsers({
      q,
      ...parsePageQuery(cursor, limit),
    });
  }

  @Get("users/:id")
  getUser(@Param("id") userId: string) {
    return this.adminService.getUser(userId);
  }

  @Get("events")
  listEvents(
    @Query("userId") userId?: string,
    @Query("targetType") targetType?: string,
    @Query("targetId") targetId?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.adminService.listEvents({
      userId,
      targetType,
      targetId,
      ...parsePageQuery(cursor, limit),
    });
  }

  @Get("hashtag-preferences")
  listHashtagPreferences(@Query("userId") userId?: string) {
    return this.adminService.listHashtagPreferences({ userId });
  }

  @Post("generation/jobs")
  enqueueGenerationJob(
    @Body()
    body: Parameters<AdminService["enqueueGenerationJob"]>[0],
  ) {
    return this.adminService.enqueueGenerationJob(body);
  }

  @Post("generation/jobs/:id/start")
  startGenerationJob(@Param("id") jobId: string) {
    return this.adminService.startGenerationJob(jobId);
  }

  @Post("generation/jobs/:id/run")
  runGenerationJob(
    @Param("id") jobId: string,
    @Body()
    body: Omit<Parameters<AdminService["runGenerationJob"]>[0], "jobId">,
  ) {
    return this.adminService.runGenerationJob({ jobId, ...body });
  }

  @Post("generation/jobs/:id/retry")
  retryGenerationJob(
    @Param("id") jobId: string,
    @Body()
    body: Omit<Parameters<AdminService["retryGenerationJob"]>[0], "jobId">,
  ) {
    return this.adminService.retryGenerationJob({ jobId, ...body });
  }

  @Post("generation/jobs/:id/complete")
  completeGenerationJob(
    @Param("id") jobId: string,
    @Body()
    body: Omit<Parameters<AdminService["completeGenerationJob"]>[0], "jobId">,
  ) {
    return this.adminService.completeGenerationJob({ jobId, ...body });
  }

  @Get("character-action-logs")
  listCharacterActionLogs() {
    return this.adminService.listCharacterActionLogs();
  }

  @Get("analytics")
  getAnalytics(
    @Query("metric") metric?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.adminService.getAnalytics({ metric, from, to });
  }

  @Get("payments/reconciliation")
  listPaymentReconciliation(
    @Query("status") status?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.adminService.listPaymentReconciliation({ status, from, to });
  }

  @Get("payments/:id")
  getPayment(@Param("id") paymentId: string) {
    return this.adminService.getPayment(paymentId);
  }

  @Get("moderation/reports")
  listReports(
    @Query("status") status?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.adminService.listReports({
      status,
      ...parsePageQuery(cursor, limit),
    });
  }

  @Get("moderation/reports/:id")
  getReport(@Param("id") reportId: string) {
    return this.adminService.getReport(reportId);
  }

  @Patch("moderation/reports/:id")
  updateReport(
    @Param("id") reportId: string,
    @Body()
    body: Omit<Parameters<AdminService["updateReport"]>[0], "reportId">,
  ) {
    return this.adminService.updateReport({ reportId, ...body });
  }
}
