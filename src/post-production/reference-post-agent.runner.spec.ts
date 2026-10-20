import {
  currentReferenceOutputs,
  ReferencePostAgentRunner,
} from "./reference-post-agent.runner";
import { DraftsService } from "../drafts/drafts.service";
import { createHash } from "node:crypto";

type Jobs = Awaited<
  ReturnType<DraftsService["getReferenceDraftState"]>
>["jobs"];
const concept = {
  postGenerationAgent: "reference-v1",
  pipeline: { stage: "generation", state: "running" },
  referenceSelection: { shots: [{ shotId: "SHOT_01", sortOrder: 0 }] },
  promptBuild: { revision: 2 },
  generationBuild: { jobIds: ["current"], promptRevision: 2 },
};
function job(
  id = "current",
  status = "completed",
  selected = true,
): Jobs[number] {
  return {
    id,
    status,
    sortOrder: 0,
    paramsJson: { _referenceAgent: { promptRevision: "2", shotId: "SHOT_01" } },
    outputs: [
      { mediaId: "photo", selected, media: { url: "https://media/photo" } },
    ],
  } as Jobs[number];
}
describe("reference generation aggregation", () => {
  it("requires exact saved jobs and one explicitly selected successful output", () => {
    expect(currentReferenceOutputs(concept, [job()])).toEqual([
      {
        shotId: "SHOT_01",
        sortOrder: 0,
        mediaId: "photo",
        media: { url: "https://media/photo" },
      },
    ]);
    expect(currentReferenceOutputs(concept, [job("old")])).toBeNull();
    expect(
      currentReferenceOutputs(concept, [job("current", "running")]),
    ).toBeNull();
    expect(
      currentReferenceOutputs(concept, [job("current", "completed", false)]),
    ).toBeNull();
  });
  it("rejects stale prompt revision and ambiguous candidate selection", () => {
    expect(
      currentReferenceOutputs({ ...concept, promptBuild: { revision: 3 } }, [
        job(),
      ]),
    ).toBeNull();
    const ambiguous = job();
    ambiguous.outputs.push({ ...ambiguous.outputs[0], mediaId: "other" });
    expect(currentReferenceOutputs(concept, [ambiguous])).toBeNull();
  });
  it("advances only through domain CAS and ignores unrelated completed jobs", async () => {
    const saveReferenceStage = jest.fn().mockResolvedValue(false);
    const drafts = {
      getReferenceDraftState: jest.fn().mockResolvedValue({
        draft: { conceptJson: concept },
        jobs: [job(), job("old")],
      }),
      saveReferenceStage,
    };
    const runner = new ReferencePostAgentRunner(
      drafts as unknown as DraftsService,
      ...(Array(9).fill(undefined) as [
        never,
        never,
        never,
        never,
        never,
        never,
        never,
        never,
        never,
      ]),
    );
    expect(await runner.aggregateGeneration("draft")).toBe(false);
    expect(saveReferenceStage).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedConceptJson: concept,
        conceptJson: expect.objectContaining({
          pipeline: { stage: "caption", state: "ready" },
        }),
      }),
    );
  });
});

