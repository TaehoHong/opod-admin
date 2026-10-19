import { generationSetHash } from "../post-production/post-pipeline-v3";
import { DraftsService } from "./drafts.service";
import { DraftsRepository } from "./drafts.repository";
import { GenerationSettingsService } from "../settings/generation-settings.service";
import { GenerationService } from "../generation/generation.service";

describe("reference draft state domain", () => {
  const concept = {
    postGenerationAgent: "reference-v1",
    pipeline: { stage: "generation", state: "failed" },
    promptBuild: { revision: 2 },
    generationBuild: { jobIds: ["current"], promptRevision: 2 },
  };
  const repository = {
    findDraftConcept: jest.fn(),
    findDraft: jest.fn(),
    restoreReferenceGeneration: jest.fn(),
    findDraftJobs: jest.fn(),
    saveReferenceStage: jest.fn(),
  };
  const generation = { retryJob: jest.fn() };
  const service = new DraftsService(
    repository as unknown as DraftsRepository,
    {} as GenerationSettingsService,
    generation as unknown as GenerationService,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    repository.findDraftConcept.mockResolvedValue({ conceptJson: concept });
    repository.findDraft.mockResolvedValue({
      status: "failed",
      leaseExpiresAt: null,
      conceptJson: concept,
    });
    repository.restoreReferenceGeneration.mockResolvedValue(true);
    generation.retryJob.mockResolvedValue({ id: "current", status: "queued" });
    repository.findDraftJobs.mockResolvedValue([
      {
        id: "current",
        status: "failed",
        paramsJson: { _referenceAgent: { promptRevision: "2" } },
      },
    ]);
  });
  it("allows the saved generation set and rejects an orphan job", async () => {
    await expect(
      service.assertGenerationJobMutable("draft", "current"),
    ).resolves.toBeUndefined();
    await expect(
      service.assertGenerationJobMutable("draft", "orphan"),
    ).rejects.toThrow("stale or inactive");
  });
  it("rejects stale prompt revisions in job metadata", async () => {
    repository.findDraftJobs.mockResolvedValue([
      {
        id: "current",
        paramsJson: { _referenceAgent: { promptRevision: "1" } },
      },
    ]);
    await expect(
      service.assertGenerationJobMutable("draft", "current"),
    ).rejects.toThrow("stale or inactive");
  });
  it("keeps natural generation mutable while archived draft jobs remain read-only", async () => {
    repository.findDraftConcept.mockResolvedValue({
      conceptJson: { postGenerationAgent: "natural-v1" },
    });
    await expect(
      service.assertGenerationJobMutable("natural", "job"),
    ).resolves.toBeUndefined();
    repository.findDraftConcept.mockResolvedValue({ conceptJson: {} });
    await expect(
      service.assertGenerationJobMutable("archived", "job"),
    ).rejects.toThrow("읽기 전용");
  });
  it("retries only the failed accepted shot and restores the draft generation state", async () => {
    expect(
      await service.retryReferenceGenerationJob("draft", "current", "retry"),
    ).toEqual({ id: "current", status: "queued" });
    expect(generation.retryJob).toHaveBeenCalledWith("current", "retry");
    expect(repository.restoreReferenceGeneration).toHaveBeenCalledWith(
      "draft",
      concept,
    );
    repository.findDraftJobs.mockResolvedValue([
      {
        id: "current",
        status: "completed",
        paramsJson: { _referenceAgent: { promptRevision: "2" } },
      },
    ]);
    await expect(
      service.retryReferenceGenerationJob("draft", "current"),
    ).rejects.toThrow("Only failed");
    expect(generation.retryJob).toHaveBeenCalledTimes(1);
  });
  it.each(["published", "approved", "rejected"])(
    "rejects generation mutation for %s drafts",
    async (status) => {
      repository.findDraft.mockResolvedValue({
        status,
        leaseExpiresAt: null,
        conceptJson: concept,
      });
      await expect(
        service.retryReferenceGenerationJob("draft", "current"),
      ).rejects.toThrow("not mutable");
      expect(generation.retryJob).not.toHaveBeenCalled();
    },
  );
  it("rejects generation mutation while a stage owns the lease", async () => {
    repository.findDraft.mockResolvedValue({
      status: "generating",
      leaseExpiresAt: new Date(),
      conceptJson: concept,
    });
    await expect(
      service.retryReferenceGenerationJob("draft", "current"),
    ).rejects.toThrow("not mutable");
    expect(generation.retryJob).not.toHaveBeenCalled();
  });
  it("rejects generic plan/prompt/regeneration edits for frozen reference artifacts", async () => {
    await expect(
      service.updatePlan({
        draftId: "draft",
        caption: "changed",
        hashtags: [],
        shots: [],
      }),
    ).rejects.toThrow("frozen");
    await expect(
      service.updatePrompts({ draftId: "draft", items: [] }),
    ).rejects.toThrow("frozen");
    await expect(
      service.queueShot({
        draftId: "draft",
        jobId: "current",
        prompt: "changed",
      }),
    ).rejects.toThrow("frozen");
    await expect(
      service.regenerateShot({
        draftId: "draft",
        jobId: "current",
        prompt: "changed",
      }),
    ).rejects.toThrow("frozen");
  });
  it("delegates stage persistence intact to repository CAS", async () => {
    const input = {
      draftId: "draft",
      expectedConceptJson: concept,
      conceptJson: { ...concept, caption: "caption" },
    };
    repository.saveReferenceStage.mockResolvedValue(false);
    expect(await service.saveReferenceStage(input)).toBe(false);
    expect(repository.saveReferenceStage).toHaveBeenCalledWith(input);
  });
});

