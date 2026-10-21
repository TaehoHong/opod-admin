import { validateSync } from "class-validator";
import { DraftsRepository } from "./drafts.repository";
import { DraftsService } from "./drafts.service";
import { RunStageDto } from "./dto/run-stage.dto";

const timestamp = "2026-10-19T00:00:00.000Z";
function fixture(jobIds: string[] = []) {
  const concept = {
    postGenerationAgent: "reference-v1",
    referenceAgentConfig: {
      generation: {
        provider: "spicyapi",
        effectiveModel: "alibaba/qwen-image-3.0/edit",
      },
    },
    promptBuild: { revision: 2, generationParams: { seed: 42 } },
    generationBuild: { jobIds },
    pipeline: { stage: "generation", state: "pending" },
  };
  let saved: Record<string, unknown> | undefined;
  const query = {
    from() {
      return this;
    },
    where() {
      return this;
    },
    orderBy() {
      return this;
    },
    limit() {
      return this;
    },
    for: async () => [{ id: "draft", conceptJson: concept }],
  };
  const tx = {
    select: () => query,
    update: () => ({
      set: (value: Record<string, unknown>) => ({
        where: async () => {
          saved = value;
        },
      }),
    }),
  };
  const repository = new DraftsRepository({
    client: {
      transaction: async (work: (value: typeof tx) => unknown) => work(tx),
    },
  } as never);
  const service = new DraftsService(repository, {} as never, {} as never);
  jest
    .spyOn(service, "getReferenceDraftState")
    .mockResolvedValue({ draft: { conceptJson: concept }, jobs: [] } as never);
  return { service, concept, saved: () => saved };
}

describe("reference prompt expansion claim", () => {
  it("saves false and claim metadata together while preserving other generation params", async () => {
    const f = fixture();
    await expect(
      f.service.claimReferenceDraftNow("draft", 120, {
        expectedStage: "generation",
        expectedRevision: timestamp,
        enablePromptExpansion: false,
      }),
    ).resolves.toBe(true);
    expect(f.saved()).toMatchObject({
      status: "generating",
      leaseExpiresAt: expect.any(Date),
      conceptJson: {
        promptBuild: {
          revision: 2,
          generationParams: { seed: 42, enable_prompt_expansion: false },
        },
        pipeline: { stage: "generation", state: "running" },
      },
    });
  });
  it("refuses a new option when accepted jobs already exist", async () => {
    const f = fixture(["accepted"]);
    await expect(
      f.service.claimReferenceDraftNow("draft", 120, {
        expectedStage: "generation",
        expectedRevision: timestamp,
        enablePromptExpansion: false,
      }),
    ).resolves.toBe(false);
    expect(f.saved()).toBeUndefined();
  });
  it("omission preserves saved params and existing accepted jobs", async () => {
    const f = fixture(["accepted"]);
    await expect(
      f.service.claimReferenceDraftNow("draft", 120, {
        expectedStage: "generation",
        expectedRevision: timestamp,
      }),
    ).resolves.toBe(true);
    expect(f.saved()).toMatchObject({
      conceptJson: { promptBuild: f.concept.promptBuild },
    });
  });
  it.each([false, true, "false", null])(
    "validates manual request boolean %s",
    (value) => {
      expect(
        validateSync(
          Object.assign(new RunStageDto(), { enablePromptExpansion: value }),
        ).length,
      ).toBe(typeof value === "boolean" ? 0 : 1);
    },
  );
  it("rejects wrong stages before claiming", async () => {
    const f = fixture();
    await expect(
      f.service.claimReferenceDraftNow("draft", 120, {
        expectedStage: "image_prompt",
        expectedRevision: timestamp,
        enablePromptExpansion: false,
      }),
    ).rejects.toThrow("Prompt expansion");
    expect(f.saved()).toBeUndefined();
  });
});
