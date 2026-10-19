import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { GenerationService } from "../generation/generation.service";
import { GenerationWorkerService } from "../generation/generation-worker.service";
import { MediaService } from "../media/media.service";
import { DraftsService } from "../drafts/drafts.service";

describe("archived Agent generation HTTP boundary", () => {
  it.each([
    "updateImageGenerationDraft",
    "confirmImageGenerationDraft",
    "selectGenerationOutput",
    "regenerateImageJob",
    "startGenerationJob",
    "runGenerationJob",
    "retryGenerationJob",
    "completeGenerationJob",
    "failGenerationJob",
    "runGenerationWorker",
  ])("rejects %s for an archived draft job before mutation", async (method) => {
    const mutate = jest.fn();
    const generation = {
      getJob: jest.fn().mockResolvedValue({ draftId: "old-draft" }),
      updateImageDraft: mutate,
      confirmImageDraft: mutate,
      selectOutput: mutate,
    };
    const admin = {
      regenerateImageJob: mutate,
      startGenerationJob: mutate,
      runGenerationJob: mutate,
      retryGenerationJob: mutate,
      completeGenerationJob: mutate,
      failGenerationJob: mutate,
    };
    const drafts = {
      assertGenerationJobMutable: jest
        .fn()
        .mockRejectedValue(new Error("읽기 전용")),
    };
    const controller = new AdminController(
      admin as unknown as AdminService,
      generation as unknown as GenerationService,
      {} as MediaService,
      { runJobNow: mutate } as unknown as GenerationWorkerService,
      drafts as unknown as DraftsService,
    );
    const invoke = (
      controller as unknown as Record<
        string,
        (...args: unknown[]) => Promise<unknown>
      >
    )[method].bind(controller);
    await expect(
      method === "runGenerationWorker"
        ? invoke({ jobId: "job" })
        : invoke("job", {}),
    ).rejects.toThrow("읽기 전용");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("keeps archived generation history readable", async () => {
    const generation = {
      getJob: jest.fn().mockResolvedValue({ id: "job", draftId: "old-draft" }),
    };
    const drafts = { assertGenerationJobMutable: jest.fn() };
    const controller = new AdminController(
      {} as AdminService,
      generation as unknown as GenerationService,
      {} as MediaService,
      {} as GenerationWorkerService,
      drafts as unknown as DraftsService,
    );
    await expect(controller.getGenerationJob("job")).resolves.toEqual({
      id: "job",
      draftId: "old-draft",
    });
    expect(drafts.assertGenerationJobMutable).not.toHaveBeenCalled();
  });

  it("keeps active natural draft image confirmation available", async () => {
    const generation = {
      getJob: jest.fn().mockResolvedValue({ draftId: "natural-draft" }),
      confirmImageDraft: jest.fn().mockResolvedValue({ id: "job" }),
    };
    const drafts = {
      assertGenerationJobMutable: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new AdminController(
      {} as AdminService,
      generation as unknown as GenerationService,
      {} as MediaService,
      {} as GenerationWorkerService,
      drafts as unknown as DraftsService,
    );
    await expect(
      controller.confirmImageGenerationDraft("job"),
    ).resolves.toEqual({ id: "job" });
    expect(drafts.assertGenerationJobMutable).toHaveBeenCalledWith(
      "natural-draft",
      "job",
    );
  });

  it("keeps standalone image draft confirmation available", async () => {
    const generation = {
      getJob: jest.fn().mockResolvedValue({ draftId: null }),
      confirmImageDraft: jest.fn().mockResolvedValue({ id: "job" }),
    };
    const drafts = { assertGenerationJobMutable: jest.fn() };
    const controller = new AdminController(
      {} as AdminService,
      generation as unknown as GenerationService,
      {} as MediaService,
      {} as GenerationWorkerService,
      drafts as unknown as DraftsService,
    );
    await expect(
      controller.confirmImageGenerationDraft("job"),
    ).resolves.toEqual({
      id: "job",
    });
    expect(drafts.assertGenerationJobMutable).not.toHaveBeenCalled();
  });
});
