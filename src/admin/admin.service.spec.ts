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

  it("lists user follow counts", async () => {
    const createdAt = new Date("2026-07-12T00:00:00.000Z");
    const grantGroupBy = jest
      .fn()
      .mockResolvedValue([
        { userId: "user-1", _sum: { remainingAmount: 120 } },
      ]);
    const reservationGroupBy = jest
      .fn()
      .mockResolvedValue([{ userId: "user-1", _sum: { amount: 12 } }]);
    const findMany = jest.fn().mockResolvedValue([
      {
        id: "user-1",
        displayName: "Taeho",
        email: "taeho@example.com",
        createdAt,
        _count: { characterFollows: 7 },
      },
    ]);
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      {
        user: { findMany },
        creditLedgerEntry: { groupBy: grantGroupBy },
        creditReservation: { groupBy: reservationGroupBy },
      },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(service.listUsers({ limit: 20 })).resolves.toEqual({
      items: [
        {
          id: "user-1",
          displayName: "Taeho",
          email: "taeho@example.com",
          followCount: 7,
          creditBalance: 108,
          createdAt: createdAt.toISOString(),
        },
      ],
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 21,
      select: expect.objectContaining({
        _count: { select: { characterFollows: true } },
      }),
    });
    expect(grantGroupBy).toHaveBeenCalledWith({
      by: ["userId"],
      where: {
        userId: { in: ["user-1"] },
        entryType: "grant",
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
      },
      _sum: { remainingAmount: true },
    });
    expect(reservationGroupBy).toHaveBeenCalledWith({
      by: ["userId"],
      where: {
        userId: { in: ["user-1"] },
        status: "reserved",
        expiresAt: { gt: expect.any(Date) },
      },
      _sum: { amount: true },
    });
  });

  it("gets user follow count and spendable credit balance", async () => {
    const createdAt = new Date("2026-07-12T00:00:00.000Z");
    const grantAggregate = jest
      .fn()
      .mockResolvedValue({ _sum: { remainingAmount: 120 } });
    const reservationAggregate = jest
      .fn()
      .mockResolvedValue({ _sum: { amount: 12 } });
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: "user-1",
            displayName: "Taeho",
            email: "taeho@example.com",
            createdAt,
            _count: { characterFollows: 7 },
          }),
        },
        creditLedgerEntry: { aggregate: grantAggregate },
        creditReservation: { aggregate: reservationAggregate },
      },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(service.getUser("user-1")).resolves.toEqual({
      id: "user-1",
      displayName: "Taeho",
      email: "taeho@example.com",
      followCount: 7,
      creditBalance: 108,
      createdAt: createdAt.toISOString(),
    });
    expect(grantAggregate).toHaveBeenCalledWith({
      _sum: { remainingAmount: true },
      where: {
        userId: "user-1",
        entryType: "grant",
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
      },
    });
    expect(reservationAggregate).toHaveBeenCalledWith({
      _sum: { amount: true },
      where: {
        userId: "user-1",
        status: "reserved",
        expiresAt: { gt: expect.any(Date) },
      },
    });
    const grantNow = grantAggregate.mock.calls[0][0].where.OR[1].expiresAt.gt;
    const reservationNow =
      reservationAggregate.mock.calls[0][0].where.expiresAt.gt;
    expect(grantNow.getTime()).toBe(reservationNow.getTime());
  });

  it("clamps a negative spendable credit balance to zero", async () => {
    const createdAt = new Date("2026-07-12T00:00:00.000Z");
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: "user-1",
            displayName: "Taeho",
            email: null,
            createdAt,
            _count: { characterFollows: 0 },
          }),
        },
        creditLedgerEntry: {
          aggregate: jest
            .fn()
            .mockResolvedValue({ _sum: { remainingAmount: 5 } }),
        },
        creditReservation: {
          aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 7 } }),
        },
      },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(service.getUser("user-1")).resolves.toMatchObject({
      id: "user-1",
      creditBalance: 0,
    });
  });

  it("does not aggregate credit balance for a missing user", async () => {
    const grantAggregate = jest.fn();
    const reservationAggregate = jest.fn();
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      {
        user: { findUnique: jest.fn().mockResolvedValue(null) },
        creditLedgerEntry: { aggregate: grantAggregate },
        creditReservation: { aggregate: reservationAggregate },
      },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(service.getUser("missing-user")).rejects.toThrow(
      "User not found",
    );
    expect(grantAggregate).not.toHaveBeenCalled();
    expect(reservationAggregate).not.toHaveBeenCalled();
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
          creditAmount: 100,
          paidAmount: 9900,
          currency: "KRW",
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

  it("includes amounts on pending payment reconciliation rows", async () => {
    const createdAt = new Date("2026-07-02T00:00:00.000Z");
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      {
        creditLedgerEntry: { findMany: jest.fn().mockResolvedValue([]) },
        creditPurchase: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: "purchase-pending",
              userId: "human-1",
              provider: "local",
              status: "pending",
              creditAmount: 50,
              paidAmount: 4900,
              currency: "KRW",
              createdAt,
              updatedAt: createdAt,
            },
          ]),
        },
      },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(
      service.listPaymentReconciliation({ status: "pending" }),
    ).resolves.toEqual({
      items: [
        {
          paymentId: "purchase-pending",
          userId: "human-1",
          provider: "local",
          providerStatus: "pending",
          creditAmount: 50,
          paidAmount: 4900,
          currency: "KRW",
          ledgerStatus: "not_granted",
          reason: "payment pending",
        },
      ],
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

  it("creates an image draft and records the creation action", async () => {
    const createImageDraft = jest.fn().mockResolvedValue({
      id: "job-1",
      characterId: "ai-1",
    });
    const createLog = jest.fn().mockResolvedValue(undefined);
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      { characterActionLog: { create: createLog } },
      { createImageDraft },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await service.createImageGenerationDraft({
      characterId: "ai-1",
      inputPrompt: "portrait",
      candidateCount: 3,
    });

    expect(createImageDraft).toHaveBeenCalledWith({
      characterId: "ai-1",
      inputPrompt: "portrait",
      candidateCount: 3,
    });
    expect(createLog).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actionType: "GENERATION_DRAFT_CREATED",
        targetId: "job-1",
      }),
    });
  });

  it.each([
    {
      method: "confirmImageGenerationDraft" as const,
      generationMethod: "confirmImageDraft" as const,
      actionType: "GENERATION_DRAFT_CONFIRMED",
    },
    {
      method: "regenerateImageJob" as const,
      generationMethod: "regenerateImageJob" as const,
      actionType: "GENERATION_JOB_REGENERATED",
    },
  ])("delegates $method and records $actionType", async (testCase) => {
    const delegate = jest.fn().mockResolvedValue({
      id: "job-2",
      characterId: "ai-1",
    });
    const createLog = jest.fn().mockResolvedValue(undefined);
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      { characterActionLog: { create: createLog } },
      { [testCase.generationMethod]: delegate },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await service[testCase.method]("job-1");

    expect(delegate).toHaveBeenCalledWith("job-1");
    expect(createLog).toHaveBeenCalledWith({
      data: expect.objectContaining({
        characterId: "ai-1",
        actionType: testCase.actionType,
        targetTable: "generation_jobs",
        targetId: "job-2",
      }),
    });
  });

  it("delegates draft updates and output selection without duplicate logs", async () => {
    const updateImageDraft = jest.fn().mockResolvedValue({ id: "job-1" });
    const selectOutput = jest.fn().mockResolvedValue({ id: "job-1" });
    const createLog = jest.fn();
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      { characterActionLog: { create: createLog } },
      { updateImageDraft, selectOutput },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await service.updateImageGenerationDraft("job-1", {
      prompt: "edited",
      candidateCount: 2,
    });
    await service.selectGenerationOutput("job-1", "media-2");

    expect(updateImageDraft).toHaveBeenCalledWith("job-1", {
      prompt: "edited",
      candidateCount: 2,
    });
    expect(selectOutput).toHaveBeenCalledWith("job-1", "media-2");
    expect(createLog).not.toHaveBeenCalled();
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
        _count: { comments: 3, reactions: 8 },
      },
      {
        id: "post-1",
        characterId: "ai-1",
        contentType: "feed",
        content: "older",
        createdAt,
        postMedia: [],
        hashtags: [],
        _count: { comments: 0, reactions: 0 },
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
          commentCount: 3,
          reactionCount: 8,
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
        _count: { select: { comments: true, reactions: true } },
      },
    });
  });

  it("lists credit ledger entries across all users", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      { creditLedgerEntry: { findMany } },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(service.listCreditLedger({ limit: 20 })).resolves.toEqual({
      items: [],
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 21,
    });
  });

  it("lists hashtag preferences across all users", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      { userHashtagPreference: { findMany } },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(service.listHashtagPreferences({})).resolves.toEqual({
      items: [],
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ score: "desc" }, { hashtag: { name: "asc" } }],
      include: { hashtag: { select: { name: true } } },
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
      _count: { comments: 2, reactions: 5 },
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
      commentCount: 2,
      reactionCount: 5,
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
        _count: { select: { comments: true, reactions: true } },
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
      _count: { comments: 0, reactions: 0 },
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
        _count: { select: { comments: true, reactions: true } },
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
    await expect(service.listCharacterActionLogs()).resolves.toEqual({
      items: [
        {
          id: "1",
          characterId: "ai-1",
          actionType: "POST_CREATED",
          targetTable: "posts",
          targetId: "post-1",
          reason: "daily post",
          createdAt: createdAt.toISOString(),
        },
      ],
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 51,
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
