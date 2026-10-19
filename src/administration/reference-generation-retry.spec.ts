import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { GenerationService } from "../generation/generation.service";
import { GenerationWorkerService } from "../generation/generation-worker.service";
import { MediaService } from "../media/media.service";
import { DraftsService } from "../drafts/drafts.service";

describe("explicit reference generation retry", () => {
  function setup() {
    const events: string[] = [];
    const drafts = {
      assertGenerationJobMutable: async () => undefined,
      isReferenceDraft: async () => true,
      retryReferenceGenerationJob: jest
        .fn()
        .mockImplementation(async (draftId: string, jobId: string) => {
          events.push("retry");
          return { id: jobId, draftId, status: "queued" };
        }),
    };
    const worker = {
      runJobNow: jest.fn().mockImplementation(async () => {
        events.push("execute");
        return { jobId: null };
      }),
    };
    const admin = {
      retryGenerationJob: jest.fn().mockResolvedValue({ id: "natural-retry" }),
    };
    const controller = new AdminController(
      admin as unknown as AdminService,
      {
        getJob: async () => ({ draftId: "reference-draft" }),
      } as unknown as GenerationService,
      {} as MediaService,
      worker as unknown as GenerationWorkerService,
      drafts as unknown as DraftsService,
    );
    return { controller, drafts, worker, admin, events };
  }
  it("requeues the accepted job through its domain owner then explicitly executes the same ID", async () => {
    const { controller, drafts, worker, admin, events } = setup();
    await expect(
      controller.retryGenerationJob("job", { reason: "Retry failed image" }),
    ).resolves.toEqual({
      id: "job",
      draftId: "reference-draft",
      status: "queued",
    });
    expect(drafts.retryReferenceGenerationJob).toHaveBeenCalledWith(
      "reference-draft",
      "job",
      "Retry failed image",
    );
    expect(worker.runJobNow).toHaveBeenCalledWith("job");
    expect(events).toEqual(["retry", "execute"]);
    expect(admin.retryGenerationJob).not.toHaveBeenCalled();
  });
  it("never submits a provider request when domain retry validation fails", async () => {
    const { controller, drafts, worker } = setup();
    drafts.retryReferenceGenerationJob.mockRejectedValue(
      new Error("stale job"),
    );
    await expect(controller.retryGenerationJob("job", {})).rejects.toThrow(
      "stale job",
    );
    expect(worker.runJobNow).not.toHaveBeenCalled();
  });
  it("keeps the existing natural retry route", async () => {
    const { controller, drafts, worker, admin } = setup();
    drafts.isReferenceDraft = async () => false;
    await expect(
      controller.retryGenerationJob("job", { reason: "retry" }),
    ).resolves.toEqual({ id: "natural-retry" });
    expect(admin.retryGenerationJob).toHaveBeenCalledWith({
      jobId: "job",
      reason: "retry",
    });
    expect(worker.runJobNow).not.toHaveBeenCalled();
  });
});