describe("reference stage orchestration", () => {
  function fixture(stage: string) {
    const saved = {
      postGenerationAgent: "reference-v1",
      pipeline: { stage, state: "running" },
      referenceAgentConfig: {
        revision: "config",
        selection: { batchSize: 12, maxAttempts: 1 },
        stages: { reference_select: {} },
        generation: {},
      },
      promptBuild: {
        revision: 1,
        generationParams: { aspect_ratio: "4:5" },
        input: { shots: [{ references: [] }] },
        output: {
          status: "ready",
          shots: [{ shotId: "SHOT_01", prompt: "prompt", negativePrompt: "" }],
        },
      },
    };
    const drafts = {
      getReferenceDraftState: jest.fn().mockResolvedValue({
        draft: {
          id: "draft",
          characterId: "character",
          status: "generating",
          conceptJson: saved,
        },
        jobs: [],
      }),
      saveReferenceStage: jest.fn().mockResolvedValue(true),
      getPublishedReferenceSources: jest
        .fn()
        .mockResolvedValue({ mediaIds: ["used"], sha256s: ["used-hash"] }),
    };
    const generation = {
      ensureReferenceDraftJobs: jest
        .fn()
        .mockResolvedValue({ jobIds: ["job"] }),
      confirmImageDraft: jest.fn(),
    };
    const retrieval = { retrieve: jest.fn().mockResolvedValue([]) };
    const client = { run: jest.fn() };
    const runner = new ReferencePostAgentRunner(
      drafts as never,
      generation as never,
      {
        get: jest.fn().mockResolvedValue({
          accountConcept: "concept",
          imageStyle: "style",
          constraints: "",
        }),
      } as never,
      {} as never,
      retrieval as never,
      async () => client as never,
      jest.fn(),
      {} as never,
      jest.fn(),
      {} as never,
    );
    return { runner, drafts, generation, retrieval, client };
  }
  it("passes published exact IDs and hashes to retrieval and stops without LLM when empty", async () => {
    const f = fixture("reference_select");
    await f.runner.runCurrentStage("draft");
    expect(f.retrieval.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        usedSources: { mediaIds: ["used"], sha256s: ["used-hash"] },
      }),
    );
    expect(f.client.run).not.toHaveBeenCalled();
    expect(f.drafts.saveReferenceStage).toHaveBeenCalledWith(
      expect.objectContaining({
        conceptJson: expect.objectContaining({
          pipeline: expect.objectContaining({ state: "needs_input" }),
        }),
      }),
    );
  });
  it("never queues an orphan job after generation set CAS fails", async () => {
    const f = fixture("generation");
    f.drafts.saveReferenceStage.mockResolvedValue(false);
    await f.runner.runCurrentStage("draft");
    expect(f.generation.ensureReferenceDraftJobs).toHaveBeenCalledTimes(1);
    expect(f.generation.confirmImageDraft).not.toHaveBeenCalled();
  });
  it("saves current generation set before queueing it", async () => {
    const f = fixture("generation");
    await f.runner.runCurrentStage("draft");
    expect(f.generation.confirmImageDraft).toHaveBeenCalledWith("job");
    expect(
      f.drafts.saveReferenceStage.mock.invocationCallOrder[0],
    ).toBeLessThan(f.generation.confirmImageDraft.mock.invocationCallOrder[0]);
  });
});

it("recovers partially confirmed accepted generation jobs without restarting completed shots", async () => {
  const drafts = {
    getReferenceDraftState: jest.fn().mockResolvedValue({
      draft: { status: "generating", conceptJson: concept },
      jobs: [
        job("current", "draft"),
        job("old", "draft"),
        job("finished", "completed"),
      ],
    }),
    saveReferenceStage: jest.fn(),
  };
  const generation = { confirmImageDraft: jest.fn() };
  const runner = new ReferencePostAgentRunner(
    drafts as never,
    generation as never,
    ...(Array(8).fill(undefined) as [
      never,
      never,
      never,
      never,
      never,
      never,
      never,
      never,
    ]),
  );
  expect(await runner.aggregateGeneration("draft")).toBe(false);
  expect(generation.confirmImageDraft).toHaveBeenCalledTimes(1);
  expect(generation.confirmImageDraft).toHaveBeenCalledWith("current");
  expect(drafts.saveReferenceStage).not.toHaveBeenCalled();
});

it("recovers a failed aggregate after its failed shot was requeued", async () => {
  const restored = {
    ...concept,
    pipeline: { stage: "generation", state: "running" },
  };
  const drafts = {
    getReferenceDraftState: jest
      .fn()
      .mockResolvedValueOnce({
        draft: { status: "failed", conceptJson: concept },
        jobs: [job("current", "queued")],
      })
      .mockResolvedValueOnce({
        draft: { status: "generating", conceptJson: restored },
        jobs: [job("current", "queued")],
      }),
    restoreReferenceGeneration: jest.fn().mockResolvedValue(true),
    saveReferenceStage: jest.fn(),
  };
  const generation = { confirmImageDraft: jest.fn() };
  const runner = new ReferencePostAgentRunner(
    drafts as never,
    generation as never,
    ...(Array(8).fill(undefined) as [
      never,
      never,
      never,
      never,
      never,
      never,
      never,
      never,
    ]),
  );
  expect(await runner.aggregateGeneration("draft")).toBe(false);
  expect(drafts.restoreReferenceGeneration).toHaveBeenCalledWith(
    "draft",
    concept,
  );
  expect(generation.confirmImageDraft).not.toHaveBeenCalled();
  expect(drafts.saveReferenceStage).not.toHaveBeenCalled();
});

