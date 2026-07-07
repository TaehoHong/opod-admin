import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  decodeCursor,
  Page,
  PageInput,
  pageFromRows,
} from "../domain/database/page";
import { PrismaService } from "../domain/database/prisma.service";
import { GenerationService } from "./generation/generation.service";
import { Media, MediaService } from "./media/media.service";

type MediaType = "image" | "video";
type ActorType = "character" | "user";
type ReportTargetType = "character" | "post" | "message";
type ReportStatus = "submitted" | "reviewing" | "resolved" | "rejected";
type GenerationRunProvider = "local";
type CreditPurchaseStatus =
  "pending" | "paid" | "failed" | "canceled" | "refunded";
type ReconciliationStatus = "mismatch" | "pending" | "resolved";
type LedgerStatus = "granted" | "missing_grant" | "not_granted";
type AnalyticsMetricName =
  | "events.count"
  | "messages.count"
  | "credits.granted"
  | "credits.debited"
  | "generation_jobs.count";

type AdminUser = {
  id: string;
  displayName: string;
  email?: string;
  createdAt: string;
};

type PrismaAdminUser = Omit<AdminUser, "createdAt" | "email"> & {
  email: string | null;
  createdAt: Date;
};

type PrismaAdminMedia = Omit<
  Media,
  | "createdAt"
  | "uploadedAt"
  | "contentType"
  | "byteSize"
  | "width"
  | "height"
  | "durationSeconds"
> & {
  contentType: string | null;
  byteSize: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  uploadedAt: Date | null;
  createdAt: Date;
};

type AdminUserEvent = {
  id: string;
  userId: string;
  eventType: string;
  targetType: string;
  targetId: string;
  metadata?: unknown;
  createdAt: string;
};

type PrismaUserEvent = Omit<AdminUserEvent, "createdAt" | "metadata"> & {
  metadata: unknown | null;
  createdAt: Date;
};

type AdminHashtagPreference = {
  userId: string;
  hashtag: string;
  score: number;
  updatedAt: string;
};

type PrismaHashtagPreference = Omit<
  AdminHashtagPreference,
  "updatedAt" | "hashtag"
> & {
  hashtag: { name: string };
  updatedAt: Date;
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
  content: string;
  media: DirectMediaInput[];
  hashtags: string[];
  createdAt: string;
};

type PrismaPost = {
  id: string;
  characterId: string;
  content: string;
  createdAt: Date;
  hashtags: Array<{
    hashtag: {
      name: string;
    };
  }>;
  postMedia: Array<{
    media: {
      mediaType: MediaType;
      url: string;
      width?: number | null;
      height?: number | null;
      durationSeconds?: number | null;
    };
  }>;
};

type AdminPostComment = {
  id: string;
  postId: string;
  characterId: string;
  body: string;
  createdAt: string;
};

type PrismaPostComment = Omit<AdminPostComment, "createdAt"> & {
  createdAt: Date;
};

type AdminPostReaction = {
  id: string;
  postId: string;
  characterId: string;
  reactionType: string;
  createdAt: string;
};

type PrismaPostReaction = Omit<AdminPostReaction, "createdAt"> & {
  createdAt: Date;
};

type CreditEntryType = "grant" | "debit";

type CreditEntry = {
  id: string;
  userId: string;
  entryType: CreditEntryType;
  amount: number;
  reason: string;
  externalReference?: string;
  createdAt: string;
};

type PrismaCreditEntry = Omit<
  CreditEntry,
  "createdAt" | "externalReference"
> & {
  externalReference: string | null;
  createdAt: Date;
};

type PrismaCreditPurchase = {
  id: string;
  userId: string;
  provider: string;
  status: CreditPurchaseStatus;
  creditAmount: number;
  paidAmount: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
};

