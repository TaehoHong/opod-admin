import { AdminService } from "./admin.service";

describe("AdminService", () => {
  it("lists top global hashtags by post count", async () => {
    const findMany = jest.fn().mockResolvedValue([
      { name: "opod", _count: { posts: 42 } },
      { name: "launch", _count: { posts: 18 } },
    ]);
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      { hashtag: { findMany } },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(service.listTopHashtags({ limit: 10 })).resolves.toEqual({
      items: [
        { hashtag: "opod", postCount: 42 },
        { hashtag: "launch", postCount: 18 },
      ],
    });
    expect(findMany).toHaveBeenCalledWith({
      orderBy: [{ posts: { _count: "desc" } }, { name: "asc" }],
      take: 10,
      select: {
        name: true,
        _count: { select: { posts: true } },
      },
    });
  });

  it("returns filtered analytics metrics", async () => {
    const aggregate = jest.fn().mockResolvedValue({ _sum: { amount: 42 } });
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      {
        creditLedgerEntry: { aggregate },
        generationJob: { count: jest.fn() },
        message: { count: jest.fn() },
        userEvent: { count: jest.fn() },
      },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(
      service.getAnalytics({
        metric: "credits.debited",
        from: "2026-07-01T00:00:00.000Z",
        to: "2026-07-02T00:00:00.000Z",
      }),
    ).resolves.toEqual({
      metrics: [{ name: "credits.debited", value: 42 }],
    });
    expect(aggregate).toHaveBeenCalledWith({
      where: {
        entryType: "debit",
        createdAt: {
          gte: new Date("2026-07-01T00:00:00.000Z"),
          lte: new Date("2026-07-02T00:00:00.000Z"),
        },
      },
      _sum: { amount: true },
    });
  });

  it("lists payment reconciliation mismatches", async () => {
    const createdAt = new Date("2026-07-02T00:00:00.000Z");
    const paidWithoutGrant = {
      id: "purchase-missing",
      userId: "human-1",
      provider: "local",
      status: "paid" as const,
      creditAmount: 100,
      paidAmount: 9900,
      currency: "KRW",
      createdAt,
      updatedAt: createdAt,
    };
    const paidWithGrant = {
      ...paidWithoutGrant,
      id: "purchase-granted",
    };
    const findPurchases = jest
      .fn()
      .mockResolvedValue([paidWithoutGrant, paidWithGrant]);
    const findLedgerEntries = jest.fn().mockResolvedValue([
      {
        externalReference: "credit_purchase:purchase-granted",
      },
    ]);
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      {
        creditLedgerEntry: { findMany: findLedgerEntries },
        creditPurchase: { findMany: findPurchases },
      },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(
      service.listPaymentReconciliation({
        status: "mismatch",
        from: "2026-07-01T00:00:00.000Z",
        to: "2026-07-03T00:00:00.000Z",
      }),
    ).resolves.toEqual({
      items: [
        {
          paymentId: "purchase-missing",
          userId: "human-1",
          provider: "local",
          providerStatus: "paid",
          ledgerStatus: "missing_grant",
          reason: "paid purchase has no credit grant",
        },
      ],
    });
    expect(findPurchases).toHaveBeenCalledWith({
      where: {
        createdAt: {
          gte: new Date("2026-07-01T00:00:00.000Z"),
          lte: new Date("2026-07-03T00:00:00.000Z"),
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(findLedgerEntries).toHaveBeenCalledWith({
      where: {
        entryType: "grant",
        externalReference: {
          in: [
            "credit_purchase:purchase-missing",
            "credit_purchase:purchase-granted",
          ],
        },
      },
      select: { externalReference: true },
    });
  });

  it("lists reports with status-filtered cursor pagination", async () => {
    const createdAt = new Date("2026-07-02T00:00:00.000Z");
    const newerReport = {
      id: "report-2",
      reporterUserId: "human-1",
      targetType: "post" as const,
      targetId: "post-1",
      reason: "unsafe content",
      details: "needs review",
      status: "submitted" as const,
      createdAt,
      updatedAt: createdAt,
    };
    const olderReport = {
      ...newerReport,
      id: "report-1",
      reason: "spam",
      details: null,
    };
    const findMany = jest.fn().mockResolvedValue([newerReport, olderReport]);
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      {
        report: {
          findMany,
        },
      },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(
      service.listReports({ status: "submitted", limit: 1 }),
    ).resolves.toEqual({
      items: [
        {
          ...newerReport,
          createdAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString(),
        },
      ],
      nextCursor: expect.any(String),
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { status: "submitted" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2,
    });
  });

  it("updates report status and resolution", async () => {
    const createdAt = new Date("2026-07-02T00:00:00.000Z");
    const updatedAt = new Date("2026-07-02T00:10:00.000Z");
    const update = jest.fn().mockResolvedValue({
      id: "report-1",
      reporterUserId: "human-1",
      targetType: "post",
      targetId: "post-1",
      reason: "unsafe content",
      details: null,
      resolution: "handled",
      status: "resolved",
      createdAt,
      updatedAt,
    });
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      {
        report: {
          findUnique: jest.fn().mockResolvedValue({ id: "report-1" }),
          update,
        },
      },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(
      service.updateReport({
        reportId: "report-1",
        status: "resolved",
        resolution: " handled ",
      }),
    ).resolves.toEqual({
      id: "report-1",
      status: "resolved",
      updatedAt: updatedAt.toISOString(),
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "report-1" },
      data: {
        status: "resolved",
        resolution: "handled",
      },
    });
  });

  it("runs generation jobs through the local provider and records logs", async () => {
    const startJob = jest.fn().mockResolvedValue({
      id: "job-1",
      characterId: "ai-1",
      status: "running",
    });
    const createLog = jest.fn().mockResolvedValue(undefined);
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      {
        characterActionLog: {
          create: createLog,
        },
      },
      { enqueueJob: jest.fn(), startJob, completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(
      service.runGenerationJob({
        jobId: "job-1",
        provider: " local ",
      }),
    ).resolves.toEqual({
      id: "job-1",
      status: "running",
    });
    expect(startJob).toHaveBeenCalledWith("job-1");
    expect(createLog).toHaveBeenCalledWith({
      data: {
        characterId: "ai-1",
        actionType: "GENERATION_JOB_RUN",
        targetTable: "generation_jobs",
        targetId: "job-1",
        reason: "generation job run requested via local provider",
      },
    });
  });

  it("delegates generation job reads without recording action logs", async () => {
    const listJobs = jest.fn().mockResolvedValue({ items: [] });
    const getJob = jest.fn().mockResolvedValue({ id: "job-1" });
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      {},
      { listJobs, getJob },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(
      service.listGenerationJobs({ status: "queued", limit: 20 }),
    ).resolves.toEqual({ items: [] });
    await expect(service.getGenerationJob("job-1")).resolves.toEqual({
      id: "job-1",
    });
    expect(listJobs).toHaveBeenCalledWith({ status: "queued", limit: 20 });
    expect(getJob).toHaveBeenCalledWith("job-1");
  });

  it("lists filtered posts with cursor pagination", async () => {
    const createdAt = new Date("2026-07-12T00:00:00.000Z");
    const cursor = Buffer.from(
      JSON.stringify({ id: "post-cursor" }),
      "utf8",
    ).toString("base64url");
    const findFirst = jest.fn().mockResolvedValue({ id: "post-cursor" });
    const findMany = jest.fn().mockResolvedValue([
      {
        id: "post-2",
        characterId: "ai-1",
        contentType: "feed",
        content: "newer",
        createdAt,
        postMedia: [
          {
            media: {
              mediaType: "image",
              url: "https://cdn.local/newer.png",
              width: 1080,
              height: 1080,
              durationSeconds: null,
            },
          },
        ],
        hashtags: [{ hashtag: { name: "launch" } }],
      },
      {
        id: "post-1",
        characterId: "ai-1",
        contentType: "feed",
        content: "older",
        createdAt,
        postMedia: [],
        hashtags: [],
      },
    ]);
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      { post: { findFirst, findMany } },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(
      service.listPosts({
        characterId: " ai-1 ",
        contentType: " feed ",
        cursor,
        limit: 1,
      }),
    ).resolves.toEqual({
      items: [
        {
          id: "post-2",
          characterId: "ai-1",
          contentType: "feed",
          content: "newer",
          media: [
            {
              mediaType: "image",
              url: "https://cdn.local/newer.png",
              width: 1080,
              height: 1080,
            },
          ],
          hashtags: ["launch"],
          createdAt: createdAt.toISOString(),
        },
      ],
      nextCursor: expect.any(String),
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: "post-cursor",
        characterId: "ai-1",
        contentType: "feed",
      },
      select: { id: true },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { characterId: "ai-1", contentType: "feed" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2,
      cursor: { id: "post-cursor" },
      skip: 1,
      include: {
        postMedia: {
          include: { media: true },
          orderBy: { sortOrder: "asc" },
        },
        hashtags: {
          include: { hashtag: true },
          orderBy: { hashtag: { name: "asc" } },
        },
      },
    });
  });

  it("rejects a post cursor outside the active filters", async () => {
    const cursor = Buffer.from(
      JSON.stringify({ id: "post-cursor" }),
      "utf8",
    ).toString("base64url");
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      {
        post: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
        },
      },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(
      service.listPosts({ characterId: "ai-1", cursor, limit: 20 }),
    ).rejects.toThrow("Invalid cursor");
  });

  it("rejects an invalid post list content type", async () => {
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      {
        post: {
          findFirst: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
        },
      },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(
      service.listPosts({ contentType: "article", limit: 20 }),
    ).rejects.toThrow("Post content type must be feed or reel");
  });

  it("gets a post with the admin post representation", async () => {
    const createdAt = new Date("2026-07-12T00:00:00.000Z");
    const findUnique = jest.fn().mockResolvedValue({
      id: "post-1",
      characterId: "ai-1",
      contentType: "reel",
      content: "detail",
      createdAt,
      postMedia: [
        {
          media: {
            mediaType: "video",
            url: "https://cdn.local/detail.mp4",
            width: 1080,
            height: 1920,
            durationSeconds: 15,
          },
        },
      ],
      hashtags: [{ hashtag: { name: "detail" } }],
    });
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      { post: { findUnique } },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(service.getPost("post-1")).resolves.toEqual({
      id: "post-1",
      characterId: "ai-1",
      contentType: "reel",
      content: "detail",
      media: [
        {
          mediaType: "video",
          url: "https://cdn.local/detail.mp4",
          width: 1080,
          height: 1920,
          durationSeconds: 15,
        },
      ],
      hashtags: ["detail"],
      createdAt: createdAt.toISOString(),
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "post-1" },
      include: {
        postMedia: {
          include: { media: true },
          orderBy: { sortOrder: "asc" },
        },
        hashtags: {
          include: { hashtag: true },
          orderBy: { hashtag: { name: "asc" } },
        },
      },
    });
  });

  it("rejects a missing post detail", async () => {
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      { post: { findUnique: jest.fn().mockResolvedValue(null) } },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(service.getPost("missing-post")).rejects.toThrow(
      "Post not found",
    );
  });

  it("lists post comments with author-filtered cursor pagination", async () => {
    const createdAt = new Date("2026-07-12T00:00:00.000Z");
    const cursor = Buffer.from(
      JSON.stringify({ id: "comment-cursor" }),
      "utf8",
    ).toString("base64url");
    const findFirst = jest.fn().mockResolvedValue({ id: "comment-cursor" });
    const findMany = jest.fn().mockResolvedValue([
      {
        id: "comment-2",
        postId: "post-1",
        characterId: "ai-1",
        body: "newer",
        createdAt,
      },
      {
        id: "comment-1",
        postId: "post-1",
        characterId: "ai-1",
        body: "older",
        createdAt,
      },
    ]);
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      {
        post: { findUnique: jest.fn().mockResolvedValue({ id: "post-1" }) },
        postComment: { findFirst, findMany },
      },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(
      service.listPostComments({
        postId: "post-1",
        characterId: " ai-1 ",
        cursor,
        limit: 1,
      }),
    ).resolves.toEqual({
      items: [
        {
          id: "comment-2",
          postId: "post-1",
          characterId: "ai-1",
          body: "newer",
          createdAt: createdAt.toISOString(),
        },
      ],
      nextCursor: expect.any(String),
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: "comment-cursor",
        postId: "post-1",
        characterId: "ai-1",
      },
      select: { id: true },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { postId: "post-1", characterId: "ai-1" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2,
      cursor: { id: "comment-cursor" },
      skip: 1,
    });
  });

  it("rejects listing comments for a missing post", async () => {
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      {
        post: { findUnique: jest.fn().mockResolvedValue(null) },
        postComment: { findFirst: jest.fn(), findMany: jest.fn() },
      },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(
      service.listPostComments({ postId: "missing-post", limit: 20 }),
    ).rejects.toThrow("Post not found");
  });

  it("rejects a post comment cursor outside the active post", async () => {
    const cursor = Buffer.from(
      JSON.stringify({ id: "comment-cursor" }),
      "utf8",
    ).toString("base64url");
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      {
        post: { findUnique: jest.fn().mockResolvedValue({ id: "post-1" }) },
        postComment: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn(),
        },
      },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(
      service.listPostComments({ postId: "post-1", cursor, limit: 20 }),
    ).rejects.toThrow("Invalid cursor");
  });

  it("lists post reactions with filtered cursor pagination", async () => {
    const createdAt = new Date("2026-07-12T00:00:00.000Z");
    const cursor = Buffer.from(
      JSON.stringify({ id: "reaction-cursor" }),
      "utf8",
    ).toString("base64url");
    const findFirst = jest.fn().mockResolvedValue({ id: "reaction-cursor" });
    const findMany = jest.fn().mockResolvedValue([
      {
        id: "reaction-2",
        postId: "post-1",
        characterId: "ai-1",
        reactionType: "like",
        createdAt,
      },
      {
        id: "reaction-1",
        postId: "post-1",
        characterId: "ai-1",
        reactionType: "like",
        createdAt,
      },
    ]);
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      {
        post: { findUnique: jest.fn().mockResolvedValue({ id: "post-1" }) },
        postReaction: { findFirst, findMany },
      },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(
      service.listPostReactions({
        postId: "post-1",
        characterId: " ai-1 ",
        reactionType: " like ",
        cursor,
        limit: 1,
      }),
    ).resolves.toEqual({
      items: [
        {
          id: "reaction-2",
          postId: "post-1",
          characterId: "ai-1",
          reactionType: "like",
          createdAt: createdAt.toISOString(),
        },
      ],
      nextCursor: expect.any(String),
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: "reaction-cursor",
        postId: "post-1",
        characterId: "ai-1",
        reactionType: "like",
      },
      select: { id: true },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        postId: "post-1",
        characterId: "ai-1",
        reactionType: "like",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2,
      cursor: { id: "reaction-cursor" },
      skip: 1,
    });
  });

  it("rejects listing reactions for a missing post", async () => {
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      {
        post: { findUnique: jest.fn().mockResolvedValue(null) },
        postReaction: { findFirst: jest.fn(), findMany: jest.fn() },
      },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(
      service.listPostReactions({ postId: "missing-post", limit: 20 }),
    ).rejects.toThrow("Post not found");
  });

  it("rejects a post reaction cursor outside the active post", async () => {
    const cursor = Buffer.from(
      JSON.stringify({ id: "reaction-cursor" }),
      "utf8",
    ).toString("base64url");
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      {
        post: { findUnique: jest.fn().mockResolvedValue({ id: "post-1" }) },
        postReaction: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn(),
        },
      },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(
      service.listPostReactions({ postId: "post-1", cursor, limit: 20 }),
    ).rejects.toThrow("Invalid cursor");
  });

  it("lists stories with character-filtered cursor pagination", async () => {
    const createdAt = new Date("2026-07-12T00:00:00.000Z");
    const expiresAt = new Date("2026-07-13T00:00:00.000Z");
    const cursor = Buffer.from(
      JSON.stringify({ id: "story-cursor" }),
      "utf8",
    ).toString("base64url");
    const findFirst = jest.fn().mockResolvedValue({ id: "story-cursor" });
    const findMany = jest.fn().mockResolvedValue([
      {
        id: "story-2",
        characterId: "ai-1",
        caption: "newer",
        media: {
          mediaType: "image",
          url: "https://cdn.local/story.png",
          width: 1080,
          height: 1920,
          durationSeconds: null,
        },
        createdAt,
        expiresAt,
      },
      {
        id: "story-1",
        characterId: "ai-1",
        caption: "older",
        media: {
          mediaType: "image",
          url: "https://cdn.local/older.png",
          width: null,
          height: null,
          durationSeconds: null,
        },
        createdAt,
        expiresAt,
      },
    ]);
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      { story: { findFirst, findMany } },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(
      service.listStories({
        characterId: " ai-1 ",
        cursor,
        limit: 1,
      }),
    ).resolves.toEqual({
      items: [
        {
          id: "story-2",
          characterId: "ai-1",
          caption: "newer",
          media: {
            mediaType: "image",
            url: "https://cdn.local/story.png",
            width: 1080,
            height: 1920,
          },
          createdAt: createdAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
      ],
      nextCursor: expect.any(String),
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "story-cursor", characterId: "ai-1" },
      select: { id: true },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { characterId: "ai-1" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2,
      cursor: { id: "story-cursor" },
      skip: 1,
      include: { media: true },
    });
  });

  it("rejects a story cursor outside the active filters", async () => {
    const cursor = Buffer.from(
      JSON.stringify({ id: "story-cursor" }),
      "utf8",
    ).toString("base64url");
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      {
        story: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn(),
        },
      },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(
      service.listStories({ characterId: "ai-1", cursor, limit: 20 }),
    ).rejects.toThrow("Invalid cursor");
  });

  it("gets a story with the creation response shape", async () => {
    const createdAt = new Date("2026-07-12T00:00:00.000Z");
    const expiresAt = new Date("2026-07-13T00:00:00.000Z");
    const findUnique = jest.fn().mockResolvedValue({
      id: "story-1",
      characterId: "ai-1",
      caption: "detail",
      media: {
        mediaType: "video",
        url: "https://cdn.local/story.mp4",
        width: 1080,
        height: 1920,
        durationSeconds: 15,
      },
      createdAt,
      expiresAt,
    });
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      { story: { findUnique } },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(service.getStory("story-1")).resolves.toEqual({
      id: "story-1",
      characterId: "ai-1",
      caption: "detail",
      media: {
        mediaType: "video",
        url: "https://cdn.local/story.mp4",
        width: 1080,
        height: 1920,
        durationSeconds: 15,
      },
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "story-1" },
      include: { media: true },
    });
  });

  it("rejects a missing story detail", async () => {
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      { story: { findUnique: jest.fn().mockResolvedValue(null) } },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(service.getStory("missing-story")).rejects.toThrow(
      "Story not found",
    );
  });

  it("creates AI posts through admin-owned Prisma code and records logs", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const createLog = jest.fn().mockResolvedValue(undefined);
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 1n,
        characterId: "ai-1",
        actionType: "POST_CREATED",
        targetTable: "posts",
        targetId: "post-1",
        reason: "daily post",
        createdAt,
      },
    ]);
    const postCreate = jest.fn().mockResolvedValue({
      id: "post-1",
      characterId: "ai-1",
      contentType: "reel",
      content: "hello",
      hashtags: [],
      createdAt,
      postMedia: [
        {
          media: {
            mediaType: "image",
            url: "https://cdn.local/post.png",
          },
        },
      ],
    });
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      {
        characterActionLog: {
          create: createLog,
          findMany,
        },
        character: {
          findUnique: jest.fn().mockResolvedValue({ id: "ai-1" }),
        },
        post: {
          create: postCreate,
        },
      },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await service.createPost({
      actorType: "character",
      actorId: "ai-1",
      contentType: "reel",
      content: "hello",
      reason: "daily post",
      media: [{ mediaType: "image", url: "https://cdn.local/post.png" }],
    });

    expect(postCreate).toHaveBeenCalledWith({
      data: {
        characterId: "ai-1",
        contentType: "reel",
        content: "hello",
        hashtags: {
          create: [],
        },
        postMedia: {
          create: [
            {
              sortOrder: 0,
              media: {
                create: {
                  mediaType: "image",
                  url: "https://cdn.local/post.png",
                },
              },
            },
          ],
        },
      },
      include: {
        hashtags: {
          include: { hashtag: true },
          orderBy: { hashtag: { name: "asc" } },
        },
        postMedia: {
          include: { media: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    expect(createLog).toHaveBeenCalledWith({
      data: {
        characterId: "ai-1",
        actionType: "POST_CREATED",
        targetTable: "posts",
        targetId: "post-1",
        reason: "daily post",
      },
    });
    await expect(service.listCharacterActionLogs()).resolves.toEqual([
      {
        id: "1",
        characterId: "ai-1",
        actionType: "POST_CREATED",
        targetTable: "posts",
        targetId: "post-1",
        reason: "daily post",
        createdAt: createdAt.toISOString(),
      },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  });

  it("creates avatar stories with confirmed uploaded media", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const expiresAt = new Date("2026-07-01T00:00:00.000Z");
    const createLog = jest.fn().mockResolvedValue(undefined);
    const storyCreate = jest.fn().mockResolvedValue({
      id: "story-1",
      characterId: "ai-1",
      caption: "daily story",
      createdAt,
      expiresAt,
      media: {
        mediaType: "image",
        url: "pod/stories/character/ai-1/story.png",
      },
    });
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      {
        characterActionLog: {
          create: createLog,
        },
        character: {
          findUnique: jest.fn().mockResolvedValue({ id: "ai-1" }),
        },
        media: {
          findUnique: jest.fn().mockResolvedValue({
            id: "media-1",
            mediaType: "image",
            uploadedAt: createdAt,
          }),
        },
        story: {
          create: storyCreate,
        },
      },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(
      service.createStory({
        characterId: "ai-1",
        caption: " daily story ",
        reason: "operator story",
        media: { mediaId: "media-1" },
      }),
    ).resolves.toEqual({
      id: "story-1",
      characterId: "ai-1",
      caption: "daily story",
      media: {
        mediaType: "image",
        url: "pod/stories/character/ai-1/story.png",
      },
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    expect(storyCreate).toHaveBeenCalledWith({
      data: {
        character: { connect: { id: "ai-1" } },
        caption: "daily story",
        expiresAt: expect.any(Date),
        media: { connect: { id: "media-1" } },
      },
      include: { media: true },
    });
    expect(createLog).toHaveBeenCalledWith({
      data: {
        characterId: "ai-1",
        actionType: "STORY_CREATED",
        targetTable: "stories",
        targetId: "story-1",
        reason: "operator story",
      },
    });
  });
});
