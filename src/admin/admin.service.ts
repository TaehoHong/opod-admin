import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  decodeCursor,
  Page,
  PageInput,
  pageFromRows,
} from "../domain/database/page";
import { PrismaService } from "../domain/database/prisma.service";
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
  "pending" | "paid" | "failed" | "canceled" | "refunded";
type ReconciliationStatus = "mismatch" | "pending" | "resolved";
type LedgerStatus = "granted" | "missing_grant" | "not_granted";
type ReconciliationIssueCode =
  | "paid_missing_grant"
  | "paid_grant_amount_mismatch"
  | "duplicate_base_grant"
  | "nonpaid_has_grant"
  | "refunded_without_completed_refund"
  | "refund_missing_recovery"
  | "released_refund_has_recovery"
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

type AdminUserDetail = AdminUser;

type PrismaAdminUser = Prisma.UserGetPayload<{ select: typeof userFields }>;

type PrismaAdminMedia = Prisma.MediaGetPayload<{ select: typeof mediaFields }>;

type AdminUserEvent = {
  id: string;
  userId: string;
  eventType: string;
  targetType: string;
  targetId: string;
  metadata?: unknown;
  createdAt: string;
};

type PrismaUserEvent = Prisma.UserEventGetPayload<Prisma.UserEventDefaultArgs>;

type AdminHashtagPreference = {
  userId: string;
  hashtag: string;
  score: number;
  updatedAt: string;
};

type PrismaHashtagPreference = Prisma.UserHashtagPreferenceGetPayload<{
  include: { hashtag: { select: { name: true } } };
}>;

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

type PrismaPost = Prisma.PostGetPayload<{ include: typeof postWithMedia }>;

type AdminStory = {
  id: string;
  characterId: string;
  caption: string;
  media: DirectMediaInput;
  createdAt: string;
  expiresAt: string;
};

type PrismaStory = Prisma.StoryGetPayload<{ include: { media: true } }>;

// 댓글/리액션 액터는 캐릭터 또는 사용자다 (canonical 스키마의 nullable 쌍).
type AdminPostComment = {
  id: string;
  postId: string;
  characterId?: string;
  userId?: string;
  body: string;
  createdAt: string;
};

type PrismaPostComment =
  Prisma.PostCommentGetPayload<Prisma.PostCommentDefaultArgs>;

type AdminPostReaction = {
  id: string;
  postId: string;
  characterId?: string;
  userId?: string;
  reactionType: string;
  createdAt: string;
};

type PrismaPostReaction =
  Prisma.PostReactionGetPayload<Prisma.PostReactionDefaultArgs>;

type CreditEntryType = "grant" | "debit";

type CreditEntry = {
  id: string;
  userId: string;
  entryType: CreditEntryType;
  creditKind?: "free" | "paid";
  purchaseId?: string;
  promotionCode?: string;
  amount: number;
  reason: string;
  externalReference?: string;
  createdAt: string;
};

type PrismaCreditEntry =
  Prisma.CreditLedgerEntryGetPayload<Prisma.CreditLedgerEntryDefaultArgs>;

type PrismaCreditPurchase =
  Prisma.CreditPurchaseGetPayload<Prisma.CreditPurchaseDefaultArgs>;

type PaymentReconciliationItem = {
  paymentId: string;
  userId: string;
  provider: string;
  providerStatus: CreditPurchaseStatus;
  creditAmount: number;
  paidAmount: number;
  currency: string;
  ledgerStatus: LedgerStatus;
  reason?: string;
  issueCodes?: ReconciliationIssueCode[];
  repairActions?: ReconciliationActionType[];
};

