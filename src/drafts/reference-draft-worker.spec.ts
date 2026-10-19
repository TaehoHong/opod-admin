import { DraftWorkerService } from "./draft-worker.service";
import type { DraftsService } from "./drafts.service";
import type { ReferencePostAgentRunner } from "../post-production/reference-post-agent.runner";

describe("reference draft worker routing", () => {
  function setup(stage = "image_prompt", enabled = true) {
    const state = { claimed: false, executions: 0, failures: [] as string[] };
    const drafts = {
      isReferenceDraft: async () => true,
      getReferenceDraftState: async () => ({
        draft: {
          characterId: "character",
          conceptJson: { generationBuild: { jobIds: ["queued", "completed"] } },
        },
        jobs: [
          { id: "orphan", status: "queued" },
          { id: "queued", status: "queued" },
          { id: "completed", status: "completed" },
        ],
      }),
      claimReferenceDraftNow: async (
        _id: string,
        _lease: number,
        guard: { expectedStage: string; expectedRevision: string },
      ) => {
        if (
          state.claimed ||
          guard.expectedStage !== stage ||
          guard.expectedRevision !== "2026-10-19T00:00:00.000Z"
        )
          return false;
        state.claimed = true;
        return true;
      },
      assertGenerationJobMutable: jest.fn().mockResolvedValue(undefined),
      claimReferenceDraft: jest.fn().mockResolvedValue(undefined),
      recoverExpiredReferenceLeases: jest.fn().mockResolvedValue(0),
      listReferenceGenerationWaiting: jest.fn().mockResolvedValue([]),
      listReferencePublicationsDue: jest.fn().mockResolvedValue([]),
      failReferenceStage: async (_id: string, error: string) => {
        state.failures.push(error);
      },
    };
    const runner = {
      runCurrentStage: async () => {
        state.executions++;
      },
      aggregateGeneration: jest.fn().mockResolvedValue(true),
    };
    const repository = {
      sweepExpiredV3Leases: async () => ({ requeued: 0, failed: 0 }),
      findGeneratingDrafts: async () => [],
      findDueDrafts: async () => [],
    };
    const runQueuedJob = jest.fn().mockResolvedValue({ jobId: null });
    const service = new DraftWorkerService(
      repository as never,
      async () => ({}) as never,
      async () => ({}) as never,
      async () => enabled,
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
        runner: runner as unknown as ReferencePostAgentRunner,
        assertCharacterActive: async () => undefined,
        runQueuedJob,
      },
    );
    return { service, state, drafts, runner, runQueuedJob };
  }
  it("executes only accepted queued jobs manually while automatic workers are disabled", async () => {
    const { service, drafts, runQueuedJob } = setup("generation", false);
    await expect(
      service.planDraftNow("draft", {
        expectedStage: "generation",
        expectedRevision: "2026-10-19T00:00:00.000Z",
      }),
    ).resolves.toEqual({ planned: true });
    expect(drafts.assertGenerationJobMutable).toHaveBeenCalledWith(
      "draft",
      "queued",
    );
    expect(runQueuedJob.mock.calls).toEqual([["queued"]]);
  });
  it("does not trigger manual job callbacks during automatic ticks", async () => {
    const { service, drafts, runQueuedJob } = setup("generation");
    drafts.claimReferenceDraft.mockResolvedValueOnce("draft");
    await service.tick();
    expect(runQueuedJob).not.toHaveBeenCalled();
  });
  it("does not execute queued jobs when the manual generation stage guard is absent or stale", async () => {
    const { service, runQueuedJob } = setup("generation", false);
    await expect(service.planDraftNow("draft")).rejects.toThrow(
      "stage and revision",
    );
    expect(
      await service.planDraftNow("draft", {
        expectedStage: "generation",
        expectedRevision: "stale",
      }),
    ).toEqual({ planned: false });
    expect(runQueuedJob).not.toHaveBeenCalled();
  });
  it("requires exact stage and draft revision before a manual paid stage can execute", async () => {
    const { service, state } = setup();
    await expect(service.planDraftNow("draft")).rejects.toThrow(
      "stage and revision",
    );
    await expect(
      service.planDraftNow("draft", {
        expectedStage: "caption",
        expectedRevision: "2026-10-19T00:00:00.000Z",
      }),
    ).resolves.toEqual({ planned: false });
    await expect(
      service.planDraftNow("draft", {
        expectedStage: "image_prompt",
        expectedRevision: "stale",
      }),
    ).resolves.toEqual({ planned: false });
    expect(state.executions).toBe(0);
  });
  it("runs a manually claimed stage once and rejects an overlapping stale trigger", async () => {
    const { service, state } = setup();
    const guard = {
      expectedStage: "image_prompt",
      expectedRevision: "2026-10-19T00:00:00.000Z",
    };
    expect(await service.planDraftNow("draft", guard)).toEqual({
      planned: true,
    });
    expect(await service.planDraftNow("draft", guard)).toEqual({
      planned: false,
    });
    expect(state.executions).toBe(1);
  });
  it("records stage failure without automatically replaying the paid request", async () => {
    const { service, state, runner } = setup();
    runner.runCurrentStage = async () => {
      state.executions++;
      throw new Error("provider response uncertain");
    };
    await service.planDraftNow("draft", {
      expectedStage: "image_prompt",
      expectedRevision: "2026-10-19T00:00:00.000Z",
    });
    expect(state.executions).toBe(1);
    expect(state.failures).toEqual(["provider response uncertain"]);
  });
  it("aggregates only generation waits returned by the domain owner", async () => {
    const { service, drafts, runner } = setup();
    drafts.listReferenceGenerationWaiting.mockResolvedValue([
      { id: "waiting" },
    ]);
    await service.tick();
    expect(runner.aggregateGeneration).toHaveBeenCalledWith("waiting");
  });
});
