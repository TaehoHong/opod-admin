import { AdminService } from "./admin.service";

describe("AdminService", () => {
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

  it("creates character memory without a scope", async () => {
    const createdAt = new Date("2026-07-02T00:00:00.000Z");
    const create = jest.fn().mockResolvedValue({
      id: "memory-1",
      characterId: "character-1",
      content: "likes concise status reports",
      reason: "operator note",
      createdAt,
    });
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      {
        character: {
          findUnique: jest.fn().mockResolvedValue({ id: "character-1" }),
        },
        characterMemory: { create },
      },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(
      service.createCharacterMemory({
        characterId: "character-1",
        content: " likes concise status reports ",
        reason: " operator note ",
      }),
    ).resolves.toEqual({
      id: "memory-1",
      characterId: "character-1",
      content: "likes concise status reports",
      reason: "operator note",
      createdAt: createdAt.toISOString(),
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        characterId: "character-1",
        content: "likes concise status reports",
        reason: "operator note",
      },
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
      content: "hello",
      reason: "daily post",
      media: [{ mediaType: "image", url: "https://cdn.local/post.png" }],
    });

    expect(postCreate).toHaveBeenCalledWith({
      data: {
        characterId: "ai-1",
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
});