type AdminPayment = {
  id: string;
  userId: string;
  provider: string;
  status: CreditPurchaseStatus;
  creditAmount: number;
  paidAmount: number;
  currency: string;
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

type PrismaReport = Prisma.ReportGetPayload<Prisma.ReportDefaultArgs>;

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

const userFields = {
  id: true,
  displayName: true,
  email: true,
  createdAt: true,
  _count: { select: { characterFollows: true } },
} as const;

const mediaFields = {
  id: true,
  mediaType: true,
  url: true,
  contentType: true,
  byteSize: true,
  width: true,
  height: true,
  durationSeconds: true,
  uploadedAt: true,
  createdAt: true,
} as const;

const postWithMedia = {
  postMedia: {
    include: { media: true },
    orderBy: { sortOrder: "asc" },
  },
  hashtags: {
    include: { hashtag: true },
    orderBy: { hashtag: { name: "asc" } },
  },
  _count: { select: { comments: true, reactions: true } },
} as const;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly generationService: GenerationService,
  ) {}

  async listUsers(input: { q?: string } & PageInput): Promise<Page<AdminUser>> {
    const term = input.q?.trim();
    const where = term
      ? {
          OR: [
            { email: { contains: term, mode: "insensitive" as const } },
            { displayName: { contains: term, mode: "insensitive" as const } },
          ],
        }
      : {};
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.prisma.user.findFirst({
        where: { id: cursorId, ...where },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const users = await this.prisma.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      select: userFields,
    });
    const userIds = users.map((user) => user.id);
    const now = new Date();
    const [grants, reservations] =
      userIds.length === 0
        ? [[], []]
        : await Promise.all([
            this.prisma.creditLedgerEntry.groupBy({
              by: ["userId"],
              where: {
                userId: { in: userIds },
                entryType: "grant",
                OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
              },
              _sum: { remainingAmount: true },
            }),
            this.prisma.creditReservation.groupBy({
              by: ["userId"],
              where: {
                userId: { in: userIds },
                status: "reserved",
                expiresAt: { gt: now },
              },
              _sum: { amount: true },
            }),
          ]);
    const grantedByUser = new Map(
      grants.map((grant) => [grant.userId, grant._sum.remainingAmount ?? 0]),
    );
    const reservedByUser = new Map(
      reservations.map((reservation) => [
        reservation.userId,
        reservation._sum.amount ?? 0,
      ]),
    );
    return pageFromRows(
      users.map((user) =>
        this.toAdminUser(
          user,
          Math.max(
            0,
            (grantedByUser.get(user.id) ?? 0) -
              (reservedByUser.get(user.id) ?? 0),
          ),
        ),
      ),
      input.limit,
    );
  }

  async getUser(userId: string): Promise<AdminUserDetail> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: userFields,
    });
    if (!user) {
      throw new BadRequestException("User not found");
    }
    const now = new Date();
    const [grants, reservations] = await Promise.all([
      this.prisma.creditLedgerEntry.aggregate({
        _sum: { remainingAmount: true },
        where: {
          userId,
          entryType: "grant",
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      }),
      this.prisma.creditReservation.aggregate({
        _sum: { amount: true },
        where: {
          userId,
          status: "reserved",
          expiresAt: { gt: now },
        },
      }),
    ]);
    return {
      ...this.toAdminUser(user, 0),
      creditBalance: Math.max(
        0,
        (grants._sum.remainingAmount ?? 0) - (reservations._sum.amount ?? 0),
      ),
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
      !(await this.prisma.userEvent.findFirst({
        where: { id: cursorId, ...where },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const events = await this.prisma.userEvent.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
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
    const preferences = await this.prisma.userHashtagPreference.findMany({
      where: userId ? { userId } : {},
      orderBy: [{ score: "desc" }, { hashtag: { name: "asc" } }],
      include: { hashtag: { select: { name: true } } },
    });
    return {
      items: preferences.map((preference) =>
        this.toHashtagPreference(preference),
      ),
    };
  }

  async listTopHashtags(input: { limit: number }): Promise<{
    items: Array<{ hashtag: string; postCount: number }>;
  }> {
    const hashtags = await this.prisma.hashtag.findMany({
      orderBy: [{ posts: { _count: "desc" } }, { name: "asc" }],
      take: input.limit,
      select: {
        name: true,
        _count: { select: { posts: true } },
      },
    });
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
    const where = {
      ...(mediaType ? { mediaType } : {}),
      ...(uploaded === undefined
        ? {}
        : { uploadedAt: uploaded ? { not: null } : null }),
    };
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.prisma.media.findFirst({
        where: { id: cursorId, ...where },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const media = await this.prisma.media.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      select: mediaFields,
    });
    return pageFromRows(
      media.map((item) => this.toMedia(item)),
      input.limit,
    );
  }

  async getMedia(mediaId: string): Promise<Media> {
    const media = await this.prisma.media.findUnique({
      where: { id: mediaId },
      select: mediaFields,
    });
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
      !(await this.prisma.post.findFirst({
        where: { id: cursorId, ...where },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const posts = await this.prisma.post.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      include: postWithMedia,
    });
    return pageFromRows(
      posts.map((post) => this.toPost(post)),
      input.limit,
    );
  }

  async getPost(postId: string): Promise<AdminPost> {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: postWithMedia,
    });
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
      await this.prisma.post.create({
        data: {
          characterId: input.actorId,
          contentType,
          content: input.content,
          hashtags: {
            create: hashtags.map((name) => ({
              hashtag: {
                connectOrCreate: {
                  where: { name },
                  create: { name },
                },
              },
            })),
          },
          postMedia: {
            create: input.media.map((item, index) => ({
              sortOrder: index,
              media:
                "mediaId" in item
                  ? { connect: { id: item.mediaId } }
                  : { create: item },
            })),
          },
        },
        include: postWithMedia,
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
    const where = characterId ? { characterId } : {};
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.prisma.story.findFirst({
        where: { id: cursorId, ...where },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const stories = await this.prisma.story.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      include: { media: true },
    });
    return pageFromRows(
      stories.map((story) => this.toStory(story)),
      input.limit,
    );
  }

  async getStory(storyId: string): Promise<AdminStory> {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      include: { media: true },
    });
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
      await this.prisma.story.create({
        data: {
          character: { connect: { id: input.characterId } },
          caption: input.caption?.trim() ?? "",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          media:
            "mediaId" in input.media
              ? { connect: { id: input.media.mediaId } }
              : { create: input.media },
        },
        include: { media: true },
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
      !(await this.prisma.postComment.findFirst({
        where: { id: cursorId, ...where },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const comments = await this.prisma.postComment.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
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
      await this.prisma.postComment.create({
        data: {
          postId: input.postId,
          characterId: input.characterId,
          body,
        },
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
      !(await this.prisma.postReaction.findFirst({
        where: { id: cursorId, ...where },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const reactions = await this.prisma.postReaction.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
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
      await this.prisma.postReaction.create({
        data: {
          postId: input.postId,
          characterId: input.characterId,
          reactionType,
        },
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
    const where = userId ? { userId } : {};
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.prisma.creditLedgerEntry.findFirst({
        where: { id: cursorId, ...where },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const entries = await this.prisma.creditLedgerEntry.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
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
    const job = await this.generationService.retryJob(input.jobId);
    await this.recordCharacterActionLog({
      characterId: job.characterId,
      actionType: "GENERATION_JOB_RETRIED",
      targetTable: "generation_jobs",
      targetId: job.id,
      reason: input.reason?.trim() || "generation job retried",
    });
    return job;
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
    const where = characterId ? { characterId } : {};
    const cursorId = decodeCursor(input.cursor);
    let cursor: bigint | undefined;
    if (cursorId !== undefined) {
      try {
        cursor = BigInt(cursorId);
      } catch {
        throw new BadRequestException("Invalid cursor");
      }
    }

    const logs = await this.prisma.characterActionLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
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
    const creditTotal = async (entryType: CreditEntryType) => {
      const result = await this.prisma.creditLedgerEntry.aggregate({
        where: { entryType, ...where },
        _sum: { amount: true },
      });
      return result._sum.amount ?? 0;
    };
    const descriptors: Array<[AnalyticsMetricName, () => Promise<number>]> = [
      ["events.count", () => this.prisma.userEvent.count({ where })],
      ["messages.count", () => this.prisma.message.count({ where })],
      ["credits.granted", () => creditTotal("grant")],
      ["credits.debited", () => creditTotal("debit")],
      [
        "generation_jobs.count",
        () => this.prisma.generationJob.count({ where }),
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
    const purchases = await this.prisma.creditPurchase.findMany({
      where: this.parsePaymentCreatedAtWhere(input.from, input.to),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const purchaseIds = purchases.map((purchase) => purchase.id);
    const [entries, refunds] =
      purchaseIds.length === 0
        ? [[], []]
        : await Promise.all([
            this.prisma.creditLedgerEntry.findMany({
              where: { purchaseId: { in: purchaseIds } },
              select: {
                id: true,
                purchaseId: true,
                entryType: true,
                creditKind: true,
                promotionCode: true,
                amount: true,
                externalReference: true,
              },
            }),
            this.prisma.creditRefund.findMany({
              where: { purchaseId: { in: purchaseIds } },
              select: {
                id: true,
                purchaseId: true,
                status: true,
                refundAmount: true,
                allocations: {
                  select: {
                    recoveryAmount: true,
                    recoveredAmount: true,
                  },
                },
              },
            }),
          ]);

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
          provider: item.provider,
          providerStatus: item.providerStatus,
          creditAmount: item.creditAmount,
          paidAmount: item.paidAmount,
          currency: item.currency,
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
    const payment = await this.prisma.creditPurchase.findUnique({
      where: { id: paymentId },
    });
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

    const purchase = await this.prisma.creditPurchase.findUnique({
      where: { id: input.purchaseId },
    });
    if (!purchase) {
      throw new BadRequestException("Payment not found");
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${purchase.userId}, 0))`;
      const actionLock = `credit_reconciliation:${reference}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actionLock}, 0))`;

      const existing = await tx.creditReconciliationAction.findUnique({
        where: { reference },
      });
      if (existing) {
        if (
          existing.purchaseId !== input.purchaseId ||
          existing.actionType !== input.action
        ) {
          throw new ConflictException(
            "Reconciliation reference is already used",
          );
        }
        return existing.details as ReconciliationActionReceipt;
      }

      const grants = await tx.creditLedgerEntry.findMany({
        where: {
          purchaseId: purchase.id,
          entryType: "grant",
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      let grantedCredits = 0;
      let recoveredCredits = 0;
      let debtAdded = 0;

      if (input.action === "grant_missing_purchase") {
        if (purchase.status !== "paid") {
          throw new ConflictException("Payment is not paid");
        }
        const baseGrants = grants.filter(
          (grant) =>
            grant.creditKind === "paid" && grant.promotionCode === null,
        );
        if (baseGrants.length > 0) {
          throw new ConflictException("Payment already has a base grant");
        }

        const account = await tx.creditAccount.upsert({
          where: { userId: purchase.userId },
          create: { userId: purchase.userId },
          update: {},
        });
        const offset = Math.min(account.paidDebt, purchase.creditAmount);
        if (offset > 0) {
          const nextDebt = account.paidDebt - offset;
          await tx.creditAccount.update({
            where: { userId: purchase.userId },
            data: { paidDebt: nextDebt },
          });
          if (nextDebt === 0) {
            await tx.user.update({
              where: { id: purchase.userId },
              data: { debtIdentityHash: null },
            });
          }
        }
        await tx.creditLedgerEntry.create({
          data: {
            userId: purchase.userId,
            purchaseId: purchase.id,
            entryType: "grant",
            creditKind: "paid",
            amount: purchase.creditAmount,
            remainingAmount: purchase.creditAmount - offset,
            reason,
            externalReference: `credit_purchase:${purchase.id}`,
          },
        });
        grantedCredits = purchase.creditAmount;
      } else if (input.action === "recover_completed_refund") {
        const refunds = await tx.creditRefund.findMany({
          where: { purchaseId: purchase.id, status: "refunded" },
          include: {
            allocations: { include: { ledgerEntry: true } },
          },
        });
        let repaired = false;
        for (const refund of refunds) {
          const totalRecovery = refund.creditAmount + refund.promotionAmount;
          if (totalRecovery === 0) {
            continue;
          }
          for (const allocation of refund.allocations) {
            const recoveryLeft =
              allocation.recoveryAmount - allocation.recoveredAmount;
            if (recoveryLeft <= 0) {
              continue;
            }
            const remaining = allocation.ledgerEntry.remainingAmount ?? 0;
            const recovered = Math.min(remaining, recoveryLeft);
            if (recovered > 0) {
              await tx.creditLedgerEntry.update({
                where: { id: allocation.ledgerEntryId },
                data: { remainingAmount: remaining - recovered },
              });
            }
            debtAdded += recoveryLeft - recovered;
            recoveredCredits += recoveryLeft;
            await tx.creditRefundAllocation.update({
              where: {
                refundId_ledgerEntryId: {
                  refundId: allocation.refundId,
                  ledgerEntryId: allocation.ledgerEntryId,
                },
              },
              data: { recoveredAmount: allocation.recoveryAmount },
            });
            repaired = true;
          }
          const debitReference = `credit_refund:${refund.id}`;
          if (
            !(await tx.creditLedgerEntry.findFirst({
              where: {
                entryType: "debit",
                externalReference: debitReference,
              },
              select: { id: true },
            }))
          ) {
            await tx.creditLedgerEntry.create({
              data: {
                userId: purchase.userId,
                purchaseId: purchase.id,
                entryType: "debit",
                amount: totalRecovery,
                reason,
                externalReference: debitReference,
              },
            });
            repaired = true;
          }
        }
        if (!repaired) {
          throw new ConflictException("No incomplete refund recovery found");
        }
        if (debtAdded > 0) {
          await tx.creditAccount.upsert({
            where: { userId: purchase.userId },
            create: { userId: purchase.userId, paidDebt: debtAdded },
            update: { paidDebt: { increment: debtAdded } },
          });
        }
      } else {
        if (
          input.action === "recover_nonpaid_grants" &&
          purchase.status === "paid"
        ) {
          throw new ConflictException("Payment is paid");
        }

        let targets = grants;
        if (input.action === "recover_duplicate_grants") {
          if (purchase.status !== "paid") {
            throw new ConflictException("Payment is not paid");
          }
          const baseGrants = grants.filter(
            (grant) =>
              grant.creditKind === "paid" && grant.promotionCode === null,
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

        for (const grant of targets) {
          const remaining = grant.remainingAmount ?? 0;
          if (remaining > 0) {
            await tx.creditLedgerEntry.update({
              where: { id: grant.id },
              data: { remainingAmount: 0 },
            });
          }
          recoveredCredits += grant.amount;
          debtAdded += grant.amount - remaining;
        }
        if (debtAdded > 0) {
          await tx.creditAccount.upsert({
            where: { userId: purchase.userId },
            create: { userId: purchase.userId, paidDebt: debtAdded },
            update: { paidDebt: { increment: debtAdded } },
          });
        }
        await tx.creditLedgerEntry.create({
          data: {
            userId: purchase.userId,
            purchaseId: purchase.id,
            entryType: "debit",
            amount: recoveredCredits,
            reason,
            externalReference: `credit_reconciliation:${reference}`,
          },
        });
      }

      const receipt: ReconciliationActionReceipt = {
        reference,
        action: input.action,
        purchaseId: purchase.id,
        grantedCredits,
        recoveredCredits,
        debtAdded,
      };
      await tx.creditReconciliationAction.create({
        data: {
          actionType: input.action,
          reference,
          purchaseId: purchase.id,
          adminId: input.adminId,
          reason,
          details: receipt,
        },
      });
      return receipt;
    });
  }

  async listReports(
    input: { status?: string } & PageInput,
  ): Promise<Page<AdminReport>> {
    const status = this.parseReportStatus(input.status);
    const where = status ? { status } : {};
    const cursorId = decodeCursor(input.cursor);

    if (
      cursorId &&
      !(await this.prisma.report.findFirst({
        where: { id: cursorId, ...where },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const reports = await this.prisma.report.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    return pageFromRows(
      reports.map((report) => this.toReport(report)),
      input.limit,
    );
  }

  async getReport(reportId: string): Promise<AdminReport> {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });
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
    if (
      !(await this.prisma.report.findUnique({
        where: { id: input.reportId },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Report not found");
    }

    const report = await this.prisma.report.update({
      where: { id: input.reportId },
      data: {
        status,
        resolution: input.resolution?.trim() || null,
      },
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
    if (!this.prisma) {
      return;
    }

    await this.prisma.characterActionLog.create({
      data: input,
    });
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
      !(await this.prisma.creditPurchase.findFirst({
        where: { id: input.purchaseId, userId: input.userId },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Credit purchase not found");
    }

    const entry = await this.prisma.creditLedgerEntry.create({
      data: {
        userId: input.userId,
        entryType,
        amount: input.amount,
        ...(entryType === "grant"
          ? {
              remainingAmount: input.amount,
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
      },
    });
    return this.toCreditEntry(entry);
  }

  private async hasCharacter(characterId: string): Promise<boolean> {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { id: true },
    });
    return character !== null;
  }

  private async hasPost(postId: string): Promise<boolean> {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true },
    });
    return post !== null;
  }

  private async hasUser(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    return user !== null;
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

      const stored = await this.prisma.media.findUnique({
        where: { id: item.mediaId },
        select: {
          id: true,
          mediaType: true,
          uploadedAt: true,
        },
      });
      if (!stored) {
        throw new BadRequestException("Media not found");
      }
      if (!stored.uploadedAt) {
        throw new BadRequestException("Media upload is not confirmed");
      }
    }
  }

  private toCreditEntry(entry: PrismaCreditEntry): CreditEntry {
    return {
      id: entry.id,
      userId: entry.userId,
      entryType: entry.entryType,
      creditKind: entry.creditKind ?? undefined,
      purchaseId: entry.purchaseId ?? undefined,
      promotionCode: entry.promotionCode ?? undefined,
      amount: entry.amount,
      reason: entry.reason,
      externalReference: entry.externalReference ?? undefined,
      createdAt: entry.createdAt.toISOString(),
    };
  }

  private toPost(post: PrismaPost): AdminPost {
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

  private toStory(story: PrismaStory): AdminStory {
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

  private toPostComment(comment: PrismaPostComment): AdminPostComment {
    return {
      id: comment.id,
      postId: comment.postId,
      ...(comment.characterId ? { characterId: comment.characterId } : {}),
      ...(comment.userId ? { userId: comment.userId } : {}),
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
    };
  }

  private toPostReaction(reaction: PrismaPostReaction): AdminPostReaction {
    return {
      id: reaction.id,
      postId: reaction.postId,
      ...(reaction.characterId ? { characterId: reaction.characterId } : {}),
      ...(reaction.userId ? { userId: reaction.userId } : {}),
      reactionType: reaction.reactionType,
      createdAt: reaction.createdAt.toISOString(),
    };
  }

  private toAdminUser(user: PrismaAdminUser, creditBalance: number): AdminUser {
    return {
      id: user.id,
      displayName: user.displayName,
      ...(user.email ? { email: user.email } : {}),
      followCount: user._count.characterFollows,
      creditBalance,
      createdAt: user.createdAt.toISOString(),
    };
  }

  private toUserEvent(event: PrismaUserEvent): AdminUserEvent {
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
    preference: PrismaHashtagPreference,
  ): AdminHashtagPreference {
    return {
      userId: preference.userId,
      hashtag: preference.hashtag.name,
      score: preference.score,
      updatedAt: preference.updatedAt.toISOString(),
    };
  }

  private toMedia(media: PrismaAdminMedia): Media {
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

  private toPayment(payment: PrismaCreditPurchase): AdminPayment {
    return {
      id: payment.id,
      userId: payment.userId,
      provider: payment.provider,
      status: payment.status,
      creditAmount: payment.creditAmount,
      paidAmount: payment.paidAmount,
      currency: payment.currency,
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
    };
  }

  private toReport(report: PrismaReport): AdminReport {
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
    purchase: PrismaCreditPurchase,
    entries: Array<{
      id: string;
      purchaseId: string | null;
      entryType: CreditEntryType;
      creditKind: "free" | "paid" | null;
      promotionCode: string | null;
      amount: number;
      externalReference: string | null;
    }>,
    refunds: Array<{
      id: string;
      purchaseId: string;
      status: "reserved" | "refunded" | "released";
      refundAmount: number;
      allocations?: Array<{
        recoveryAmount: number;
        recoveredAmount: number;
      }>;
    }>,
  ): PaymentReconciliationRow {
    const payment = {
      paymentId: purchase.id,
      userId: purchase.userId,
      provider: purchase.provider,
      providerStatus: purchase.status,
      creditAmount: purchase.creditAmount,
      paidAmount: purchase.paidAmount,
      currency: purchase.currency,
    };
    const grants = entries.filter((entry) => entry.entryType === "grant");
    const baseGrants = grants.filter(
      (entry) => entry.creditKind === "paid" && entry.promotionCode === null,
    );
    const debitReferences = new Set(
      entries
        .filter((entry) => entry.entryType === "debit")
        .map((entry) => entry.externalReference),
    );
    const issues: ReconciliationIssueCode[] = [];

    if (purchase.status === "paid") {
      if (baseGrants.length === 0) {
        issues.push("paid_missing_grant");
      } else if (baseGrants.length > 1) {
        issues.push("duplicate_base_grant");
      } else if (baseGrants[0].amount !== purchase.creditAmount) {
        issues.push("paid_grant_amount_mismatch");
      }
    } else if (purchase.status !== "refunded" && grants.length > 0) {
      issues.push("nonpaid_has_grant");
    }

    const completedRefunds = refunds.filter(
      (refund) => refund.status === "refunded",
    );
    if (purchase.status === "refunded" && completedRefunds.length === 0) {
      issues.push("refunded_without_completed_refund");
    }
    for (const refund of completedRefunds) {
      const expectedRecovery = (refund.allocations ?? []).reduce(
        (sum, allocation) => sum + allocation.recoveryAmount,
        0,
      );
      if (
        expectedRecovery > 0 &&
        (!debitReferences.has(`credit_refund:${refund.id}`) ||
          (refund.allocations ?? []).some(
            (allocation) =>
              allocation.recoveredAmount < allocation.recoveryAmount,
          ))
      ) {
        issues.push("refund_missing_recovery");
      }
    }
    for (const refund of refunds.filter((item) => item.status === "released")) {
      if (debitReferences.has(`credit_refund:${refund.id}`)) {
        issues.push("released_refund_has_recovery");
      }
    }
    if (
      completedRefunds.reduce((sum, refund) => sum + refund.refundAmount, 0) >
      purchase.paidAmount
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
      released_refund_has_recovery: "released refund has recovery ledger",
      refund_total_exceeds_payment: "refund total exceeds payment amount",
    };
    const hasActiveRefund = refunds.some(
      (refund) => refund.status === "reserved",
    );
    const ledgerStatus: LedgerStatus =
      purchase.status === "paid" && baseGrants.length === 0
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
          : purchase.status === "pending" || hasActiveRefund
            ? "pending"
            : "resolved",
      ...(uniqueIssues.length > 0
        ? {
            reason: uniqueIssues
              .map((issue) => reasonByIssue[issue])
              .join("; "),
            issueCodes: uniqueIssues,
          }
        : purchase.status === "pending"
          ? { reason: "payment pending" }
          : {}),
      ...(repairActions.length > 0 ? { repairActions } : {}),
    };
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
