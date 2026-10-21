import { DraftsController } from "./drafts.controller";
import { validateSync } from "class-validator";
import { DraftsService } from "./drafts.service";
import { RestartReferenceDraftDto } from "./dto/restart-reference-draft.dto";
import { canonicalJsonHash } from "../post-production/post-pipeline-v3";

const timestamp = "2026-10-19T10:00:00.000Z";
function fixture() {
  const concept = {
    postGenerationAgent: "reference-v1",
    mode: "manual",
    referenceAgentConfig: {
      revision: "frozen",
      generation: {
        provider: "spicyapi",
        effectiveModel: "alibaba/qwen-image-3.0-pro/edit",
      },
    },
    referenceRevision: 3,
    referenceSelection: { shots: [{ mediaId: "12" }] },
    promptBuild: {
      revision: 3,
      inputHash: "same-input",
      input: { shots: [{ references: [{ id: "SOURCE_1", sha256: "hash" }] }] },
      output: {
        status: "ready",
        shots: [{ prompt: "saved", negativePrompt: "saved negative" }],
      },
      generationParams: { aspect_ratio: "4:5" },
    },
    generationBuild: { jobIds: ["old"] },
    captionBuild: { output: { caption: "stale" } },
    pipeline: { stage: "caption", state: "failed", failure: { code: "old" } },
  };
  const draft = {
    status: "needs_review",
    updatedAt: new Date(timestamp),
    leaseExpiresAt: null as Date | null,
    conceptJson: concept,
  };
  const repository = {
    restartReferenceDraft: jest.fn().mockResolvedValue(true),
  };
  const service = new DraftsService(
    repository as never,
    {} as never,
    {} as never,
  );
  const getState = jest
    .spyOn(service, "getReferenceDraftState")
    .mockResolvedValue({ draft, jobs: [] } as never);
  jest.spyOn(service, "getDraft").mockResolvedValue({ id: "draft" } as never);
  return { concept, draft, repository, service, getState };
}
describe("reference restart", () => {
  it("controller forwards the exact restart request to the domain owner", async () => {
    const restartReferenceDraft = jest.fn().mockResolvedValue({ id: "draft" });
    const controller = new DraftsController(
      { restartReferenceDraft } as never,
      {} as never,
      {} as never,
    );
    await controller.restartReferenceDraft("draft", {
      target: "generation",
      expectedRevision: timestamp,
    });
    expect(restartReferenceDraft).toHaveBeenCalledWith({
      draftId: "draft",
      target: "generation",
      expectedRevision: timestamp,
    });
  });
  it("source reselection clears every downstream artifact and preserves mode/settings", async () => {
    const f = fixture();
    await f.service.restartReferenceDraft({
      draftId: "draft",
      target: "reference_select",
      expectedRevision: timestamp,
    });
    const saved =
      f.repository.restartReferenceDraft.mock.calls[0][0].conceptJson;
    expect(saved).toEqual(
      expect.objectContaining({
        referenceRevision: 4,
        mode: "manual",
        referenceAgentConfig: f.concept.referenceAgentConfig,
        pipeline: { stage: "reference_select", state: "pending", blockers: [] },
      }),
    );
    for (const key of [
      "referenceSelection",
      "promptBuild",
      "generationBuild",
      "captionBuild",
    ])
      expect(saved).not.toHaveProperty(key);
  });
  it("full regeneration preserves frozen input/output/settings and increments job revision", async () => {
    const f = fixture();
    const before = canonicalJsonHash({
      input: f.concept.promptBuild.input,
      output: f.concept.promptBuild.output,
      params: f.concept.promptBuild.generationParams,
    });
    await f.service.restartReferenceDraft({
      draftId: "draft",
      target: "generation",
      expectedRevision: timestamp,
    });
    const saved =
      f.repository.restartReferenceDraft.mock.calls[0][0].conceptJson;
    expect(saved.promptBuild.revision).toBe(4);
    expect(saved.promptBuild.inputHash).toBe("same-input");
    expect(
      canonicalJsonHash({
        input: saved.promptBuild.input,
        output: saved.promptBuild.output,
        params: saved.promptBuild.generationParams,
      }),
    ).toBe(before);
    expect(saved).not.toHaveProperty("generationBuild");
    expect(saved).not.toHaveProperty("captionBuild");
    expect(saved.referenceSelection).toEqual(f.concept.referenceSelection);
  });
  it("regeneration saves false while preserving all other frozen inputs", async () => {
    const f = fixture();
    await f.service.restartReferenceDraft({
      draftId: "draft",
      target: "generation",
      expectedRevision: timestamp,
      enablePromptExpansion: false,
    });
    const saved =
      f.repository.restartReferenceDraft.mock.calls[0][0].conceptJson;
    expect(saved.promptBuild).toEqual({
      ...f.concept.promptBuild,
      revision: 4,
      generationParams: { aspect_ratio: "4:5", enable_prompt_expansion: false },
    });
    expect(saved).not.toHaveProperty("generationBuild");
    expect(saved).not.toHaveProperty("captionBuild");
  });
  it.each(["reference_select", "wrong-model", "null"])(
    "rejects invalid expansion option %s before saving",
    async (scenario) => {
      const f = fixture();
      if (scenario === "wrong-model")
        f.concept.referenceAgentConfig.generation.effectiveModel =
          "bytedance/seedream-5.0-pro/edit";
      await expect(
        f.service.restartReferenceDraft({
          draftId: "draft",
          target:
            scenario === "reference_select" ? "reference_select" : "generation",
          expectedRevision: timestamp,
          enablePromptExpansion: scenario === "null" ? (null as never) : false,
        }),
      ).rejects.toThrow("Prompt expansion");
      expect(f.repository.restartReferenceDraft).not.toHaveBeenCalled();
    },
  );
  it.each([false, true, "false", null])(
    "validates supplied expansion boolean %s",
    (value) => {
      const errors = validateSync(
        Object.assign(new RestartReferenceDraftDto(), {
          target: "generation",
          expectedRevision: timestamp,
          enablePromptExpansion: value,
        }),
      );
      expect(errors.length).toBe(typeof value === "boolean" ? 0 : 1);
    },
  );
  it.each(["published", "rejected"])(
    "blocks terminal %s drafts",
    async (status) => {
      const f = fixture();
      f.draft.status = status;
      await expect(
        f.service.restartReferenceDraft({
          draftId: "draft",
          target: "reference_select",
          expectedRevision: timestamp,
        }),
      ).rejects.toThrow("no longer editable");
      expect(f.repository.restartReferenceDraft).not.toHaveBeenCalled();
    },
  );
  it("blocks stale revisions, active stage leases, and accepted active jobs", async () => {
    const f = fixture();
    await expect(
      f.service.restartReferenceDraft({
        draftId: "draft",
        target: "generation",
        expectedRevision: "2026-10-19T09:00:00.000Z",
      }),
    ).rejects.toThrow("changed");
    f.draft.leaseExpiresAt = new Date(Date.now() + 10000);
    await expect(
      f.service.restartReferenceDraft({
        draftId: "draft",
        target: "generation",
        expectedRevision: timestamp,
      }),
    ).rejects.toThrow("active");
    f.draft.leaseExpiresAt = null;
    f.getState.mockResolvedValue({
      draft: f.draft,
      jobs: [{ id: "old", status: "running" }],
    } as never);
    await expect(
      f.service.restartReferenceDraft({
        draftId: "draft",
        target: "generation",
        expectedRevision: timestamp,
      }),
    ).rejects.toThrow("still active");
    expect(f.repository.restartReferenceDraft).not.toHaveBeenCalled();
  });
  it("reports a lost repository CAS and never returns successful restart", async () => {
    const f = fixture();
    f.repository.restartReferenceDraft.mockResolvedValue(false);
    await expect(
      f.service.restartReferenceDraft({
        draftId: "draft",
        target: "generation",
        expectedRevision: timestamp,
      }),
    ).rejects.toThrow("changed or generation is active");
  });
  it("DTO accepts only explicit restart target and ISO revision", () => {
    const valid = Object.assign(new RestartReferenceDraftDto(), {
      target: "generation",
      expectedRevision: timestamp,
    });
    expect(validateSync(valid)).toHaveLength(0);
    expect(
      validateSync(
        Object.assign(new RestartReferenceDraftDto(), {
          target: "caption",
          expectedRevision: "invalid",
        }),
      ),
    ).toHaveLength(2);
  });
});
