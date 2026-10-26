import { DraftWorkerService } from "./draft-worker.service";
import type { DraftsService } from "./drafts.service";
import type { ReferencePostAgentRunner } from "../post-production/reference-post-agent.runner";

describe("reference worker publication", () => {
  function setup(generationEnabled = true, publicationEnabled = true) {
    const lease = new Date("2026-10-19T00:01:00.000Z");
    const concept = {
      postGenerationAgent: "reference-v1",
      mode: "auto",
      generationBuild: { jobIds: ["accepted"] },
    };
    const draft = {
      id: "draft",
      characterId: "character",
      contentType: "feed",
      caption: "Caption",
      hashtags: ["#tag"],
      conceptJson: concept,
      leaseExpiresAt: lease,
    };
    const jobs = [
      {
        id: "orphan",
        sortOrder: 0,
        status: "completed",
        outputs: [
          { selected: true, mediaId: "orphan-media", filterPreset: "none" },
        ],
      },
      {
        id: "accepted",
        sortOrder: 0,
        status: "completed",
        outputs: [
          { selected: true, mediaId: "accepted-media", filterPreset: "none" },
        ],
      },
    ];
    const drafts = {
      isReferenceDraft: async () => true,
      claimReferencePublication: jest.fn().mockResolvedValue(draft),
      releaseReferencePublication: jest.fn().mockResolvedValue(undefined),
      getReferenceDraftState: async () => ({ draft, jobs }),
      listReferencePublicationsDue: async () => [{ id: "draft" }],
      recoverExpiredReferenceLeases: jest.fn().mockResolvedValue(0),
      claimReferenceDraft: async () => undefined,
      listReferenceGenerationWaiting: async () => [],
    };
    const repository = {
      findApprovedDraft: jest.fn(),
      persistPublishedPost: jest.fn().mockResolvedValue(undefined),
      sweepExpiredV3Leases: async () => ({ requeued: 0, failed: 0 }),
      findGeneratingDrafts: async () => [],
      findDueDrafts: async () => [],
    };
    const assertCharacterActive = jest.fn().mockResolvedValue(undefined);
    const worker = new DraftWorkerService(
      repository as never,
      async () => ({}) as never,
      async () => ({}) as never,
      async () => generationEnabled,
      {
        pollIntervalMs: 1000,
        planLeaseSeconds: 120,
        maxAttempts: 3,
        maxShots: 3,
        schedulerEnabled: false,
        naturalPhotoReviewEnabled: true,
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      null,
      undefined,
      {
        drafts: drafts as unknown as DraftsService,
        runner: {} as ReferencePostAgentRunner,
        assertCharacterActive,
      },
      async () => publicationEnabled,
    );
    return {
      worker,
      repository,
      drafts,
      lease,
      concept,
      assertCharacterActive,
    };
  }
  it("publishes only the accepted generation set with the exact concept and lease and no memories", async () => {
    const {
      worker,
      repository,
      drafts,
      lease,
      concept,
      assertCharacterActive,
    } = setup();
    expect(await worker.publishDraftNow("draft")).toEqual({ published: true });
    expect(drafts.claimReferencePublication).toHaveBeenCalledWith("draft", 120);
    expect(repository.findApprovedDraft).not.toHaveBeenCalled();
    expect(assertCharacterActive).toHaveBeenCalledWith("character");
    expect(repository.persistPublishedPost).toHaveBeenCalledWith({
      draftId: "draft",
      characterId: "character",
      contentType: "feed",
      caption: "Caption",
      hashtags: ["tag"],
      leaseExpiresAt: lease,
      referencePublication: { expectedConceptJson: concept },
      media: [{ originalMediaId: "accepted-media", finishedFile: null }],
    });
  });
  it("refuses inactive characters and releases only its acquired publication lease", async () => {
    const { worker, repository, drafts, lease, assertCharacterActive } =
      setup();
    assertCharacterActive.mockRejectedValue(new Error("character inactive"));
    expect(await worker.publishDraftNow("draft")).toEqual({
      published: false,
      reason: "character inactive",
    });
    expect(repository.persistPublishedPost).not.toHaveBeenCalled();
    expect(drafts.releaseReferencePublication).toHaveBeenCalledWith(
      "draft",
      lease,
      "character inactive",
    );
  });
  it("releases its own reservation if the publisher rejects stale data", async () => {
    const { worker, repository, drafts, lease } = setup();
    repository.persistPublishedPost.mockRejectedValue(
      new Error("lease changed"),
    );
    expect(await worker.publishDraftNow("draft")).toEqual({
      published: false,
      reason: "lease changed",
    });
    expect(drafts.releaseReferencePublication).toHaveBeenCalledWith(
      "draft",
      lease,
      "lease changed",
    );
  });
  it.each([true, false])(
    "publishes approved reference drafts when the generation loop is enabled=%s",
    async (generationEnabled) => {
      const { worker, drafts, repository } = setup(generationEnabled);
      await worker.tick();
      expect(drafts.claimReferencePublication).toHaveBeenCalledWith(
        "draft",
        expect.any(Number),
      );
      expect(repository.persistPublishedPost).toHaveBeenCalledWith(
        expect.objectContaining({
          draftId: "draft",
          referencePublication: expect.any(Object),
        }),
      );
      expect(repository.findApprovedDraft).not.toHaveBeenCalled();
    },
  );
  it("stops automatic publication without disabling generation or manual publication", async () => {
    const { worker, drafts, repository } = setup(true, false);
    await worker.tick();
    expect(drafts.recoverExpiredReferenceLeases).toHaveBeenCalled();
    expect(drafts.claimReferencePublication).not.toHaveBeenCalled();
    expect(repository.persistPublishedPost).not.toHaveBeenCalled();
    expect(await worker.publishDraftNow("draft")).toEqual({ published: true });
    expect(repository.persistPublishedPost).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: "draft" }),
    );
  });
});