it.each(["published", "approved", "rejected"])(
  "never recovers or confirms generation for a %s draft",
  async (status) => {
    const drafts = {
      getReferenceDraftState: jest.fn().mockResolvedValue({
        draft: { status, conceptJson: concept },
        jobs: [job("current", "draft")],
      }),
      saveReferenceStage: jest.fn(),
      restoreReferenceGeneration: jest.fn(),
    };
    const generation = { confirmImageDraft: jest.fn() };
    const runner = new ReferencePostAgentRunner(
      drafts as never,
      generation as never,
      ...(Array(8).fill(undefined) as [
        never,
        never,
        never,
        never,
        never,
        never,
        never,
        never,
      ]),
    );
    expect(await runner.aggregateGeneration("draft")).toBe(false);
    expect(generation.confirmImageDraft).not.toHaveBeenCalled();
    expect(drafts.restoreReferenceGeneration).not.toHaveBeenCalled();
  },
);

it("uses persisted per-shot visual bindings instead of loading all active identities", async () => {
  const bytes = Buffer.from("reference pixels");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const readBytes = jest
    .fn()
    .mockResolvedValue({ bytes, contentType: "image/png" });
  const saveReferenceStage = jest.fn().mockResolvedValue(true);
  const client = {
    agentSettings: { systemPrompt: "saved", outputSchema: {} },
    run: jest.fn().mockResolvedValue({
      producerLogId: "prompt-log",
      value: {
        status: "ready",
        blockedReason: null,
        shots: [
          {
            shotId: "SHOT_01",
            referenceIds: ["CHARACTER_1", "SOURCE_1"],
            preserve: "framing",
            adjust: "new setting and clothing",
            prompt: "Image 1 identity; Image 2 scene",
            negativePrompt: "",
          },
        ],
      },
    }),
  };
  const match = jest.fn();
  const concept = {
    postGenerationAgent: "reference-v1",
    pipeline: { stage: "image_prompt" },
    referenceAgentConfig: {
      revision: "saved",
      stages: { image_prompt: {} },
      generation: { effectiveModel: "alibaba/qwen-image-3.0-pro/edit" },
    },
    referenceSelection: {
      shots: [
        {
          mediaId: "12",
          sha256,
          shotId: "SHOT_01",
          sortOrder: 0,
          sourceComposition: { content: { personCount: 1 } },
          visualReferences: [
            {
              id: "CHARACTER_1",
              role: "character_identity",
              sha256,
              media: { url: "", storageKey: "identity/chosen.png" },
            },
          ],
        },
      ],
    },
  };
  const runner = new ReferencePostAgentRunner(
    {
      saveReferenceStage,
      getReferenceDraftState: jest.fn().mockResolvedValue({
        draft: {
          characterId: "character",
          status: "generating",
          conceptJson: concept,
        },
      }),
    } as never,
    {} as never,
    {
      get: jest.fn().mockResolvedValue({
        accountConcept: "personal account",
        imageStyle: "smartphone photos",
        constraints: "",
      }),
    } as never,
    {
      getProfile: jest
        .fn()
        .mockResolvedValue({ providerConfig: {}, referenceMedia: [] }),
    } as never,
    {
      findReadSources: jest
        .fn()
        .mockResolvedValue([{ mediaKey: "source/key" }]),
    } as never,
    async () => client as never,
    readBytes,
    {
      resolveAspectRatios: jest.fn().mockResolvedValue({
        feed: { value: "4:5" },
        reel: { value: "9:16" },
        story: { value: "9:16" },
      }),
    } as never,
    jest.fn(),
    { match } as never,
  );
  await runner.runCurrentStage("draft");
  expect(match).not.toHaveBeenCalled();
  expect(client.run.mock.calls[0][0].input.shots[0].references).toEqual([
    {
      id: "CHARACTER_1",
      role: "character_identity",
      inputOrder: 1,
      promptLabel: "Image 1",
    },
    { id: "SOURCE_1", role: "source", inputOrder: 2, promptLabel: "Image 2" },
  ]);
  expect(
    saveReferenceStage.mock.calls[0][0].conceptJson.promptBuild.input.shots[0].references.map(
      (reference: { id: string }) => reference.id,
    ),
  ).toEqual(["CHARACTER_1", "SOURCE_1"]);
});
