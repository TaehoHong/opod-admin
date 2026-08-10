import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import {
  decodeCursor,
  Page,
  PageInput,
  pageFromRows,
} from "../domain/database/page";
import { AdminAnalyticsRepository } from "./admin-analytics.repository";
import {
  AdminContentRepository,
  AdminMediaRecord,
  AdminPostCommentRecord,
  AdminPostReactionRecord,
  AdminPostRecord,
  AdminStoryRecord,
} from "./admin-content.repository";
import {
  AdminCreditLedgerRecord,
  AdminCreditPaymentRepository,
  AdminCreditPurchaseRecord,
  AdminCreditReconciliationSession,
  AdminReconciliationLedgerRow,
  AdminReconciliationRefundRow,
} from "./admin-credit-payment.repository";
import {
  AdminModerationRepository,
  AdminReportRecord,
} from "./admin-moderation.repository";
import {
  AdminHashtagPreferenceRecord,
  AdminUserAccountRecord,
  AdminUserEventRecord,
  AdminUserRecord,
  AdminUserRepository,
} from "./admin-user.repository";
import { GenerationService } from "./generation/generation.service";
import { Media } from "./media/media.service";

const freeCreditTtlDays = 30;

type MediaType = "image" | "video";
type PostContentType = "feed" | "reel";
type ActorType = "character" | "user";
type ReportTargetType = "character" | "post" | "message";
type ReportStatus = "submitted" | "reviewing" | "resolved" | "rejected";
type GenerationRunProvider = "local";
type CreditPurchaseStatus =
  | "pending"
  | "payment_processing"
  | "completed"
  | "failed"
  | "canceled"
  | "refunded"
  | "reversed";
type CreditLedgerType = "grant" | "usage" | "refund_recovery" | "adjustment";
type ReconciliationStatus = "mismatch" | "pending" | "resolved";
type LedgerStatus = "granted" | "missing_grant" | "not_granted";
type ReconciliationIssueCode =
  | "paid_missing_grant"
  | "paid_grant_amount_mismatch"
  | "duplicate_base_grant"
  | "nonpaid_has_grant"
  | "refunded_without_completed_refund"
  | "refund_missing_recovery"
  | "canceled_refund_has_recovery"
  | "refund_total_exceeds_payment";
const analyticsMetricNames = [
  "events.count",
  "messages.count",
  "credits.granted",
  "credits.debited",
  "generation_jobs.count",
] as const;
type AnalyticsMetricName = (typeof analyticsMetricNames)[number];

type AdminUser = {
  id: string;
  displayName: string;
  email?: string;
  followCount: number;
  creditBalance: number;
  createdAt: string;
};

type AdminSocialAccount = {
  provider: string;
  email?: string;
  linkedAt: string;
};

type AdminUserDetail = AdminUser & { socialAccounts: AdminSocialAccount[] };

type AdminUserEvent = {
  id: string;
  userId: string;
  eventType: string;
  targetType: string;
  targetId: string;
  metadata?: unknown;
  createdAt: string;
};

type AdminHashtagPreference = {
  userId: string;
  hashtag: string;
  score: number;
  updatedAt: string;
};

type DirectMediaInput = {
  mediaType: MediaType;
  url: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
};

type StoredMediaInput = {
  mediaId: string;
};

type AdminPost = {
  id: string;
  characterId: string;
  contentType: PostContentType;
  content: string;
  media: DirectMediaInput[];
  hashtags: string[];
  commentCount: number;
  reactionCount: number;
  createdAt: string;
};

type AdminStory = {
  id: string;
  characterId: string;
  caption: string;
  media: DirectMediaInput;
  createdAt: string;
  expiresAt: string;
};

// 댓글/리액션 액터는 캐릭터 또는 사용자다 (canonical 스키마의 nullable 쌍).
type AdminPostComment = {
  id: string;
  postId: string;
  characterId?: string;
  userId?: string;
  body: string;
  createdAt: string;
};

type AdminPostReaction = {
  id: string;
  postId: string;
  characterId?: string;
  userId?: string;
  reactionType: string;
  createdAt: string;
};

// 원장 방향. 실제 원장 type은 넷이지만 지급은 grant 하나뿐이라
// 운영 화면에는 지급/차감으로 접어 보여주고 원본 type을 ledgerType으로 함께 준다.
type CreditEntryType = "grant" | "debit";

type CreditEntry = {
  id: string;
  userId: string;
  entryType: CreditEntryType;
  ledgerType: CreditLedgerType;
  creditKind?: "free" | "paid";
  purchaseId?: string;
  promotionCode?: string;
  amount: number;
  reason: string;
  externalReference?: string;
  createdAt: string;
};

// provider와 결제 금액은 payments 행에서 온다. 체크아웃 전 구매에는 결제 행이
// 없어서 값이 비므로, 없는 값을 지어내지 않고 optional로 둔다.
type PaymentReconciliationItem = {
  paymentId: string;
  userId: string;
  provider?: string;
  providerStatus: CreditPurchaseStatus;
  paymentStatus?: PaymentStatus;
  creditAmount: number;
  paidAmount?: number;
  currency?: string;
  ledgerStatus: LedgerStatus;
  reason?: string;
  issueCodes?: ReconciliationIssueCode[];
  repairActions?: ReconciliationActionType[];
};

type PaymentStatus =
  | "pending"
  | "verified"
  | "processing"
  | "paid"
  | "failed"
  | "canceled"
  | "partially_refunded"
  | "refunded"
  | "reversed";

type AdminPayment = {
  id: string;
  userId: string;
  provider?: string;
  status: CreditPurchaseStatus;
  paymentStatus?: PaymentStatus;
  creditAmount: number;
  paidAmount?: number;
  currency?: string;
  createdAt: string;
  updatedAt: string;
};

type ReconciliationActionType =
  | "grant_missing_purchase"
  | "recover_nonpaid_grants"
  | "recover_duplicate_grants"
  | "recover_completed_refund";

type ReconciliationActionReceipt = {
  reference: string;
  action: ReconciliationActionType;
  purchaseId: string;
  grantedCredits: number;
  recoveredCredits: number;
  debtAdded: number;
};

type PaymentReconciliationRow = PaymentReconciliationItem & {
  reconciliationStatus: ReconciliationStatus;
};

type AdminReport = {
  id: string;
  reporterUserId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  details?: string;
  resolution?: string;
  status: ReportStatus;
  createdAt: string;
  updatedAt: string;
};

