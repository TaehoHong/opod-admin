import { AdminService } from "./admin.service";

type ServiceDependencies = {
  user?: object;
  content?: object;
  credit?: object;
  moderation?: object;
  analytics?: object;
  generation?: object;
};

const createService = ({
  user = {},
  content = {},
  credit = {},
  moderation = {},
  analytics = {},
  generation = {},
}: ServiceDependencies = {}) =>
  new (
    AdminService as unknown as new (...dependencies: object[]) => AdminService
  )(user, content, credit, moderation, analytics, generation);

const purchase = (
  overrides: Partial<{
    id: string;
    userId: string;
    status: "pending" | "paid" | "failed" | "canceled" | "refunded";
    creditAmount: number;
    paidAmount: number;
  }> = {},
) => {
  const createdAt = new Date("2026-07-02T00:00:00.000Z");
  return {
    id: "purchase-1",
    userId: "human-1",
    provider: "local",
    status: "paid" as const,
    creditAmount: 500,
    paidAmount: 4900,
    currency: "KRW",
    providerPaymentId: null,
    providerPayload: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
};

describe("AdminService", () => {
  it("maps user follow counts and clamps reserved credits from spendable balance", async () => {
    const createdAt = new Date("2026-07-12T00:00:00.000Z");
    const service = createService({
      user: {
        listUsers: jest.fn().mockResolvedValue([
          {
            id: "user-1",
            displayName: "Taeho",
            email: "taeho@example.com",
            createdAt,
            _count: { characterFollows: 7 },
          },
        ]),
        getSpendableBalances: jest
          .fn()
          .mockResolvedValue(
            new Map([["user-1", { granted: 5, reserved: 7 }]]),
          ),
      },
    });

    await expect(service.listUsers({ limit: 20 })).resolves.toEqual({
      items: [
        {
          id: "user-1",
          displayName: "Taeho",
          email: "taeho@example.com",
          followCount: 7,
          creditBalance: 0,
          createdAt: createdAt.toISOString(),
        },
      ],
    });
  });

  it("does not read a balance after a missing user is detected", async () => {
    const getSpendableBalances = jest.fn();
    const service = createService({
      user: {
        getUser: jest.fn().mockResolvedValue(null),
        getSpendableBalances,
      },
    });

    await expect(service.getUser("missing-user")).rejects.toThrow(
      "User not found",
    );
    expect(getSpendableBalances).not.toHaveBeenCalled();
  });

  it("rejects a cursor outside active post filters", async () => {
    const listPosts = jest.fn();
    const service = createService({
      content: {
        hasPostCursor: jest.fn().mockResolvedValue(false),
        listPosts,
      },
    });
    const cursor = Buffer.from(
      JSON.stringify({ id: "post-cursor" }),
      "utf8",
    ).toString("base64url");

    await expect(
      service.listPosts({
        characterId: "ai-1",
        contentType: "feed",
        cursor,
        limit: 20,
      }),
    ).rejects.toThrow("Invalid cursor");
    expect(listPosts).not.toHaveBeenCalled();
  });

  it("rejects public post creation by a user actor before persistence", async () => {
    const createPost = jest.fn();
    const service = createService({ content: { createPost } });

    await expect(
      service.createPost({
        actorType: "user",
        actorId: "human-1",
        content: "not allowed",
        media: [{ mediaType: "image", url: "https://cdn.local/post.png" }],
      }),
    ).rejects.toThrow("Users cannot create public posts");
    expect(createPost).not.toHaveBeenCalled();
  });

  it("creates a character post and records the operator reason", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const recordCharacterAction = jest.fn().mockResolvedValue(undefined);
    const createPost = jest.fn().mockResolvedValue({
      id: "post-1",
      characterId: "ai-1",
      contentType: "reel",
      content: "hello",
      hashtags: [{ hashtag: { name: "opod" } }],
      postMedia: [
        {
          media: {
            mediaType: "image",
            url: "https://cdn.local/post.png",
            width: null,
            height: null,
            durationSeconds: null,
          },
        },
      ],
      _count: { comments: 0, reactions: 0 },
      createdAt,
    });
    const service = createService({
      content: {
        hasCharacter: jest.fn().mockResolvedValue(true),
        createPost,
        recordCharacterAction,
      },
    });

    await expect(
      service.createPost({
        actorType: "character",
        actorId: "ai-1",
        contentType: "reel",
        content: "hello",
        reason: "daily post",
        hashtags: ["opod", "opod"],
        media: [{ mediaType: "image", url: "https://cdn.local/post.png" }],
      }),
    ).resolves.toMatchObject({
      id: "post-1",
      hashtags: ["opod"],
      commentCount: 0,
      reactionCount: 0,
    });
    expect(createPost).toHaveBeenCalledWith(
      expect.objectContaining({ hashtags: ["opod"] }),
    );
    expect(recordCharacterAction).toHaveBeenCalledWith({
      characterId: "ai-1",
      actionType: "POST_CREATED",
      targetTable: "posts",
      targetId: "post-1",
      reason: "daily post",
    });
  });

  it("rejects story creation with an unconfirmed stored upload", async () => {
    const createStory = jest.fn();
    const service = createService({
      content: {
        hasCharacter: jest.fn().mockResolvedValue(true),
        getStoredMedia: jest.fn().mockResolvedValue({
          id: "media-1",
          mediaType: "image",
          uploadedAt: null,
        }),
        createStory,
      },
    });

    await expect(
      service.createStory({
        characterId: "ai-1",
        media: { mediaId: "media-1" },
      }),
    ).rejects.toThrow("Media upload is not confirmed");
    expect(createStory).not.toHaveBeenCalled();
  });

  it("validates paid grants and maps the persisted ledger entry", async () => {
    const createdAt = new Date("2026-07-24T00:00:00.000Z");
    const createLedgerEntry = jest.fn().mockImplementation((data) => ({
      id: "entry-1",
      remainingAmount: data.amount,
      expiresAt: null,
      createdAt,
      ...data,
    }));
    const service = createService({
      credit: {
        hasPurchaseForUser: jest.fn().mockResolvedValue(true),
        createLedgerEntry,
      },
    });

    await expect(
      service.grantCredits({
        userId: "user-1",
        amount: 100,
        reason: "paid purchase promotion",
        creditKind: "paid",
        purchaseId: "purchase-1",
        promotionCode: "SUMMER_PAID",
      }),
    ).resolves.toMatchObject({
      creditKind: "paid",
      purchaseId: "purchase-1",
      promotionCode: "SUMMER_PAID",
      amount: 100,
    });
    expect(createLedgerEntry).toHaveBeenCalledWith(
      expect.not.objectContaining({ expiresAt: expect.any(Date) }),
    );
  });

  it("returns selected analytics without executing unrelated metrics", async () => {
    const countEvents = jest.fn();
    const countMessages = jest.fn();
    const countGenerationJobs = jest.fn();
    const sumCredits = jest.fn().mockResolvedValue(42);
    const service = createService({
      analytics: {
        countEvents,
        countMessages,
        countGenerationJobs,
        sumCredits,
      },
    });

    await expect(
      service.getAnalytics({
        metric: "credits.debited",
        from: "2026-07-01T00:00:00.000Z",
        to: "2026-07-02T00:00:00.000Z",
      }),
    ).resolves.toEqual({
      metrics: [{ name: "credits.debited", value: 42 }],
    });
    expect(sumCredits).toHaveBeenCalledWith("debit", {
      gte: new Date("2026-07-01T00:00:00.000Z"),
      lte: new Date("2026-07-02T00:00:00.000Z"),
    });
    expect(countEvents).not.toHaveBeenCalled();
    expect(countMessages).not.toHaveBeenCalled();
    expect(countGenerationJobs).not.toHaveBeenCalled();
  });

  it("identifies a paid purchase with no base grant as repairable", async () => {
    const service = createService({
      credit: {
        listPurchases: jest.fn().mockResolvedValue([purchase()]),
        listReconciliationEvidence: jest
          .fn()
          .mockResolvedValue({ entries: [], refunds: [] }),
      },
    });

    await expect(
      service.listPaymentReconciliation({ status: "mismatch" }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          paymentId: "purchase-1",
          ledgerStatus: "missing_grant",
          issueCodes: ["paid_missing_grant"],
          repairActions: ["grant_missing_purchase"],
        }),
      ],
    });
  });

  it("detects incomplete refund recovery and an excessive refund total", async () => {
    const service = createService({
      credit: {
        listPurchases: jest
          .fn()
          .mockResolvedValue([purchase({ status: "refunded" })]),
        listReconciliationEvidence: jest.fn().mockResolvedValue({
          entries: [
            {
              id: "grant-1",
              purchaseId: "purchase-1",
              entryType: "grant",
              creditKind: "paid",
              promotionCode: null,
              amount: 500,
              externalReference: "credit_purchase:purchase-1",
            },
          ],
          refunds: [
            {
              id: "refund-1",
              purchaseId: "purchase-1",
              status: "refunded",
              refundAmount: 5000,
              allocations: [{ recoveryAmount: 500, recoveredAmount: 0 }],
            },
          ],
        }),
      },
    });

    await expect(
      service.listPaymentReconciliation({ status: "mismatch" }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          issueCodes: [
            "refund_missing_recovery",
            "refund_total_exceeds_payment",
          ],
          repairActions: ["recover_completed_refund"],
        }),
      ],
    });
  });

  it("replays an existing reconciliation receipt without another mutation", async () => {
    const receipt = {
      reference: "repair-purchase-1",
      action: "grant_missing_purchase" as const,
      purchaseId: "purchase-1",
      grantedCredits: 500,
      recoveredCredits: 0,
      debtAdded: 0,
    };
    const createLedgerEntry = jest.fn();
    const session = {
      getAction: jest.fn().mockResolvedValue({
        purchaseId: "purchase-1",
        actionType: "grant_missing_purchase",
        details: receipt,
      }),
      createLedgerEntry,
    };
    const service = createService({
      credit: {
        getPayment: jest.fn().mockResolvedValue(purchase()),
        withReconciliationTransaction: jest.fn(
          async (_userId, _reference, work) => work(session),
        ),
      },
    });

    await expect(
      service.reconcilePayment({
        adminId: "admin-1",
        purchaseId: "purchase-1",
        action: "grant_missing_purchase",
        reference: "repair-purchase-1",
        reason: "reconciliation repair",
      }),
    ).resolves.toEqual(receipt);
    expect(createLedgerEntry).not.toHaveBeenCalled();
  });

  it("recovers used non-paid credits as debt and records a debit", async () => {
    const createLedgerEntry = jest.fn();
    const addPaidDebt = jest.fn();
    const session = {
      getAction: jest.fn().mockResolvedValue(null),
      listPurchaseGrants: jest.fn().mockResolvedValue([
        {
          id: "grant-1",
          amount: 500,
          remainingAmount: 200,
          creditKind: "paid",
          promotionCode: null,
        },
      ]),
      setLedgerRemaining: jest.fn(),
      addPaidDebt,
      createLedgerEntry,
      recordAction: jest.fn(),
    };
    const service = createService({
      credit: {
        getPayment: jest.fn().mockResolvedValue(purchase({ status: "failed" })),
        withReconciliationTransaction: jest.fn(
          async (_userId, _reference, work) => work(session),
        ),
      },
    });

    await expect(
      service.reconcilePayment({
        adminId: "admin-1",
        purchaseId: "purchase-1",
        action: "recover_nonpaid_grants",
        reference: "recover-purchase-1",
        reason: "failed payment grant recovery",
      }),
    ).resolves.toMatchObject({
      recoveredCredits: 500,
      debtAdded: 300,
    });
    expect(addPaidDebt).toHaveBeenCalledWith("human-1", 300);
    expect(createLedgerEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        entryType: "debit",
        amount: 500,
        externalReference: "credit_reconciliation:recover-purchase-1",
      }),
    );
  });

  it("retries only the unrecovered portion of a completed refund", async () => {
    const completeRefundAllocation = jest.fn();
    const addPaidDebt = jest.fn();
    const session = {
      getAction: jest.fn().mockResolvedValue(null),
      listPurchaseGrants: jest.fn().mockResolvedValue([]),
      listCompletedRefunds: jest.fn().mockResolvedValue([
        {
          id: "refund-1",
          creditAmount: 500,
          promotionAmount: 0,
          allocations: [
            {
              refundId: "refund-1",
              ledgerEntryId: "grant-1",
              recoveryAmount: 500,
              recoveredAmount: 200,
              ledgerEntry: { remainingAmount: 100 },
            },
          ],
        },
      ]),
      setLedgerRemaining: jest.fn(),
      completeRefundAllocation,
      hasDebitReference: jest.fn().mockResolvedValue(false),
      createLedgerEntry: jest.fn(),
      addPaidDebt,
      recordAction: jest.fn(),
    };
    const service = createService({
      credit: {
        getPayment: jest
          .fn()
          .mockResolvedValue(purchase({ status: "refunded" })),
        withReconciliationTransaction: jest.fn(
          async (_userId, _reference, work) => work(session),
        ),
      },
    });

    await expect(
      service.reconcilePayment({
        adminId: "admin-1",
        purchaseId: "purchase-1",
        action: "recover_completed_refund",
        reference: "recover-refund-1",
        reason: "refund recovery retry",
      }),
    ).resolves.toMatchObject({
      recoveredCredits: 300,
      debtAdded: 200,
    });
    expect(completeRefundAllocation).toHaveBeenCalledWith(
      "refund-1",
      "grant-1",
      500,
    );
    expect(addPaidDebt).toHaveBeenCalledWith("human-1", 200);
  });

  it("rejects reusing a reconciliation reference for a different action", async () => {
    const session = {
      getAction: jest.fn().mockResolvedValue({
        purchaseId: "purchase-1",
        actionType: "recover_nonpaid_grants",
        details: {},
      }),
    };
    const service = createService({
      credit: {
        getPayment: jest.fn().mockResolvedValue(purchase()),
        withReconciliationTransaction: jest.fn(
          async (_userId, _reference, work) => work(session),
        ),
      },
    });

    await expect(
      service.reconcilePayment({
        adminId: "admin-1",
        purchaseId: "purchase-1",
        action: "grant_missing_purchase",
        reference: "already-used",
        reason: "repair",
      }),
    ).rejects.toThrow("Reconciliation reference is already used");
  });

  it("validates report status before updating moderation state", async () => {
    const updateReport = jest.fn();
    const service = createService({
      moderation: { getReport: jest.fn(), updateReport },
    });

    await expect(
      service.updateReport({
        reportId: "report-1",
        status: "deleted",
      }),
    ).rejects.toThrow("Invalid report status");
    expect(updateReport).not.toHaveBeenCalled();
  });

  it("runs generation through the local provider and records an action", async () => {
    const recordCharacterAction = jest.fn();
    const service = createService({
      content: { recordCharacterAction },
      generation: {
        startJob: jest.fn().mockResolvedValue({
          id: "job-1",
          characterId: "ai-1",
        }),
      },
    });

    await expect(
      service.runGenerationJob({ jobId: "job-1", provider: "local" }),
    ).resolves.toEqual({ id: "job-1", status: "running" });
    expect(recordCharacterAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "GENERATION_JOB_RUN",
        reason: "generation job run requested via local provider",
      }),
    );
  });
});