type PaymentReconciliationItem = {
  paymentId: string;
  userId: string;
  provider: string;
  providerStatus: CreditPurchaseStatus;
  ledgerStatus: LedgerStatus;
  reason?: string;
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

type PaymentReconciliationRow = PaymentReconciliationItem & {
  reconciliationStatus: ReconciliationStatus;
};

type PrismaCharacterActionLog = {
  id: bigint;
  characterId: string;
  actionType: string;
  targetTable: string | null;
  targetId: string | null;
  reason: string;
  createdAt: Date;
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

type PrismaReport = Omit<
  AdminReport,
  "createdAt" | "updatedAt" | "details" | "resolution"
> & {
  details: string | null;
  resolution: string | null;
  createdAt: Date;
  updatedAt: Date;
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

type AdminPrismaClient = {
  character: {
    findUnique(input: {
      where: { id: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  characterActionLog: {
    create(input: {
      data: {
        characterId: string;
        actionType: string;
        targetTable?: string;
        targetId?: string;
        reason: string;
      };
    }): Promise<unknown>;
    findMany(input: {
      orderBy: { createdAt: "desc" };
      take: number;
    }): Promise<PrismaCharacterActionLog[]>;
  };
  creditLedgerEntry: {
    create(input: {
      data: {
        userId: string;
        entryType: CreditEntryType;
        amount: number;
        reason: string;
        externalReference?: string;
      };
    }): Promise<PrismaCreditEntry>;
    findFirst(input: {
      where: { id: string; userId: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    findMany(input: {
      where: { userId: string };
      orderBy: [{ createdAt: "desc" }, { id: "desc" }];
      take: number;
      cursor?: { id: string };
      skip?: number;
    }): Promise<PrismaCreditEntry[]>;
    findMany(input: {
      where: {
        entryType: "grant";
        externalReference: { in: string[] };
      };
      select: { externalReference: true };
    }): Promise<Array<{ externalReference: string | null }>>;
    aggregate(input: {
      where: { entryType: CreditEntryType } & CreatedAtWhere;
      _sum: { amount: true };
    }): Promise<{ _sum: { amount: number | null } }>;
  };
  creditPurchase: {
    findUnique(input: {
      where: { id: string };
    }): Promise<PrismaCreditPurchase | null>;
    findMany(input: {
      where: CreatedAtWhere;
      orderBy: [{ createdAt: "desc" }, { id: "desc" }];
    }): Promise<PrismaCreditPurchase[]>;
  };
  generationJob: {
    count(input: { where: CreatedAtWhere }): Promise<number>;
  };
  message: {
    count(input: { where: CreatedAtWhere }): Promise<number>;
  };
  media: {
    findFirst(input: {
      where: {
        id: string;
        mediaType?: MediaType;
        uploadedAt?: null | { not: null };
      };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    findMany(input: {
      where: {
        mediaType?: MediaType;
        uploadedAt?: null | { not: null };
      };
      orderBy: [{ createdAt: "desc" }, { id: "desc" }];
      take: number;
      cursor?: { id: string };
      skip?: number;
      select: typeof mediaFields;
    }): Promise<PrismaAdminMedia[]>;
    findUnique(input: {
      where: { id: string };
      select: typeof mediaFields;
    }): Promise<PrismaAdminMedia | null>;
    findUnique(input: {
      where: { id: string };
      select: {
        id: true;
        mediaType: true;
        uploadedAt: true;
      };
    }): Promise<{
      id: string;
      mediaType: MediaType;
      uploadedAt: Date | null;
    } | null>;
  };
  post: {
    create(input: {
      data: {
        characterId: string;
        content: string;
        hashtags: {
          create: Array<{
            hashtag: {
              connectOrCreate: {
                where: { name: string };
                create: { name: string };
              };
            };
          }>;
        };
        postMedia: {
          create: Array<{
            sortOrder: number;
            media: { connect: { id: string } } | { create: DirectMediaInput };
          }>;
        };
      };
      include: typeof postWithMedia;
    }): Promise<PrismaPost>;
    findUnique(input: {
      where: { id: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  postComment: {
    create(input: {
      data: {
        postId: string;
        characterId: string;
        body: string;
      };
    }): Promise<PrismaPostComment>;
  };
  postReaction: {
    create(input: {
      data: {
        postId: string;
        characterId: string;
        reactionType: string;
      };
    }): Promise<PrismaPostReaction>;
  };
  report: {
    findUnique(input: { where: { id: string } }): Promise<PrismaReport | null>;
    findUnique(input: {
      where: { id: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    findFirst(input: {
      where: { id: string; status?: ReportStatus };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    findMany(input: {
      where: { status?: ReportStatus };
      orderBy: [{ createdAt: "desc" }, { id: "desc" }];
      take: number;
      cursor?: { id: string };
      skip?: number;
    }): Promise<PrismaReport[]>;
    update(input: {
      where: { id: string };
      data: { status: ReportStatus; resolution: string | null };
    }): Promise<PrismaReport>;
  };
  user: {
    findUnique(input: {
      where: { id: string };
      select: typeof userFields;
    }): Promise<PrismaAdminUser | null>;
    findUnique(input: {
      where: { id: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    findFirst(input: {
      where: {
        id: string;
        OR?: Array<{
          email?: { contains: string; mode: "insensitive" };
          displayName?: { contains: string; mode: "insensitive" };
        }>;
      };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    findMany(input: {
      where: {
        OR?: Array<{
          email?: { contains: string; mode: "insensitive" };
          displayName?: { contains: string; mode: "insensitive" };
        }>;
      };
      orderBy: [{ createdAt: "desc" }, { id: "desc" }];
      take: number;
      cursor?: { id: string };
      skip?: number;
      select: typeof userFields;
    }): Promise<PrismaAdminUser[]>;
  };
  userEvent: {
    count(input: { where: CreatedAtWhere }): Promise<number>;
    findFirst(input: {
      where: {
        id: string;
        userId?: string;
        targetType?: string;
        targetId?: string;
      };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    findMany(input: {
      where: {
        userId?: string;
        targetType?: string;
        targetId?: string;
      };
      orderBy: [{ createdAt: "desc" }, { id: "desc" }];
      take: number;
      cursor?: { id: string };
      skip?: number;
    }): Promise<PrismaUserEvent[]>;
  };
  userHashtagPreference: {
    findMany(input: {
      where: { userId: string };
      orderBy: [{ score: "desc" }, { hashtag: { name: "asc" } }];
      include: { hashtag: { select: { name: true } } };
    }): Promise<PrismaHashtagPreference[]>;
  };
};

const userFields = {
  id: true,
  displayName: true,
  email: true,
  createdAt: true,
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
} as const;

@Injectable()
export class AdminService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: AdminPrismaClient,
    private readonly generationService: GenerationService,
    private readonly mediaService: MediaService,
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
    return pageFromRows(
      users.map((user) => this.toAdminUser(user)),
      input.limit,
    );
  }

  async getUser(userId: string): Promise<AdminUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: userFields,
    });
    if (!user) {
      throw new BadRequestException("User not found");
    }
    return this.toAdminUser(user);
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
    if (!userId) {
      throw new BadRequestException("User ID is required");
    }
    const preferences = await this.prisma.userHashtagPreference.findMany({
      where: { userId },
      orderBy: [{ score: "desc" }, { hashtag: { name: "asc" } }],
      include: { hashtag: { select: { name: true } } },
    });
    return {
      items: preferences.map((preference) =>
        this.toHashtagPreference(preference),
      ),
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

  async createPost(input: {
    actorType: ActorType;
    actorId: string;
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

    await this.assertStoredMedia(input.media);
    const hashtags = this.cleanHashtags(input.hashtags);
    const post = this.toPost(
      await this.prisma.post.create({
        data: {
          characterId: input.actorId,
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
      characterId: comment.characterId,
      actionType: "POST_COMMENT_CREATED",
      targetTable: "post_comments",
      targetId: comment.id,
      reason: input.reason?.trim() || "post comment created",
    });
    return comment;
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
      characterId: reaction.characterId,
      actionType: "POST_REACTION_CREATED",
      targetTable: "post_reactions",
      targetId: reaction.id,
      reason: input.reason?.trim() || "post reaction created",
    });
    return reaction;
  }

  startMediaUpload(input: Parameters<MediaService["startUpload"]>[0]) {
    return this.mediaService.startUpload(input);
  }

  confirmMediaUpload(mediaId: string) {
    return this.mediaService.confirmUpload(mediaId);
  }

  grantCredits(input: {
    userId: string;
    amount: number;
    reason: string;
    externalReference?: string;
  }) {
    return this.appendCreditEntry("grant", input);
  }

  async listCreditLedger(
    input: { userId?: string } & PageInput,
  ): Promise<Page<CreditEntry>> {
    const userId = input.userId?.trim();
    if (!userId) {
      throw new BadRequestException("User ID is required");
    }
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.prisma.creditLedgerEntry.findFirst({
        where: { id: cursorId, userId },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const entries = await this.prisma.creditLedgerEntry.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    return pageFromRows(
      entries.map((entry) => this.toCreditEntry(entry)),
      input.limit,
    );
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

  async listCharacterActionLogs() {
    const logs = await this.prisma.characterActionLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return logs.map((log) => ({
      id: log.id.toString(),
      characterId: log.characterId,
      actionType: log.actionType,
      targetTable: log.targetTable ?? undefined,
      targetId: log.targetId ?? undefined,
      reason: log.reason,
      createdAt: log.createdAt.toISOString(),
    }));
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
    const metrics: Array<{ name: AnalyticsMetricName; value: number }> = [];

    if (!metric || metric === "events.count") {
      metrics.push({
        name: "events.count",
        value: await this.prisma.userEvent.count({ where }),
      });
    }
    if (!metric || metric === "messages.count") {
      metrics.push({
        name: "messages.count",
        value: await this.prisma.message.count({ where }),
      });
    }
    if (!metric || metric === "credits.granted") {
      const grant = await this.prisma.creditLedgerEntry.aggregate({
        where: { entryType: "grant", ...where },
        _sum: { amount: true },
      });
      metrics.push({
        name: "credits.granted",
        value: grant._sum.amount ?? 0,
      });
    }
    if (!metric || metric === "credits.debited") {
      const debit = await this.prisma.creditLedgerEntry.aggregate({
        where: { entryType: "debit", ...where },
        _sum: { amount: true },
      });
      metrics.push({
        name: "credits.debited",
        value: debit._sum.amount ?? 0,
      });
    }
    if (!metric || metric === "generation_jobs.count") {
      metrics.push({
        name: "generation_jobs.count",
        value: await this.prisma.generationJob.count({ where }),
      });
    }

    return { metrics };
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
    const references = purchases.map(
      (purchase) => `credit_purchase:${purchase.id}`,
    );
    const grantReferences =
      references.length === 0
        ? new Set<string>()
        : new Set(
            (
              await this.prisma.creditLedgerEntry.findMany({
                where: {
                  entryType: "grant",
                  externalReference: { in: references },
                },
                select: { externalReference: true },
              })
            )
              .map((entry) => entry.externalReference)
              .filter((reference): reference is string => Boolean(reference)),
          );

    return {
      items: purchases
        .map((purchase) =>
          this.toPaymentReconciliationRow(
            purchase,
            grantReferences.has(`credit_purchase:${purchase.id}`),
          ),
        )
        .filter((item) => !status || item.reconciliationStatus === status)
        .map((item) => ({
          paymentId: item.paymentId,
          userId: item.userId,
          provider: item.provider,
          providerStatus: item.providerStatus,
          ledgerStatus: item.ledgerStatus,
          ...(item.reason ? { reason: item.reason } : {}),
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
    },
  ): Promise<CreditEntry> {
    this.validateCreditEntryInput(input);

    const entry = await this.prisma.creditLedgerEntry.create({
      data: {
        userId: input.userId,
        entryType,
        amount: input.amount,
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
      createdAt: post.createdAt.toISOString(),
    };
  }

  private toPostComment(comment: PrismaPostComment): AdminPostComment {
    return {
      id: comment.id,
      postId: comment.postId,
      characterId: comment.characterId,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
    };
  }

  private toPostReaction(reaction: PrismaPostReaction): AdminPostReaction {
    return {
      id: reaction.id,
      postId: reaction.postId,
      characterId: reaction.characterId,
      reactionType: reaction.reactionType,
      createdAt: reaction.createdAt.toISOString(),
    };
  }

  private toAdminUser(user: PrismaAdminUser): AdminUser {
    return {
      id: user.id,
      displayName: user.displayName,
      ...(user.email ? { email: user.email } : {}),
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
    hasGrant: boolean,
  ): PaymentReconciliationRow {
    if (purchase.status === "pending") {
      return {
        paymentId: purchase.id,
        userId: purchase.userId,
        provider: purchase.provider,
        providerStatus: purchase.status,
        ledgerStatus: hasGrant ? "granted" : "not_granted",
        reconciliationStatus: hasGrant ? "mismatch" : "pending",
        ...(hasGrant
          ? { reason: "pending purchase has credit grant" }
          : { reason: "payment pending" }),
      };
    }

    if (purchase.status === "paid") {
      return {
        paymentId: purchase.id,
        userId: purchase.userId,
        provider: purchase.provider,
        providerStatus: purchase.status,
        ledgerStatus: hasGrant ? "granted" : "missing_grant",
        reconciliationStatus: hasGrant ? "resolved" : "mismatch",
        ...(hasGrant ? {} : { reason: "paid purchase has no credit grant" }),
      };
    }

    return {
      paymentId: purchase.id,
      userId: purchase.userId,
      provider: purchase.provider,
      providerStatus: purchase.status,
      ledgerStatus: hasGrant ? "granted" : "not_granted",
      reconciliationStatus: hasGrant ? "mismatch" : "resolved",
      ...(hasGrant ? { reason: "non-paid purchase has credit grant" } : {}),
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
    if (
      value === "events.count" ||
      value === "messages.count" ||
      value === "credits.granted" ||
      value === "credits.debited" ||
      value === "generation_jobs.count"
    ) {
      return value;
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