type ReportUpdateReceipt = {
  id: string;
  status: ReportStatus;
  updatedAt: string;
};

type CreatedAtWhere = {
  createdAt?: {
    gte?: Date;
    lte?: Date;
  };
};

@Injectable()
export class AdminService {
  constructor(
    private readonly userRepository: AdminUserRepository,
    private readonly contentRepository: AdminContentRepository,
    private readonly creditPaymentRepository: AdminCreditPaymentRepository,
    private readonly moderationRepository: AdminModerationRepository,
    private readonly analyticsRepository: AdminAnalyticsRepository,
    private readonly generationService: GenerationService,
  ) {}

  async listUsers(input: { q?: string } & PageInput): Promise<Page<AdminUser>> {
    const term = input.q?.trim();
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.userRepository.hasUserCursor(cursorId, term))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const users = await this.userRepository.listUsers({
      term,
      cursorId,
      limit: input.limit,
    });
    const balances = await this.userRepository.getSpendableBalances(
      users.map((user) => user.id),
      new Date(),
    );
    return pageFromRows(
      users.map((user) => {
        const balance = balances.get(user.id);
        return this.toAdminUser(
          user,
          Math.max(0, (balance?.granted ?? 0) - (balance?.reserved ?? 0)),
        );
      }),
      input.limit,
    );
  }

  async getUser(userId: string): Promise<AdminUserDetail> {
    const user = await this.userRepository.getUser(userId);
    if (!user) {
      throw new BadRequestException("User not found");
    }
    const [balances, accounts] = await Promise.all([
      this.userRepository.getSpendableBalances([userId], new Date()),
      this.userRepository.listUserAccounts(userId),
    ]);
    const balance = balances.get(userId);
    return {
      ...this.toAdminUser(user, 0),
      creditBalance: Math.max(
        0,
        (balance?.granted ?? 0) - (balance?.reserved ?? 0),
      ),
      socialAccounts: accounts.map((account) => this.toSocialAccount(account)),
    };
  }

  async listEvents(
    input: {
      userId?: string;
      targetType?: string;
      targetId?: string;
    } & PageInput,
  ): Promise<Page<AdminUserEvent>> {
    const where = {
      ...(input.userId?.trim() ? { userId: input.userId.trim() } : {}),
      ...(input.targetType?.trim()
        ? { targetType: input.targetType.trim() }
        : {}),
      ...(input.targetId?.trim() ? { targetId: input.targetId.trim() } : {}),
    };
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.userRepository.hasEventCursor(cursorId, where))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const events = await this.userRepository.listEvents({
      filters: where,
      cursorId,
      limit: input.limit,
    });
    return pageFromRows(
      events.map((event) => this.toUserEvent(event)),
      input.limit,
    );
  }

  async listHashtagPreferences(input: {
    userId?: string;
  }): Promise<{ items: AdminHashtagPreference[] }> {
    const userId = input.userId?.trim();
    const preferences =
      await this.userRepository.listHashtagPreferences(userId);
    return {
      items: preferences.map((preference) =>
        this.toHashtagPreference(preference),
      ),
    };
  }

  async listTopHashtags(input: { limit: number }): Promise<{
    items: Array<{ hashtag: string; postCount: number }>;
  }> {
    const hashtags = await this.userRepository.listTopHashtags(input.limit);
    return {
      items: hashtags.map((hashtag) => ({
        hashtag: hashtag.name,
        postCount: hashtag._count.posts,
      })),
    };
  }

  async listMedia(
    input: { mediaType?: string; uploaded?: string } & PageInput,
  ): Promise<Page<Media>> {
    const mediaType = this.parseOptionalMediaType(input.mediaType);
    const uploaded = this.parseOptionalBoolean(input.uploaded, "uploaded");
    const filters = { mediaType, uploaded };
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.contentRepository.hasMediaCursor(cursorId, filters))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const media = await this.contentRepository.listMedia({
      filters,
      cursorId,
      limit: input.limit,
    });
    return pageFromRows(
      media.map((item) => this.toMedia(item)),
      input.limit,
    );
  }

  async getMedia(mediaId: string): Promise<Media> {
    const media = await this.contentRepository.getMedia(mediaId);
    if (!media) {
      throw new BadRequestException("Media not found");
    }
    return this.toMedia(media);
  }

  async listPosts(
    input: { characterId?: string; contentType?: string } & PageInput,
  ): Promise<Page<AdminPost>> {
    const characterId = input.characterId?.trim();
    const contentType = input.contentType?.trim()
      ? this.parsePostContentType(input.contentType.trim())
      : undefined;
    const where = {
      ...(characterId ? { characterId } : {}),
      ...(contentType ? { contentType } : {}),
    };
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.contentRepository.hasPostCursor(cursorId, where))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const posts = await this.contentRepository.listPosts({
      filters: where,
      cursorId,
      limit: input.limit,
    });
    return pageFromRows(
      posts.map((post) => this.toPost(post)),
      input.limit,
    );
  }

  async getPost(postId: string): Promise<AdminPost> {
    const post = await this.contentRepository.getPost(postId);
    if (!post) {
      throw new BadRequestException("Post not found");
    }
    return this.toPost(post);
  }

  async createPost(input: {
    actorType: ActorType;
    actorId: string;
    contentType?: PostContentType;
    content: string;
    reason?: string;
    hashtags?: string[];
    media: Array<DirectMediaInput | StoredMediaInput>;
  }) {
    if (input.actorType !== "character") {
      throw new BadRequestException("Users cannot create public posts");
    }
    if (input.media.length === 0) {
      throw new BadRequestException("Posts require at least one media item");
    }
    if (!(await this.hasCharacter(input.actorId))) {
      throw new BadRequestException("Character not found");
    }

    const contentType = this.parsePostContentType(input.contentType ?? "feed");
    await this.assertStoredMedia(input.media);
    const hashtags = this.cleanHashtags(input.hashtags);
    const post = this.toPost(
      await this.contentRepository.createPost({
        characterId: input.actorId,
        contentType,
        content: input.content,
        hashtags,
        media: input.media,
      }),
    );
    await this.recordCharacterActionLog({
      characterId: post.characterId,
      actionType: "POST_CREATED",
      targetTable: "posts",
      targetId: post.id,
      reason: input.reason?.trim() || "post created",
    });
    return post;
  }

  async listStories(
    input: { characterId?: string } & PageInput,
  ): Promise<Page<AdminStory>> {
    const characterId = input.characterId?.trim();
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.contentRepository.hasStoryCursor(cursorId, characterId))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const stories = await this.contentRepository.listStories({
      characterId,
      cursorId,
      limit: input.limit,
    });
    return pageFromRows(
      stories.map((story) => this.toStory(story)),
      input.limit,
    );
  }

  async getStory(storyId: string): Promise<AdminStory> {
    const story = await this.contentRepository.getStory(storyId);
    if (!story) {
      throw new BadRequestException("Story not found");
    }
    return this.toStory(story);
  }

  async createStory(input: {
    characterId: string;
    caption?: string;
    reason?: string;
    media: DirectMediaInput | StoredMediaInput;
  }): Promise<AdminStory> {
    if (!(await this.hasCharacter(input.characterId))) {
      throw new BadRequestException("Character not found");
    }

    await this.assertStoredMedia([input.media]);
    const story = this.toStory(
      await this.contentRepository.createStory({
        characterId: input.characterId,
        caption: input.caption?.trim() ?? "",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        media: input.media,
      }),
    );
    await this.recordCharacterActionLog({
      characterId: story.characterId,
      actionType: "STORY_CREATED",
      targetTable: "stories",
      targetId: story.id,
      reason: input.reason?.trim() || "story created",
    });
    return story;
  }

  async listPostComments(
    input: { postId: string; characterId?: string } & PageInput,
  ): Promise<Page<AdminPostComment>> {
    if (!(await this.hasPost(input.postId))) {
      throw new BadRequestException("Post not found");
    }
    const characterId = input.characterId?.trim();
    const where = {
      postId: input.postId,
      ...(characterId ? { characterId } : {}),
    };
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.contentRepository.hasCommentCursor(cursorId, where))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const comments = await this.contentRepository.listComments({
      filters: where,
      cursorId,
      limit: input.limit,
    });
    return pageFromRows(
      comments.map((comment) => this.toPostComment(comment)),
      input.limit,
    );
  }

  async createPostComment(input: {
    postId: string;
    characterId: string;
    body: string;
    reason?: string;
  }): Promise<AdminPostComment> {
    const body = input.body?.trim();
    if (!body) {
      throw new BadRequestException("Comment body is required");
    }
    if (!(await this.hasPost(input.postId))) {
      throw new BadRequestException("Post not found");
    }
    if (!(await this.hasCharacter(input.characterId))) {
      throw new BadRequestException("Character not found");
    }

    const comment = this.toPostComment(
      await this.contentRepository.createComment({
        postId: input.postId,
        characterId: input.characterId,
        body,
      }),
    );
    await this.recordCharacterActionLog({
      characterId: input.characterId,
      actionType: "POST_COMMENT_CREATED",
      targetTable: "post_comments",
      targetId: comment.id,
      reason: input.reason?.trim() || "post comment created",
    });
    return comment;
  }

  async listPostReactions(
    input: {
      postId: string;
      characterId?: string;
      reactionType?: string;
    } & PageInput,
  ): Promise<Page<AdminPostReaction>> {
    if (!(await this.hasPost(input.postId))) {
      throw new BadRequestException("Post not found");
    }
    const characterId = input.characterId?.trim();
    const reactionType = input.reactionType?.trim();
    const where = {
      postId: input.postId,
      ...(characterId ? { characterId } : {}),
      ...(reactionType ? { reactionType } : {}),
    };
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.contentRepository.hasReactionCursor(cursorId, where))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const reactions = await this.contentRepository.listReactions({
      filters: where,
      cursorId,
      limit: input.limit,
    });
    return pageFromRows(
      reactions.map((reaction) => this.toPostReaction(reaction)),
      input.limit,
    );
  }

  async createPostReaction(input: {
    postId: string;
    characterId: string;
    reactionType: string;
    reason?: string;
  }): Promise<AdminPostReaction> {
    const reactionType = input.reactionType?.trim();
    if (!reactionType) {
      throw new BadRequestException("Reaction type is required");
    }
    if (!(await this.hasPost(input.postId))) {
      throw new BadRequestException("Post not found");
    }
    if (!(await this.hasCharacter(input.characterId))) {
      throw new BadRequestException("Character not found");
    }

    const reaction = this.toPostReaction(
      await this.contentRepository.createReaction({
        postId: input.postId,
        characterId: input.characterId,
        reactionType,
      }),
    );
    await this.recordCharacterActionLog({
      characterId: input.characterId,
      actionType: "POST_REACTION_CREATED",
      targetTable: "post_reactions",
      targetId: reaction.id,
      reason: input.reason?.trim() || "post reaction created",
    });
    return reaction;
  }

  grantCredits(input: {
    userId: string;
    amount: number;
    reason: string;
    externalReference?: string;
    creditKind?: "free" | "paid";
    purchaseId?: string;
    promotionCode?: string;
  }) {
    return this.appendCreditEntry("grant", input);
  }

  async listCreditLedger(
    input: { userId?: string } & PageInput,
  ): Promise<Page<CreditEntry>> {
    const userId = input.userId?.trim();
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.creditPaymentRepository.hasLedgerCursor(cursorId, userId))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const entries = await this.creditPaymentRepository.listLedger({
      userId,
      cursorId,
      limit: input.limit,
    });
    return pageFromRows(
      entries.map((entry) => this.toCreditEntry(entry)),
      input.limit,
    );
  }

  async createImageGenerationDraft(
    input: Parameters<GenerationService["createImageDraft"]>[0],
  ) {
    const job = await this.generationService.createImageDraft(input);
    await this.recordCharacterActionLog({
      characterId: job.characterId,
      actionType: "GENERATION_DRAFT_CREATED",
      targetTable: "generation_jobs",
      targetId: job.id,
      reason: "generation draft created",
    });
    return job;
  }

  async regenerateImageJob(jobId: string) {
    const job = await this.generationService.regenerateImageJob(jobId);
    await this.recordCharacterActionLog({
      characterId: job.characterId,
      actionType: "GENERATION_JOB_REGENERATED",
      targetTable: "generation_jobs",
      targetId: job.id,
      reason: `generation job regenerated from ${jobId}`,
    });
    return job;
  }

  async enqueueGenerationJob(
    input: Parameters<GenerationService["enqueueJob"]>[0],
  ) {
    const job = await this.generationService.enqueueJob(input);
    await this.recordCharacterActionLog({
      characterId: job.characterId,
      actionType: "GENERATION_JOB_ENQUEUED",
      targetTable: "generation_jobs",
      targetId: job.id,
      reason: "generation job queued",
    });
    return job;
  }

  async startGenerationJob(jobId: string) {
    const job = await this.generationService.startJob(jobId);
    await this.recordCharacterActionLog({
      characterId: job.characterId,
      actionType: "GENERATION_JOB_STARTED",
      targetTable: "generation_jobs",
      targetId: job.id,
      reason: "generation job started",
    });
    return job;
  }

  async runGenerationJob(input: {
    jobId: string;
    provider?: string;
  }): Promise<{ id: string; status: "running" }> {
    const provider = this.parseGenerationRunProvider(input.provider);
    const job = await this.generationService.startJob(input.jobId);
    await this.recordCharacterActionLog({
      characterId: job.characterId,
      actionType: "GENERATION_JOB_RUN",
      targetTable: "generation_jobs",
      targetId: job.id,
      reason: `generation job run requested via ${provider} provider`,
    });
    return {
      id: job.id,
      status: "running",
    };
  }

  async retryGenerationJob(input: { jobId: string; reason?: string }) {
    return this.generationService.retryJob(input.jobId, input.reason);
  }

  async completeGenerationJob(
    input: Parameters<GenerationService["completeJob"]>[0],
  ) {
    const job = await this.generationService.completeJob(input);
    await this.recordCharacterActionLog({
      characterId: job.characterId,
      actionType: "GENERATION_JOB_COMPLETED",
      targetTable: "generation_jobs",
      targetId: job.id,
      reason: "generation job completed",
    });
    return job;
  }

  async failGenerationJob(input: { jobId: string; errorMessage?: string }) {
    const errorMessage =
      input.errorMessage?.trim() || "failed manually by admin";
    const job = await this.generationService.failJob({
      jobId: input.jobId,
      errorMessage,
    });
    await this.recordCharacterActionLog({
      characterId: job.characterId,
      actionType: "GENERATION_JOB_FAILED",
      targetTable: "generation_jobs",
      targetId: job.id,
      reason: errorMessage,
    });
    return job;
  }

  // 워커 자동화로 로그량이 커지므로 커서 페이지네이션 + 캐릭터 필터를 지원한다.
  async listCharacterActionLogs(
    input: { characterId?: string } & Partial<PageInput> = {},
  ) {
    const limit = input.limit ?? 50;
    const characterId = input.characterId?.trim();
    const cursorId = decodeCursor(input.cursor);
    let cursor: bigint | undefined;
    if (cursorId !== undefined) {
      try {
        cursor = BigInt(cursorId);
      } catch {
        throw new BadRequestException("Invalid cursor");
      }
    }

    const logs = await this.contentRepository.listCharacterActions({
      characterId,
      cursor,
      limit,
    });
    return pageFromRows(
      logs.map((log) => ({
        id: log.id.toString(),
        characterId: log.characterId,
        actionType: log.actionType,
        targetTable: log.targetTable ?? undefined,
        targetId: log.targetId ?? undefined,
        reason: log.reason,
        createdAt: log.createdAt.toISOString(),
      })),
      limit,
    );
  }

  async getAnalytics(input: {
    metric?: string;
    from?: string;
    to?: string;
  }): Promise<{
    metrics: Array<{ name: AnalyticsMetricName; value: number }>;
  }> {
    const metric = this.parseAnalyticsMetric(input.metric);
    const where = this.parseCreatedAtWhere(input.from, input.to);
    const createdAt = where.createdAt;
    const descriptors: Array<[AnalyticsMetricName, () => Promise<number>]> = [
      ["events.count", () => this.analyticsRepository.countEvents(createdAt)],
      [
        "messages.count",
        () => this.analyticsRepository.countMessages(createdAt),
      ],
      [
        "credits.granted",
        () => this.analyticsRepository.sumCredits("grant", createdAt),
      ],
      [
        "credits.debited",
        () => this.analyticsRepository.sumCredits("debit", createdAt),
      ],
      [
        "generation_jobs.count",
        () => this.analyticsRepository.countGenerationJobs(createdAt),
      ],
    ];
    const selected = metric
      ? descriptors.filter(([name]) => name === metric)
      : descriptors;
    return {
      metrics: await Promise.all(
        selected.map(async ([name, read]) => ({ name, value: await read() })),
      ),
    };
  }

  async listPaymentReconciliation(input: {
    status?: string;
    from?: string;
    to?: string;
  }): Promise<{ items: PaymentReconciliationItem[] }> {
    const status = this.parseReconciliationStatus(input.status);
    const purchases = await this.creditPaymentRepository.listPurchases(
      this.parsePaymentCreatedAtWhere(input.from, input.to).createdAt,
    );
    const purchaseIds = purchases.map((purchase) => purchase.id);
    const { entries, refunds } =
      await this.creditPaymentRepository.listReconciliationEvidence(
        purchaseIds,
      );

    return {
      items: purchases
        .map((purchase) =>
          this.toPaymentReconciliationRow(
            purchase,
            entries.filter((entry) => entry.purchaseId === purchase.id),
            refunds.filter((refund) => refund.purchaseId === purchase.id),
          ),
        )
        .filter((item) => !status || item.reconciliationStatus === status)
        .map((item) => ({
          paymentId: item.paymentId,
          userId: item.userId,
          ...(item.provider ? { provider: item.provider } : {}),
          providerStatus: item.providerStatus,
          ...(item.paymentStatus ? { paymentStatus: item.paymentStatus } : {}),
          creditAmount: item.creditAmount,
          ...(item.paidAmount !== undefined
            ? { paidAmount: item.paidAmount }
            : {}),
          ...(item.currency ? { currency: item.currency } : {}),
          ledgerStatus: item.ledgerStatus,
          ...(item.reason ? { reason: item.reason } : {}),
          ...(item.issueCodes?.length ? { issueCodes: item.issueCodes } : {}),
          ...(item.repairActions?.length
            ? { repairActions: item.repairActions }
            : {}),
        })),
    };
  }

  async getPayment(paymentId: string): Promise<AdminPayment> {
    const payment = await this.creditPaymentRepository.getPayment(paymentId);
    if (!payment) {
      throw new BadRequestException("Payment not found");
    }
    return this.toPayment(payment);
  }

  async reconcilePayment(input: {
    adminId: string;
    purchaseId: string;
    action: ReconciliationActionType;
    reference: string;
    reason: string;
  }): Promise<ReconciliationActionReceipt> {
    const reference = input.reference?.trim();
    const reason = input.reason?.trim();
    if (!reference || !reason) {
      throw new BadRequestException(
        "Reconciliation reference and reason are required",
      );
    }

    const purchase = await this.creditPaymentRepository.getPayment(
      input.purchaseId,
    );
    if (!purchase) {
      throw new BadRequestException("Payment not found");
    }

    // 멱등성은 별도 액션 테이블 대신 원장의 external_reference UNIQUE 제약에
    // 얹는다. 네 액션 모두 원장 행을 정확히 하나 남기므로, 같은 reference로
    // 다시 들어오면 그 행에서 영수증을 그대로 복원할 수 있다.
    const anchorReference = `credit_reconciliation:${reference}`;
    return this.creditPaymentRepository.withReconciliationTransaction(
      purchase.userId,
      reference,
      async (session) => {
        const existing = await session.findLedgerByReference(anchorReference);
        if (existing) {
          if (existing.purchaseId !== purchase.id) {
            throw new ConflictException(
              "Reconciliation reference is already used",
            );
          }
          return this.receiptFromLedger(reference, input.action, existing);
        }

        const ledger = await session.listPurchaseLedger(purchase.id);
        const grants = ledger.filter((entry) => entry.type === "grant");

        if (input.action === "grant_missing_purchase") {
          if (purchase.status !== "completed") {
            throw new ConflictException("Payment is not completed");
          }
          const baseGrants = grants.filter(
            (grant) =>
              grant.creditKind === "paid" && grant.promotionCode === null,
          );
          if (baseGrants.length > 0) {
            throw new ConflictException("Payment already has a base grant");
          }

          // 미수(음수 유료 잔액)는 별도 컬럼이 아니라 이 구매의 회수 원장이
          // 지급분을 초과한 만큼으로 계산된다. 지급 행을 새로 넣으면 잔액
          // 계산에서 자동으로 상계되므로 여기서 따로 만질 것이 없다.
          const created = await session.createLedgerEntry({
            userId: purchase.userId,
            purchaseId: purchase.id,
            type: "grant",
            creditKind: "paid",
            amount: purchase.creditAmount,
            reason,
            externalReference: anchorReference,
          });
          return this.receiptFromLedger(reference, input.action, created);
        }

        // 환불 회수 행은 반드시 credit_refund:<환불 id>를 참조로 달아야 한다.
        // 정산 탐지도 canonical 크레딧 서비스도 그 참조로 회수 여부를 읽는다.
        if (input.action === "recover_completed_refund") {
          const pending = await this.pendingRefundRecoveries(
            session,
            purchase.id,
            ledger,
          );
          for (const refund of pending) {
            await session.createLedgerEntry({
              userId: purchase.userId,
              purchaseId: purchase.id,
              type: "refund_recovery",
              creditKind: "paid",
              amount: refund.recoveryAmount,
              reason,
              externalReference: `credit_refund:${refund.id}`,
            });
          }
          return {
            reference,
            action: input.action,
            purchaseId: purchase.id,
            grantedCredits: 0,
            recoveredCredits: pending.reduce(
              (sum, refund) => sum + refund.recoveryAmount,
              0,
            ),
            debtAdded: pending.reduce(
              (sum, refund) => sum + refund.debtAmount,
              0,
            ),
          };
        }

        const recovery = await this.plannedGrantRecovery(
          session,
          input.action,
          purchase,
          grants,
        );
        const created = await session.createLedgerEntry({
          userId: purchase.userId,
          purchaseId: purchase.id,
          type: "refund_recovery",
          creditKind: "paid",
          amount: recovery.amount,
          reason,
          externalReference: anchorReference,
        });
        return {
          ...this.receiptFromLedger(reference, input.action, created),
          debtAdded: recovery.debtAdded,
        };
      },
    );
  }

  // 회수할 금액과, 그중 남은 지급분으로 덮이지 않아 미수로 남는 금액을 정한다.
  private async plannedGrantRecovery(
    session: AdminCreditReconciliationSession,
    action: Extract<
      ReconciliationActionType,
      "recover_nonpaid_grants" | "recover_duplicate_grants"
    >,
    purchase: AdminCreditPurchaseRecord,
    grants: AdminCreditLedgerRecord[],
  ): Promise<{ amount: number; debtAdded: number }> {
    if (
      action === "recover_nonpaid_grants" &&
      purchase.status === "completed"
    ) {
      throw new ConflictException("Payment is completed");
    }

    let targets = grants;
    if (action === "recover_duplicate_grants") {
      if (purchase.status !== "completed") {
        throw new ConflictException("Payment is not completed");
      }
      const baseGrants = grants.filter(
        (grant) => grant.creditKind === "paid" && grant.promotionCode === null,
      );
      const keeper = baseGrants.find(
        (grant) => grant.amount === purchase.creditAmount,
      );
      if (!keeper || baseGrants.length < 2) {
        throw new ConflictException(
          "No safely repairable duplicate grant exists",
        );
      }
      targets = baseGrants.filter((grant) => grant.id !== keeper.id);
    }
    if (targets.length === 0) {
      throw new ConflictException("No recoverable grants found");
    }

    const used = await session.sumUsageByGrant(targets.map((row) => row.id));
    const amount = targets.reduce((sum, grant) => sum + grant.amount, 0);
    const remaining = targets.reduce(
      (sum, grant) =>
        sum + Math.max(0, grant.amount - (used.get(grant.id) ?? 0)),
      0,
    );
    return { amount, debtAdded: Math.max(0, amount - remaining) };
  }

  // 완료된 환불 중 회수 원장이 아직 없는 것들. 회수액과 미수액은 환불을 만들 때
  // 이미 갈라져 저장돼 있어 여기서 다시 계산하지 않는다.
  private async pendingRefundRecoveries(
    session: AdminCreditReconciliationSession,
    purchaseId: string,
    ledger: AdminCreditLedgerRecord[],
  ) {
    const recovered = new Set(
      ledger
        .filter((entry) => entry.type === "refund_recovery")
        .map((entry) => entry.externalReference),
    );
    const pending = (await session.listCompletedRefunds(purchaseId)).filter(
      (refund) =>
        refund.recoveryAmount > 0 &&
        !recovered.has(`credit_refund:${refund.id}`),
    );
    if (pending.length === 0) {
      throw new ConflictException("No incomplete refund recovery found");
    }
    return pending;
  }

  private receiptFromLedger(
    reference: string,
    action: ReconciliationActionType,
    entry: AdminCreditLedgerRecord,
  ): ReconciliationActionReceipt {
    return {
      reference,
      action,
      purchaseId: entry.purchaseId ?? "",
      grantedCredits: entry.type === "grant" ? entry.amount : 0,
      recoveredCredits: entry.type === "grant" ? 0 : entry.amount,
      debtAdded: 0,
    };
  }

  async listReports(
    input: { status?: string } & PageInput,
  ): Promise<Page<AdminReport>> {
    const status = this.parseReportStatus(input.status);
    const cursorId = decodeCursor(input.cursor);

    if (
      cursorId &&
      !(await this.moderationRepository.hasReportCursor(cursorId, status))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const reports = await this.moderationRepository.listReports({
      status,
      cursorId,
      limit: input.limit,
    });
    return pageFromRows(
      reports.map((report) => this.toReport(report)),
      input.limit,
    );
  }

  async getReport(reportId: string): Promise<AdminReport> {
    const report = await this.moderationRepository.getReport(reportId);
    if (!report) {
      throw new BadRequestException("Report not found");
    }
    return this.toReport(report);
  }

  async updateReport(input: {
    reportId: string;
    status: string;
    resolution?: string;
  }): Promise<ReportUpdateReceipt> {
    const status = this.parseReportStatus(input.status);
    if (!status) {
      throw new BadRequestException("Report status is required");
    }
    if (!(await this.moderationRepository.getReport(input.reportId))) {
      throw new BadRequestException("Report not found");
    }

    const report = await this.moderationRepository.updateReport({
      reportId: input.reportId,
      status,
      resolution: input.resolution?.trim() || null,
    });
    return {
      id: report.id,
      status: report.status,
      updatedAt: report.updatedAt.toISOString(),
    };
  }

  private async recordCharacterActionLog(input: {
    characterId: string;
    actionType: string;
    targetTable: string;
    targetId: string;
    reason: string;
  }) {
    await this.contentRepository.recordCharacterAction(input);
  }

  private async appendCreditEntry(
    entryType: CreditEntryType,
    input: {
      userId: string;
      amount: number;
      reason: string;
      externalReference?: string;
      creditKind?: "free" | "paid";
      purchaseId?: string;
      promotionCode?: string;
    },
  ): Promise<CreditEntry> {
    this.validateCreditEntryInput(input);
    const creditKind = input.creditKind ?? "free";
    const promotionCode = input.promotionCode?.trim() || undefined;
    if (promotionCode && !input.purchaseId) {
      throw new BadRequestException(
        "Purchase-linked promotion requires a purchase ID",
      );
    }
    if (entryType === "grant" && creditKind === "paid" && !input.purchaseId) {
      throw new BadRequestException("Paid credits require a purchase ID");
    }
    if (
      input.purchaseId &&
      !(await this.creditPaymentRepository.hasPurchaseForUser(
        input.purchaseId,
        input.userId,
      ))
    ) {
      throw new BadRequestException("Credit purchase not found");
    }

    // 차감은 원장 type 중 adjustment로 남긴다. usage는 서비스가 실제 소비를
    // 기록할 때 쓰는 type이고, refund_recovery는 환불 회수 전용이다.
    const entry = await this.creditPaymentRepository.createLedgerEntry({
      userId: input.userId,
      type: entryType === "grant" ? "grant" : "adjustment",
      amount: input.amount,
      ...(entryType === "grant"
        ? {
            creditKind,
            purchaseId: input.purchaseId,
            promotionCode,
            ...(creditKind === "free"
              ? {
                  expiresAt: new Date(
                    Date.now() + freeCreditTtlDays * 24 * 60 * 60 * 1000,
                  ),
                }
              : {}),
          }
        : {}),
      reason: input.reason.trim(),
      externalReference: input.externalReference,
    });
    return this.toCreditEntry(entry);
  }

  private async hasCharacter(characterId: string): Promise<boolean> {
    return this.contentRepository.hasCharacter(characterId);
  }

  private async hasPost(postId: string): Promise<boolean> {
    return this.contentRepository.hasPost(postId);
  }

  private cleanHashtags(hashtags: string[] | undefined): string[] {
    return [
      ...new Set(
        (hashtags ?? []).map((hashtag) => hashtag.trim()).filter(Boolean),
      ),
    ];
  }

  private parsePostContentType(contentType: string): PostContentType {
    if (contentType !== "feed" && contentType !== "reel") {
      throw new BadRequestException("Post content type must be feed or reel");
    }
    return contentType;
  }

  private async assertStoredMedia(
    media: Array<DirectMediaInput | StoredMediaInput>,
  ): Promise<void> {
    for (const item of media) {
      if (!("mediaId" in item)) {
        continue;
      }

      const stored = await this.contentRepository.getStoredMedia(item.mediaId);
      if (!stored) {
        throw new BadRequestException("Media not found");
      }
      if (!stored.uploadedAt) {
        throw new BadRequestException("Media upload is not confirmed");
      }
    }
  }

  private toCreditEntry(entry: AdminCreditLedgerRecord): CreditEntry {
    return {
      id: entry.id,
      userId: entry.userId,
      entryType: entry.type === "grant" ? "grant" : "debit",
      ledgerType: entry.type,
      creditKind: entry.creditKind ?? undefined,
      purchaseId: entry.purchaseId ?? undefined,
      promotionCode: entry.promotionCode ?? undefined,
      amount: entry.amount,
      reason: entry.reason,
      externalReference: entry.externalReference ?? undefined,
      createdAt: entry.createdAt.toISOString(),
    };
  }

  private toPost(post: AdminPostRecord): AdminPost {
    return {
      id: post.id,
      characterId: post.characterId,
      contentType: post.contentType,
      content: post.content,
      media: post.postMedia.map((item) => ({
        mediaType: item.media.mediaType,
        url: item.media.url,
        ...(item.media.width ? { width: item.media.width } : {}),
        ...(item.media.height ? { height: item.media.height } : {}),
        ...(item.media.durationSeconds
          ? { durationSeconds: item.media.durationSeconds }
          : {}),
      })),
      hashtags: post.hashtags.map((item) => item.hashtag.name),
      commentCount: post._count.comments,
      reactionCount: post._count.reactions,
      createdAt: post.createdAt.toISOString(),
    };
  }

  private toStory(story: AdminStoryRecord): AdminStory {
    return {
      id: story.id,
      characterId: story.characterId,
      caption: story.caption,
      media: {
        mediaType: story.media.mediaType,
        url: story.media.url,
        ...(story.media.width ? { width: story.media.width } : {}),
        ...(story.media.height ? { height: story.media.height } : {}),
        ...(story.media.durationSeconds
          ? { durationSeconds: story.media.durationSeconds }
          : {}),
      },
      createdAt: story.createdAt.toISOString(),
      expiresAt: story.expiresAt.toISOString(),
    };
  }

  private toPostComment(comment: AdminPostCommentRecord): AdminPostComment {
    return {
      id: comment.id,
      postId: comment.postId,
      ...(comment.characterId ? { characterId: comment.characterId } : {}),
      ...(comment.userId ? { userId: comment.userId } : {}),
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
    };
  }

  private toPostReaction(reaction: AdminPostReactionRecord): AdminPostReaction {
    return {
      id: reaction.id,
      postId: reaction.postId,
      ...(reaction.characterId ? { characterId: reaction.characterId } : {}),
      ...(reaction.userId ? { userId: reaction.userId } : {}),
      reactionType: reaction.reactionType,
      createdAt: reaction.createdAt.toISOString(),
    };
  }

  private toAdminUser(user: AdminUserRecord, creditBalance: number): AdminUser {
    return {
      id: user.id,
      displayName: user.displayName,
      ...(user.email ? { email: user.email } : {}),
      followCount: user._count.characterFollows,
      creditBalance,
      createdAt: user.createdAt.toISOString(),
    };
  }

  private toSocialAccount(account: AdminUserAccountRecord): AdminSocialAccount {
    return {
      provider: account.provider,
      ...(account.email ? { email: account.email } : {}),
      linkedAt: account.createdAt.toISOString(),
    };
  }

  private toUserEvent(event: AdminUserEventRecord): AdminUserEvent {
    return {
      id: event.id,
      userId: event.userId,
      eventType: event.eventType,
      targetType: event.targetType,
      targetId: event.targetId,
      ...(event.metadata ? { metadata: event.metadata } : {}),
      createdAt: event.createdAt.toISOString(),
    };
  }

  private toHashtagPreference(
    preference: AdminHashtagPreferenceRecord,
  ): AdminHashtagPreference {
    return {
      userId: preference.userId,
      hashtag: preference.hashtag.name,
      score: preference.score,
      updatedAt: preference.updatedAt.toISOString(),
    };
  }

  private toMedia(media: AdminMediaRecord): Media {
    return {
      id: media.id,
      mediaType: media.mediaType,
      url: media.url,
      ...(media.contentType ? { contentType: media.contentType } : {}),
      ...(media.byteSize ? { byteSize: media.byteSize } : {}),
      ...(media.width ? { width: media.width } : {}),
      ...(media.height ? { height: media.height } : {}),
      ...(media.durationSeconds
        ? { durationSeconds: media.durationSeconds }
        : {}),
      uploadedAt: media.uploadedAt?.toISOString() ?? null,
      createdAt: media.createdAt.toISOString(),
    };
  }

  private toPayment(purchase: AdminCreditPurchaseRecord): AdminPayment {
    const payment = purchase.payment;
    return {
      id: purchase.id,
      userId: purchase.userId,
      ...(payment ? { provider: payment.provider } : {}),
      status: purchase.status,
      ...(payment ? { paymentStatus: payment.status } : {}),
      creditAmount: purchase.creditAmount,
      ...(payment?.amount !== null && payment?.amount !== undefined
        ? { paidAmount: payment.amount }
        : {}),
      ...(payment?.currency ? { currency: payment.currency } : {}),
      createdAt: purchase.createdAt.toISOString(),
      updatedAt: purchase.updatedAt.toISOString(),
    };
  }

  private toReport(report: AdminReportRecord): AdminReport {
    return {
      id: report.id,
      reporterUserId: report.reporterUserId,
      targetType: report.targetType,
      targetId: report.targetId,
      reason: report.reason,
      details: report.details ?? undefined,
      resolution: report.resolution ?? undefined,
      status: report.status,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
    };
  }

  private toPaymentReconciliationRow(
    purchase: AdminCreditPurchaseRecord,
    entries: AdminReconciliationLedgerRow[],
    refunds: AdminReconciliationRefundRow[],
  ): PaymentReconciliationRow {
    const paid = purchase.payment?.amount ?? null;
    const payment = {
      paymentId: purchase.id,
      userId: purchase.userId,
      ...(purchase.payment ? { provider: purchase.payment.provider } : {}),
      providerStatus: purchase.status,
      ...(purchase.payment ? { paymentStatus: purchase.payment.status } : {}),
      creditAmount: purchase.creditAmount,
      ...(paid !== null ? { paidAmount: paid } : {}),
      ...(purchase.payment?.currency
        ? { currency: purchase.payment.currency }
        : {}),
    };
    const grants = entries.filter((entry) => entry.type === "grant");
    const baseGrants = grants.filter(
      (entry) => entry.creditKind === "paid" && entry.promotionCode === null,
    );
    // 회수는 refund_recovery 행으로만 남는다 (credits.service.ts 규약).
    const recoveryReferences = new Set(
      entries
        .filter((entry) => entry.type === "refund_recovery")
        .map((entry) => entry.externalReference),
    );
    const issues: ReconciliationIssueCode[] = [];

    if (purchase.status === "completed") {
      if (baseGrants.length === 0) {
        issues.push("paid_missing_grant");
      } else if (baseGrants.length > 1) {
        issues.push("duplicate_base_grant");
      } else if (baseGrants[0].amount !== purchase.creditAmount) {
        issues.push("paid_grant_amount_mismatch");
      }
    } else if (
      purchase.status !== "refunded" &&
      purchase.status !== "reversed" &&
      grants.length > 0
    ) {
      issues.push("nonpaid_has_grant");
    }

    const completedRefunds = refunds.filter(
      (refund) => refund.status === "completed",
    );
    if (purchase.status === "refunded" && completedRefunds.length === 0) {
      issues.push("refunded_without_completed_refund");
    }
    for (const refund of completedRefunds) {
      if (
        refund.recoveryAmount > 0 &&
        !recoveryReferences.has(`credit_refund:${refund.id}`)
      ) {
        issues.push("refund_missing_recovery");
      }
    }
    for (const refund of refunds.filter((item) => item.status === "canceled")) {
      if (recoveryReferences.has(`credit_refund:${refund.id}`)) {
        issues.push("canceled_refund_has_recovery");
      }
    }
    if (
      paid !== null &&
      completedRefunds.reduce((sum, refund) => sum + refund.refundAmount, 0) >
        paid
    ) {
      issues.push("refund_total_exceeds_payment");
    }

    const uniqueIssues = [...new Set(issues)];
    const repairActions: ReconciliationActionType[] = [];
    if (uniqueIssues.includes("paid_missing_grant")) {
      repairActions.push("grant_missing_purchase");
    }
    if (uniqueIssues.includes("nonpaid_has_grant")) {
      repairActions.push("recover_nonpaid_grants");
    }
    if (uniqueIssues.includes("duplicate_base_grant")) {
      repairActions.push("recover_duplicate_grants");
    }
    if (uniqueIssues.includes("refund_missing_recovery")) {
      repairActions.push("recover_completed_refund");
    }
    const reasonByIssue: Record<ReconciliationIssueCode, string> = {
      paid_missing_grant: "paid purchase has no credit grant",
      paid_grant_amount_mismatch: "paid grant amount does not match purchase",
      duplicate_base_grant: "paid purchase has duplicate base grants",
      nonpaid_has_grant: "non-paid purchase has credit grant",
      refunded_without_completed_refund:
        "refunded purchase has no completed refund",
      refund_missing_recovery: "completed refund has no recovery ledger",
      canceled_refund_has_recovery: "canceled refund has recovery ledger",
      refund_total_exceeds_payment: "refund total exceeds payment amount",
    };
    // 아직 끝나지 않은 환불이 걸려 있으면 불일치가 아니라 대기로 읽어야 한다.
    const hasActiveRefund = refunds.some(
      (refund) =>
        refund.status === "reserved" ||
        refund.status === "payment_processing" ||
        refund.status === "payment_succeeded",
    );
    const ledgerStatus: LedgerStatus =
      purchase.status === "completed" && baseGrants.length === 0
        ? "missing_grant"
        : grants.length > 0
          ? "granted"
          : "not_granted";

    return {
      ...payment,
      ledgerStatus,
      reconciliationStatus:
        uniqueIssues.length > 0
          ? "mismatch"
          : this.isPurchaseInFlight(purchase.status) || hasActiveRefund
            ? "pending"
            : "resolved",
      ...(uniqueIssues.length > 0
        ? {
            reason: uniqueIssues
              .map((issue) => reasonByIssue[issue])
              .join("; "),
            issueCodes: uniqueIssues,
          }
        : this.isPurchaseInFlight(purchase.status)
          ? { reason: "payment pending" }
          : {}),
      ...(repairActions.length > 0 ? { repairActions } : {}),
    };
  }

  private isPurchaseInFlight(status: CreditPurchaseStatus): boolean {
    return status === "pending" || status === "payment_processing";
  }

  private parseReportStatus(status?: string): ReportStatus | undefined {
    const value = status?.trim();
    if (!value) {
      return undefined;
    }
    if (
      value === "submitted" ||
      value === "reviewing" ||
      value === "resolved" ||
      value === "rejected"
    ) {
      return value;
    }
    throw new BadRequestException("Invalid report status");
  }

  private parseGenerationRunProvider(provider?: string): GenerationRunProvider {
    const value = provider?.trim() || "local";
    if (value === "local") {
      return value;
    }
    throw new BadRequestException("Unsupported generation provider");
  }

  private parseReconciliationStatus(
    status?: string,
  ): ReconciliationStatus | undefined {
    const value = status?.trim();
    if (!value) {
      return undefined;
    }
    if (value === "mismatch" || value === "pending" || value === "resolved") {
      return value;
    }
    throw new BadRequestException("Invalid payment reconciliation status");
  }

  private parseAnalyticsMetric(
    metric?: string,
  ): AnalyticsMetricName | undefined {
    const value = metric?.trim();
    if (!value) {
      return undefined;
    }
    if (analyticsMetricNames.includes(value as AnalyticsMetricName)) {
      return value as AnalyticsMetricName;
    }
    throw new BadRequestException("Invalid analytics metric");
  }

  private parseOptionalBoolean(
    value: string | undefined,
    field: string,
  ): boolean | undefined {
    const trimmed = value?.trim();
    if (!trimmed) {
      return undefined;
    }
    if (trimmed === "true") {
      return true;
    }
    if (trimmed === "false") {
      return false;
    }
    throw new BadRequestException(`Invalid ${field}`);
  }

  private parseOptionalMediaType(mediaType?: string): MediaType | undefined {
    const value = mediaType?.trim();
    if (!value) {
      return undefined;
    }
    if (value === "image" || value === "video") {
      return value;
    }
    throw new BadRequestException("Invalid media type");
  }

  private parseCreatedAtWhere(from?: string, to?: string): CreatedAtWhere {
    const createdAt: CreatedAtWhere["createdAt"] = {};
    if (from?.trim()) {
      createdAt.gte = this.parseDate(from, "from");
    }
    if (to?.trim()) {
      createdAt.lte = this.parseDate(to, "to");
    }
    if (createdAt.gte && createdAt.lte && createdAt.gte > createdAt.lte) {
      throw new BadRequestException("Invalid analytics date range");
    }
    return Object.keys(createdAt).length > 0 ? { createdAt } : {};
  }

  private parsePaymentCreatedAtWhere(
    from?: string,
    to?: string,
  ): CreatedAtWhere {
    const createdAt: CreatedAtWhere["createdAt"] = {};
    if (from?.trim()) {
      createdAt.gte = this.parseDate(from, "payment reconciliation from");
    }
    if (to?.trim()) {
      createdAt.lte = this.parseDate(to, "payment reconciliation to");
    }
    if (createdAt.gte && createdAt.lte && createdAt.gte > createdAt.lte) {
      throw new BadRequestException(
        "Invalid payment reconciliation date range",
      );
    }
    return Object.keys(createdAt).length > 0 ? { createdAt } : {};
  }

  private parseDate(value: string, field: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`Invalid analytics ${field}`);
    }
    return date;
  }

  private validateCreditEntryInput(input: { amount: number; reason: string }) {
    if (!input.reason.trim()) {
      throw new BadRequestException("Credit ledger reason is required");
    }
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new BadRequestException("Credit amount must be a positive integer");
    }
  }
}
