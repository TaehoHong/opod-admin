import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { parsePageQuery } from "../domain/database/page";
import { GenerationWorkerService } from "../worker/generation-worker.service";
import { AdminJwtGuard } from "./auth/admin-jwt.guard";
import { AdminService } from "./admin.service";
import { CompleteGenerationJobDto } from "./dto/complete-generation-job.dto";
import { CreateImageGenerationDraftDto } from "./dto/create-image-generation-draft.dto";
import { CreatePostCommentDto } from "./dto/create-post-comment.dto";
import { CreatePostReactionDto } from "./dto/create-post-reaction.dto";
import { CreatePostDto } from "./dto/create-post.dto";
import { CreateStoryDto } from "./dto/create-story.dto";
import { EnqueueGenerationJobDto } from "./dto/enqueue-generation-job.dto";
import { FailGenerationJobDto } from "./dto/fail-generation-job.dto";
import { GrantCreditsDto } from "./dto/grant-credits.dto";
import { RetryGenerationJobDto } from "./dto/retry-generation-job.dto";
import { RunGenerationJobDto } from "./dto/run-generation-job.dto";
import { RunGenerationWorkerDto } from "./dto/run-generation-worker.dto";
import { SelectGenerationOutputDto } from "./dto/select-generation-output.dto";
import { StartMediaUploadDto } from "./dto/start-media-upload.dto";
import { UpdateImageGenerationDraftDto } from "./dto/update-image-generation-draft.dto";
import { UpdateReportDto } from "./dto/update-report.dto";

