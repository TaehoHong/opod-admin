import { validate } from "class-validator";
import { CreateDraftDto } from "./dto/create-draft.dto";
import { DraftsService } from "./drafts.service";

const now = new Date("2026-10-19T00:00:00.000Z");
const row = {
  id: "draft",
  characterId: "character",
  draftType: "post",
  contentType: "feed",
  caption: null,
  hashtags: [],
  status: "planned",
  attemptCount: 0,
  errorMessage: null,
  scheduledAt: null,
  publishedPostId: null,
  createdAt: now,
  updatedAt: now,
};
const config = {
  revision: "saved-config",
  selection: { batchSize: 12, maxAttempts: 2 },
  stages: {
    reference_select: {
      aiModelId: "1",
      provider: "openai-compatible",
      model: "select-model",
      systemPrompt: "saved select",
      outputSchema: {},
    },
    image_prompt: {
      aiModelId: "2",
      provider: "openai-compatible",
      model: "prompt-model",
      systemPrompt: "saved prompt",
      outputSchema: {},
    },
    caption: {
      aiModelId: "3",
      provider: "openai-compatible",
      model: "caption-model",
      systemPrompt: "saved caption",
      outputSchema: {},
    },
  },
  generation: {
    id: "7",
    revision: 1,
    aiModelId: "4",
    provider: "openai",
    effectiveModel: "image-model",
  },
};
describe("reference draft creation and generation view", () => {
  it("creates an explicit reference draft with its frozen saved config at reference_select", async () => {
    let saved: unknown;
    const repository = {
      characterExists: async () => true,
      createDraft: async (input: object) => {
        saved = { ...row, ...input };
        return saved;
      },
      recordActionLog: async () => undefined,
      findDraft: async () => saved,
      findDraftJobs: async () => [],
    };
    const service = new DraftsService(
      repository as never,
      {
        snapshotAiAssignments: async () => undefined,
        requireReferenceAgentConfig: async () => structuredClone(config),
      } as never,
      {} as never,
    );
    const created = await service.createDraft({
      characterId: "character",
      postGenerationAgent: "reference-v1",
      mode: "manual",
      sceneHint: " operator request ",
    });
    expect(created.conceptJson).toEqual({
      source: "manual",
      mode: "manual",
      postGenerationAgent: "reference-v1",
      operatorRequest: "operator request",
      referenceAgentConfig: config,
      pipeline: { stage: "reference_select", state: "pending" },
    });
    const originalPrompt = config.stages.caption.systemPrompt;
    config.stages.caption.systemPrompt = "changed setting";
    expect((await service.getDraft("draft")).conceptJson).toMatchObject({
      referenceAgentConfig: {
        stages: { caption: { systemPrompt: originalPrompt } },
      },
    });
    config.stages.caption.systemPrompt = originalPrompt;
  });
  it("does not persist a draft when full reference settings are missing", async () => {
    const createDraft = jest.fn();
    const service = new DraftsService(
      { characterExists: async () => true, createDraft } as never,
      {
        snapshotAiAssignments: async () => undefined,
        requireReferenceAgentConfig: async () => {
          throw new Error("reference config required");
        },
      } as never,
      {} as never,
    );
    await expect(
      service.createDraft({
        characterId: "character",
        postGenerationAgent: "reference-v1",
      }),
    ).rejects.toThrow("reference config required");
    expect(createDraft).not.toHaveBeenCalled();
  });
  it("only exposes jobs accepted by the saved generationBuild even if an orphan job is newer", async () => {
    const job = (id: string, sortOrder: number) => ({
      id,
      sortOrder,
      status: "draft",
      prompt: "prompt",
      paramsJson: {},
      candidateCount: 1,
      provider: "openai",
      costUsd: null,
      errorMessage: null,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
      outputs: [],
    });
    const service = new DraftsService(
      {
        findDraft: async () => ({
          ...row,
          conceptJson: {
            postGenerationAgent: "reference-v1",
            generationBuild: { jobIds: ["accepted"] },
          },
        }),
        findDraftJobs: async () => [
          job("orphan", 0),
          job("accepted", 0),
          job("orphan-shot", 1),
        ],
      } as never,
      {} as never,
      {} as never,
    );
    const view = await service.getDraft("draft");
    expect(view.shots?.map((shot) => shot.jobId)).toEqual(["accepted"]);
  });
  it.each(["reference-v1", "natural-v1"])(
    "accepts the %s draft selector at the DTO boundary",
    async (postGenerationAgent) => {
      const input = Object.assign(new CreateDraftDto(), {
        characterId: "character",
        postGenerationAgent,
      });
      expect(await validate(input)).toEqual([]);
    },
  );
  it("rejects archived draft selection at the DTO boundary", async () => {
    const input = Object.assign(new CreateDraftDto(), {
      characterId: "character",
      postGenerationAgent: "existing",
    });
    expect((await validate(input)).map((error) => error.property)).toEqual([
      "postGenerationAgent",
    ]);
  });
});