describe("reference publication reservation domain", () => {
  function fixture() {
    const concept = {
      postGenerationAgent: "reference-v1",
      referenceSelection: { shots: [{ shotId: "SHOT_01", sortOrder: 0 }] },
      promptBuild: { revision: 2 },
      generationBuild: { jobIds: ["job"], promptRevision: 2 },
      captionBuild: {
        source: { generationSetHash: "", promptBuildRevision: 2 },
      },
    };
    const jobs = [
      {
        id: "job",
        status: "completed",
        sortOrder: 0,
        paramsJson: {
          _referenceAgent: { promptRevision: "2", shotId: "SHOT_01" },
        },
        outputs: [
          {
            mediaId: "photo",
            selected: true,
            media: { url: "https://media/photo" },
          },
        ],
      },
    ];
    const repository = {
      findDraft: jest.fn().mockResolvedValue({
        status: "approved",
        caption: "caption",
        conceptJson: concept,
      }),
      findDraftJobs: jest.fn().mockResolvedValue(jobs),
      pauseReferencePublicationConflict: jest.fn().mockResolvedValue(true),
      claimReferencePublication: jest
        .fn()
        .mockResolvedValue({ id: "draft", leaseExpiresAt: new Date() }),
    };
    const service = new DraftsService(
      repository as unknown as DraftsRepository,
      {} as GenerationSettingsService,
      {} as GenerationService,
    );
    return { concept, jobs, repository, service };
  }
  it("rejects caption made for a different output before reserving sources", async () => {
    const f = fixture();
    await expect(
      f.service.claimReferencePublication("draft", 120),
    ).rejects.toThrow("caption is stale");
    expect(f.repository.claimReferencePublication).not.toHaveBeenCalled();
  });
  it("passes current exact output and concept to atomic repository reservation", async () => {
    const f = fixture();
    f.concept.captionBuild.source.generationSetHash = generationSetHash([
      { sortOrder: 0, jobId: "job", mediaId: "photo" },
    ]);
    await f.service.claimReferencePublication("draft", 120);
    expect(f.repository.claimReferencePublication).toHaveBeenCalledWith(
      expect.objectContaining({
        draftId: "draft",
        expectedConceptJson: f.concept,
        expectedOutputs: [
          expect.objectContaining({ jobId: "job", mediaId: "photo" }),
        ],
      }),
    );
  });
  it("pauses source conflicts with an actionable reason and preserves other errors", async () => {
    const f = fixture();
    f.concept.captionBuild.source.generationSetHash = generationSetHash([
      { sortOrder: 0, jobId: "job", mediaId: "photo" },
    ]);
    f.repository.claimReferencePublication.mockRejectedValue(
      new Error("reference_source_already_published_or_reserved"),
    );
    await expect(
      f.service.claimReferencePublication("draft", 120),
    ).rejects.toThrow("원본을 다시 선택하세요");
    expect(f.repository.pauseReferencePublicationConflict).toHaveBeenCalledWith(
      {
        draftId: "draft",
        expectedConceptJson: f.concept,
        message:
          "동일한 원본을 사용한 게시물이 있거나 게시 중입니다. 원본을 다시 선택하세요.",
      },
    );
    f.repository.pauseReferencePublicationConflict.mockClear();
    f.repository.claimReferencePublication.mockRejectedValue(
      new Error("database unavailable"),
    );
    await expect(
      f.service.claimReferencePublication("draft", 120),
    ).rejects.toThrow("database unavailable");
    expect(
      f.repository.pauseReferencePublicationConflict,
    ).not.toHaveBeenCalled();
  });

  it("does not reserve a draft after current selected output disappears", async () => {
    const f = fixture();
    f.jobs[0].outputs[0].selected = false;
    await expect(
      f.service.claimReferencePublication("draft", 120),
    ).resolves.toBeNull();
    expect(f.repository.claimReferencePublication).not.toHaveBeenCalled();
  });
});