@Controller("api")
@UseGuards(AdminJwtGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly generationWorker: GenerationWorkerService,
  ) {}

  @Get("posts")
  listPosts(
    @Query("characterId") characterId?: string,
    @Query("contentType") contentType?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.adminService.listPosts({
      characterId,
      contentType,
      ...parsePageQuery(cursor, limit),
    });
  }

  @Get("posts/:id")
  getPost(@Param("id") postId: string) {
    return this.adminService.getPost(postId);
  }

  @Get("posts/:id/comments")
  listPostComments(
    @Param("id") postId: string,
    @Query("characterId") characterId?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.adminService.listPostComments({
      postId,
      characterId,
      ...parsePageQuery(cursor, limit),
    });
  }

  @Get("posts/:id/reactions")
  listPostReactions(
    @Param("id") postId: string,
    @Query("characterId") characterId?: string,
    @Query("reactionType") reactionType?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.adminService.listPostReactions({
      postId,
      characterId,
      reactionType,
      ...parsePageQuery(cursor, limit),
    });
  }

  @Post("posts")
  createPost(@Body() body: CreatePostDto) {
    return this.adminService.createPost(body);
  }

  @Get("stories")
  listStories(
    @Query("characterId") characterId?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.adminService.listStories({
      characterId,
      ...parsePageQuery(cursor, limit),
    });
  }

  @Get("stories/:id")
  getStory(@Param("id") storyId: string) {
    return this.adminService.getStory(storyId);
  }

  @Post("stories")
  createStory(@Body() body: CreateStoryDto) {
    return this.adminService.createStory(body);
  }

  @Post("posts/:id/comments")
  createPostComment(
    @Param("id") postId: string,
    @Body() body: CreatePostCommentDto,
  ) {
    return this.adminService.createPostComment({ postId, ...body });
  }

  @Post("posts/:id/reactions")
  createPostReaction(
    @Param("id") postId: string,
    @Body() body: CreatePostReactionDto,
  ) {
    return this.adminService.createPostReaction({ postId, ...body });
  }

  @Post("media/uploads")
  startMediaUpload(@Body() body: StartMediaUploadDto) {
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
  grantCredits(@Body() body: GrantCreditsDto) {
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

  @Get("generation/jobs")
  listGenerationJobs(
    @Query("characterId", new ParseUUIDPipe({ optional: true }))
    characterId?: string,
    @Query("status") status?: string,
    @Query("mediaType") mediaType?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.adminService.listGenerationJobs({
      characterId,
      status,
      mediaType,
      ...parsePageQuery(cursor, limit),
    });
  }

  @Get("generation/jobs/:id")
  getGenerationJob(@Param("id", ParseUUIDPipe) jobId: string) {
    return this.adminService.getGenerationJob(jobId);
  }

  @Post("generation/jobs")
  enqueueGenerationJob(@Body() body: EnqueueGenerationJobDto) {
    return this.adminService.enqueueGenerationJob(body);
  }

  @Post("generation/image-jobs/draft")
  createImageGenerationDraft(@Body() body: CreateImageGenerationDraftDto) {
    return this.adminService.createImageGenerationDraft(body);
  }

  @Patch("generation/jobs/:id/draft")
  updateImageGenerationDraft(
    @Param("id", ParseUUIDPipe) jobId: string,
    @Body() body: UpdateImageGenerationDraftDto,
  ) {
    return this.adminService.updateImageGenerationDraft(jobId, body);
  }

  @Post("generation/jobs/:id/confirm")
  confirmImageGenerationDraft(@Param("id", ParseUUIDPipe) jobId: string) {
    return this.adminService.confirmImageGenerationDraft(jobId);
  }

  @Post("generation/jobs/:id/select-output")
  selectGenerationOutput(
    @Param("id", ParseUUIDPipe) jobId: string,
    @Body() body: SelectGenerationOutputDto,
  ) {
    return this.adminService.selectGenerationOutput(jobId, body.mediaId);
  }

  @Post("generation/jobs/:id/regenerate")
  regenerateImageJob(@Param("id", ParseUUIDPipe) jobId: string) {
    return this.adminService.regenerateImageJob(jobId);
  }

  @Post("generation/jobs/:id/start")
  startGenerationJob(@Param("id", ParseUUIDPipe) jobId: string) {
    return this.adminService.startGenerationJob(jobId);
  }

  @Post("generation/jobs/:id/run")
  runGenerationJob(
    @Param("id", ParseUUIDPipe) jobId: string,
    @Body() body: RunGenerationJobDto,
  ) {
    return this.adminService.runGenerationJob({ jobId, ...body });
  }

  @Post("generation/jobs/:id/retry")
  retryGenerationJob(
    @Param("id", ParseUUIDPipe) jobId: string,
    @Body() body: RetryGenerationJobDto,
  ) {
    return this.adminService.retryGenerationJob({ jobId, ...body });
  }

  @Post("generation/jobs/:id/complete")
  completeGenerationJob(
    @Param("id", ParseUUIDPipe) jobId: string,
    @Body() body: CompleteGenerationJobDto,
  ) {
    return this.adminService.completeGenerationJob({ jobId, ...body });
  }

  @Post("generation/jobs/:id/fail")
  failGenerationJob(
    @Param("id", ParseUUIDPipe) jobId: string,
    @Body() body: FailGenerationJobDto,
  ) {
    return this.adminService.failGenerationJob({ jobId, ...body });
  }

  // 워커 수동 실행 — 지정(또는 다음) queued 이미지 잡을 claim하고 백그라운드로
  // 처리한다. WORKER_ENABLED와 무관하게 동작한다 (리허설/즉시 실행용).
  @Post("generation/worker/run")
  async runGenerationWorker(@Body() body: RunGenerationWorkerDto) {
    const result = await this.generationWorker.runJobNow(body.jobId);
    if (body.jobId && !result.jobId) {
      throw new BadRequestException(
        "Generation job is not queued (image jobs only)",
      );
    }
    return result;
  }

  @Get("character-action-logs")
  listCharacterActionLogs(
    @Query("characterId") characterId?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.adminService.listCharacterActionLogs({
      characterId,
      ...parsePageQuery(cursor, limit),
    });
  }

  @Get("analytics/hashtags")
  listTopHashtags(@Query("limit") limit?: string) {
    return this.adminService.listTopHashtags({
      limit: parsePageQuery(undefined, limit ?? "10").limit,
    });
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
  updateReport(@Param("id") reportId: string, @Body() body: UpdateReportDto) {
    return this.adminService.updateReport({ reportId, ...body });
  }
}
