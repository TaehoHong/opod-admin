import {
  GenerationRepository,
  type GenerationJobDetailRow,
} from "./generation.repository";
import { GenerationService } from "./generation.service";

const job = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "job-1",
    characterId: "ai-1",
    mediaType: "image",
    prompt: "portrait",
    inputPrompt: null,
    candidateCount: null,
    status: "queued",
    outputMediaId: null,
    outputMedia: null,
    outputs: [],
    character: { visualProfile: null },
    paramsJson: null,
    provider: null,
    attemptCount: 0,
    draftId: null,
    originJobId: null,
    errorMessage: null,
    costUsd: null,
    sortOrder: 0,
    createdAt: new Date("2026-07-12T00:00:00.000Z"),
    updatedAt: new Date("2026-07-12T00:01:00.000Z"),
    ...overrides,
  }) as unknown as GenerationJobDetailRow;

const character = (overrides: Record<string, unknown> = {}) => ({
  id: "ai-1",
  displayName: "한소이",
  bio: "",
  interests: [],
  personas: [],
  memories: [],
  posts: [],
  visualProfile: {
    appearancePrompt: "same face",
    stylePrompt: "film grain",
    negativePrompt: "blurry",
    referenceMedia: [
      {
        mediaId: "ref-1",
        description: "portrait",
        media: { uploadedAt: new Date("2026-07-12T00:00:00.000Z") },
      },
    ],
  },
  ...overrides,
});

const repositoryFake = (
  overrides: Partial<jest.Mocked<GenerationRepository>> = {},
): jest.Mocked<GenerationRepository> =>
  ({
    findCharacterForImageDraft: jest.fn().mockResolvedValue(character()),
    createImageDraft: jest.fn().mockResolvedValue(job({ status: "draft" })),
    updateImageDraft: jest.fn().mockResolvedValue(true),
    confirmImageDraft: jest.fn().mockResolvedValue(true),
    selectOutput: jest.fn().mockResolvedValue("selected"),
    findJob: jest.fn().mockResolvedValue(job()),
    createRegeneratedImageJob: jest
      .fn()
      .mockResolvedValue(job({ status: "draft", originJobId: "job-1" })),
    cursorMatchesFilter: jest.fn().mockResolvedValue(true),
    findManyForList: jest.fn().mockResolvedValue([]),
    enqueueJob: jest.fn().mockResolvedValue(job()),
    startJob: jest.fn().mockResolvedValue(true),
    retryJob: jest
      .fn()
      .mockResolvedValue(job({ id: "job-2", originJobId: "job-1" })),
    failJob: jest.fn().mockResolvedValue(true),
    findUploadedMedia: jest.fn().mockResolvedValue({
      id: "media-1",
      mediaType: "image",
      url: "https://cdn.example/media-1.jpg",
      width: 1024,
      height: 1024,
      durationSeconds: null,
      uploadedAt: new Date("2026-07-12T00:00:00.000Z"),
    }),
    completeJobWithMediaId: jest.fn().mockResolvedValue(true),
    completeJobWithUrl: jest.fn().mockResolvedValue(true),
    findJobDetail: jest.fn().mockResolvedValue(job()),
    ...overrides,
  }) as unknown as jest.Mocked<GenerationRepository>;

describe("GenerationService", () => {
  it("rejects a character-visible image draft without an uploaded identity reference", async () => {
    const repository = repositoryFake({
      findCharacterForImageDraft: jest.fn().mockResolvedValue(
        character({
          visualProfile: {
            appearancePrompt: "same face",
            stylePrompt: "film grain",
            negativePrompt: "",
            referenceMedia: [],
          },
        }),
      ),
    });
    const service = new GenerationService(repository);

    await expect(
      service.createImageDraft({
        characterId: "ai-1",
        inputPrompt: "walking in Seongsu",
        candidateCount: 2,
      }),
    ).rejects.toThrow(
      "shot 0 shows the character but has no usable identity reference",
    );
    expect(repository.createImageDraft).not.toHaveBeenCalled();
  });

  it("compiles and persists a draft with generation context and aspect ratio", async () => {
    const repository = repositoryFake({
      createImageDraft: jest.fn().mockResolvedValue(
        job({
          status: "draft",
          inputPrompt: "walking in Seongsu",
          prompt:
            "same face, Final image content: walking in Seongsu. Use a physically plausible camera viewpoint consistent with the final-frame scene; do not add any off-frame photographer or capture equipment, film grain",
          candidateCount: 3,
          paramsJson: {
            aspect_ratio: "16:9",
            _shot: {
              sortOrder: 0,
              scene: "walking in Seongsu",
              captureSetup:
                "No separate capture metadata was provided; follow the scene literally with a physically plausible viewpoint",
              characterVisible: true,
              referenceMediaIds: ["ref-1"],
            },
          },
        }),
      ),
    });
    const service = new GenerationService(repository);

    await expect(
      service.createImageDraft({
        characterId: "ai-1",
        inputPrompt: " walking in Seongsu ",
        candidateCount: 3,
        aspectRatio: "16:9",
      }),
    ).resolves.toMatchObject({
      status: "draft",
      inputPrompt: "walking in Seongsu",
      candidateCount: 3,
      aspectRatio: "16:9",
      generationContext: {
        negativePrompt: "blurry",
        referenceImageCount: 1,
        route: "edit",
      },
    });
    expect(repository.createImageDraft).toHaveBeenCalledWith({
      characterId: "ai-1",
      inputPrompt: "walking in Seongsu",
      prompt:
        "same face, Final image content: walking in Seongsu. Use a physically plausible camera viewpoint consistent with the final-frame scene; do not add any off-frame photographer or capture equipment, film grain",
      candidateCount: 3,
      paramsJson: {
        aspect_ratio: "16:9",
        _shot: {
          sortOrder: 0,
          scene: "walking in Seongsu",
          captureSetup:
            "No separate capture metadata was provided; follow the scene literally with a physically plausible viewpoint",
          characterVisible: true,
          referenceMediaIds: ["ref-1"],
        },
      },
    });
  });

  it("expands the scene and builds the prompt with injected providers", async () => {
    const repository = repositoryFake({
      findCharacterForImageDraft: jest.fn().mockResolvedValue(
        character({
          bio: "필름 사진",
          interests: ["필름사진"],
          personas: [{ title: "말투", content: "차분한 존댓말" }],
          memories: [{ content: "제주 애월 여행 (2026-07)" }],
          posts: [{ content: "지난 캡션" }],
        }),
      ),
      createImageDraft: jest.fn().mockImplementation((input) =>
        Promise.resolve(
          job({
            status: "draft",
            inputPrompt: input.inputPrompt,
            prompt: input.prompt,
            paramsJson: input.paramsJson,
          }),
        ),
      ),
    });
    const plan = jest.fn().mockResolvedValue({
      caption: "무시됨",
      hashtags: [],
      shots: [
        {
          sortOrder: 0,
          scene: "비 오는 오후 창가 카페",
          captureSetup: "창틀 위 고정 카메라",
          characterVisible: true,
          referenceIds: ["ref-1"],
        },
      ],
    });
    const build = jest.fn().mockResolvedValue({ prompts: ["english prompt"] });
    const service = new GenerationService(
      repository,
      async () => ({ name: "llm:planner", plan }),
      async () => ({ name: "llm:builder", build }),
    );

    await expect(
      service.createImageDraft({
        characterId: "ai-1",
        inputPrompt: "따듯한 카페",
        candidateCount: 1,
      }),
    ).resolves.toMatchObject({
      expandedScene: "비 오는 오후 창가 카페",
      plannerName: "llm:planner",
    });
    expect(plan).toHaveBeenCalledWith(
      expect.objectContaining({
        characterName: "한소이",
        sceneHint: "따듯한 카페",
        memories: ["제주 애월 여행 (2026-07)"],
        recentCaptions: ["지난 캡션"],
        maxShots: 1,
      }),
      expect.objectContaining({ characterId: "ai-1" }),
    );
    expect(build).toHaveBeenCalledWith(
      {
        appearancePrompt: "same face",
        stylePrompt: "film grain",
        shots: [
          {
            sortOrder: 0,
            scene: "비 오는 오후 창가 카페",
            captureSetup: "창틀 위 고정 카메라",
            characterVisible: true,
          },
        ],
      },
      expect.objectContaining({ characterId: "ai-1" }),
    );
    expect(repository.createImageDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "english prompt",
        paramsJson: expect.objectContaining({
          _wizard: {
            plannerName: "llm:planner",
            builderName: "llm:builder",
            expandedScene: "비 오는 오후 창가 카페",
          },
        }),
      }),
    );
  });

  it.each([
    {
      provider: "planner",
      makeService: (repository: jest.Mocked<GenerationRepository>) =>
        new GenerationService(repository, async () => ({
          name: "llm:planner",
          plan: jest.fn().mockRejectedValue(new Error("LLM timeout")),
        })),
      message: "Scene planning failed (llm:planner): LLM timeout",
    },
    {
      provider: "builder",
      makeService: (repository: jest.Mocked<GenerationRepository>) =>
        new GenerationService(
          repository,
          async () => null,
          async () => ({
            name: "llm:builder",
            build: jest.fn().mockRejectedValue(new Error("builder timeout")),
          }),
        ),
      message: "Prompt build failed (llm:builder): builder timeout",
    },
  ])(
    "reports $provider failures without persisting",
    async ({ makeService, message }) => {
      const repository = repositoryFake();

      await expect(
        makeService(repository).createImageDraft({
          characterId: "ai-1",
          inputPrompt: "따듯한 카페",
          candidateCount: 1,
        }),
      ).rejects.toThrow(message);
      expect(repository.createImageDraft).not.toHaveBeenCalled();
    },
  );

  it.each([0, 5, 1.5])("rejects candidateCount %p", async (candidateCount) => {
    const service = new GenerationService(repositoryFake());

    await expect(
      service.createImageDraft({
        characterId: "ai-1",
        inputPrompt: "portrait",
        candidateCount,
      }),
    ).rejects.toThrow("Candidate count must be an integer from 1 to 4");
  });

  it("updates only drafts and forwards trimmed values", async () => {
    const repository = repositoryFake({
      findJobDetail: jest
        .fn()
        .mockResolvedValue(
          job({ status: "draft", prompt: "edited prompt", candidateCount: 4 }),
        ),
    });
    const service = new GenerationService(repository);

    await expect(
      service.updateImageDraft("job-1", {
        prompt: " edited prompt ",
        candidateCount: 4,
      }),
    ).resolves.toMatchObject({
      status: "draft",
      prompt: "edited prompt",
      candidateCount: 4,
    });
    expect(repository.updateImageDraft).toHaveBeenCalledWith("job-1", {
      prompt: "edited prompt",
      candidateCount: 4,
    });

    repository.updateImageDraft.mockResolvedValue(false);
    repository.findJobDetail.mockResolvedValue(job({ status: "completed" }));
    await expect(
      service.updateImageDraft("job-1", {
        prompt: "edited prompt",
        candidateCount: 4,
      }),
    ).rejects.toThrow("Only draft generation jobs can be edited");
  });

  it("confirms drafts while preserving idempotent non-draft results", async () => {
    const repository = repositoryFake({
      findJobDetail: jest.fn().mockResolvedValue(job({ status: "queued" })),
    });
    const service = new GenerationService(repository);

    await expect(service.confirmImageDraft("job-1")).resolves.toMatchObject({
      status: "queued",
    });

    repository.confirmImageDraft.mockResolvedValue(false);
    await expect(service.confirmImageDraft("job-1")).resolves.toMatchObject({
      status: "queued",
    });

    repository.findJobDetail.mockResolvedValue(job({ status: "draft" }));
    await expect(service.confirmImageDraft("job-1")).rejects.toThrow(
      "Only draft generation jobs can be confirmed",
    );
  });

  it("rejects an output that is not owned by a completed job", async () => {
    const repository = repositoryFake({
      selectOutput: jest.fn().mockResolvedValue("missing"),
    });

    await expect(
      new GenerationService(repository).selectOutput("job-1", "media-x"),
    ).rejects.toThrow("Generation output not found for completed job");
    expect(repository.findJobDetail).not.toHaveBeenCalled();
  });

  it.each(["completed", "failed"] as const)(
    "regenerates a %s image job as a linked draft",
    async (status) => {
      const source = job({ status });
      const repository = repositoryFake({
        findJob: jest.fn().mockResolvedValue(source),
      });

      await expect(
        new GenerationService(repository).regenerateImageJob("job-1"),
      ).resolves.toMatchObject({ status: "draft", originJobId: "job-1" });
      expect(repository.createRegeneratedImageJob).toHaveBeenCalledWith(source);
    },
  );

  it.each([
    ["queued", "image"],
    ["completed", "video"],
  ])("rejects regenerating a %s %s job", async (status, mediaType) => {
    const repository = repositoryFake({
      findJob: jest.fn().mockResolvedValue(job({ status, mediaType })),
    });

    await expect(
      new GenerationService(repository).regenerateImageJob("job-1"),
    ).rejects.toThrow("Only completed or failed image jobs can be regenerated");
  });

  it("lists filtered jobs with validated cursor pagination", async () => {
    const repository = repositoryFake({
      findManyForList: jest
        .fn()
        .mockResolvedValue([
          job({ id: "job-3" }),
          job({ id: "job-2" }),
          job({ id: "job-1" }),
        ]),
    });
    const service = new GenerationService(repository);

    await expect(
      service.listJobs({
        characterId: " ai-1 ",
        status: "completed",
        mediaType: "image",
        cursor: Buffer.from(JSON.stringify({ id: "job-cursor" })).toString(
          "base64url",
        ),
        limit: 2,
      }),
    ).resolves.toMatchObject({
      items: [{ id: "job-3" }, { id: "job-2" }],
      nextCursor: expect.any(String),
    });
    expect(repository.cursorMatchesFilter).toHaveBeenCalledWith("job-cursor", {
      characterId: "ai-1",
      status: "completed",
      mediaType: "image",
    });
    expect(repository.findManyForList).toHaveBeenCalledWith({
      characterId: "ai-1",
      status: "completed",
      mediaType: "image",
      take: 3,
      cursor: "job-cursor",
    });
  });

  it("rejects cursors outside filters and invalid filters", async () => {
    const repository = repositoryFake({
      cursorMatchesFilter: jest.fn().mockResolvedValue(false),
    });
    const service = new GenerationService(repository);
    await expect(
      service.listJobs({
        status: "failed",
        cursor: Buffer.from(JSON.stringify({ id: "job-cursor" })).toString(
          "base64url",
        ),
        limit: 10,
      }),
    ).rejects.toThrow("Invalid cursor");
    await expect(
      service.listJobs({ status: "paused", limit: 10 }),
    ).rejects.toThrow(
      "Generation job status must be draft, queued, running, completed, or failed",
    );
    await expect(
      service.listJobs({ mediaType: "audio", limit: 10 }),
    ).rejects.toThrow("Generation media type must be image or video");
  });

  it("validates and trims manually enqueued jobs", async () => {
    const repository = repositoryFake();
    const service = new GenerationService(repository);

    await service.enqueueJob({
      characterId: "ai-1",
      mediaType: "video",
      prompt: " cinematic pan ",
      provider: "manual",
    });
    expect(repository.enqueueJob).toHaveBeenCalledWith({
      characterId: "ai-1",
      mediaType: "video",
      prompt: "cinematic pan",
      provider: "manual",
    });
    await expect(
      service.enqueueJob({
        characterId: "ai-1",
        mediaType: "audio",
        prompt: "sound",
      }),
    ).rejects.toThrow("Generation media type must be image or video");
    await expect(
      service.enqueueJob({
        characterId: "ai-1",
        mediaType: "image",
        prompt: " ",
      }),
    ).rejects.toThrow("Generation prompt is required");
  });

  it("returns lifecycle detail with candidates and generation context", async () => {
    const repository = repositoryFake({
      findJobDetail: jest.fn().mockResolvedValue(
        job({
          status: "completed",
          attemptCount: 2,
          provider: "replicate",
          costUsd: { toString: () => "0.250000" },
          outputMediaId: "media-2",
          outputMedia: {
            mediaType: "image",
            url: "https://cdn.example/media-2.jpg",
            width: 1024,
            height: 1024,
            durationSeconds: null,
          },
          outputs: [
            {
              mediaId: "media-1",
              candidateIndex: 0,
              selected: false,
              media: { url: "https://cdn.example/media-1.jpg" },
            },
            {
              mediaId: "media-2",
              candidateIndex: 1,
              selected: true,
              media: { url: "https://cdn.example/media-2.jpg" },
            },
          ],
          character: {
            visualProfile: {
              negativePrompt: "blurry",
              referenceMedia: [
                { media: { uploadedAt: new Date("2026-07-12T00:00:00Z") } },
              ],
            },
          },
        }),
      ),
    });

    await expect(
      new GenerationService(repository).getJob("job-1"),
    ).resolves.toMatchObject({
      status: "completed",
      attemptCount: 2,
      provider: "replicate",
      costUsd: "0.250000",
      outputMediaId: "media-2",
      outputs: [
        { mediaId: "media-1", selected: false },
        { mediaId: "media-2", selected: true },
      ],
      generationContext: {
        negativePrompt: "blurry",
        referenceImageCount: 1,
        route: "edit",
      },
    });
  });

  it("rejects a missing generation job", async () => {
    const repository = repositoryFake({
      findJobDetail: jest.fn().mockResolvedValue(null),
    });
    await expect(
      new GenerationService(repository).getJob("missing"),
    ).rejects.toThrow("Generation job not found");
  });

  it("starts only queued jobs and assigns a recovery lease", async () => {
    const repository = repositoryFake({
      findJobDetail: jest.fn().mockResolvedValue(job({ status: "running" })),
    });
    const service = new GenerationService(repository);

    await expect(service.startJob("job-1")).resolves.toMatchObject({
      status: "running",
    });
    expect(repository.startJob).toHaveBeenCalledWith("job-1", expect.any(Date));

    repository.startJob.mockResolvedValue(false);
    await expect(service.startJob("job-1")).rejects.toThrow(
      "Only queued generation jobs can start",
    );
  });

  it("completes a running job from a URL and preserves idempotency", async () => {
    const repository = repositoryFake({
      findJobDetail: jest
        .fn()
        .mockResolvedValueOnce(job({ status: "running" }))
        .mockResolvedValue(job({ status: "completed" })),
    });
    const service = new GenerationService(repository);

    await expect(
      service.completeJob({
        jobId: "job-1",
        url: " https://cdn.example/output.jpg ",
        width: 1024,
      }),
    ).resolves.toMatchObject({ status: "completed" });
    expect(repository.completeJobWithUrl).toHaveBeenCalledWith({
      jobId: "job-1",
      mediaType: "image",
      url: "https://cdn.example/output.jpg",
      width: 1024,
      height: undefined,
      durationSeconds: undefined,
    });

    repository.completeJobWithUrl.mockResolvedValue(false);
    await expect(
      service.completeJob({
        jobId: "job-1",
        url: "https://cdn.example/output.jpg",
      }),
    ).resolves.toMatchObject({ status: "completed" });
  });

  it("completes with confirmed media of the matching type", async () => {
    const repository = repositoryFake({
      findJobDetail: jest
        .fn()
        .mockResolvedValueOnce(job({ status: "running" }))
        .mockResolvedValue(
          job({ status: "completed", outputMediaId: "media-1" }),
        ),
    });
    const service = new GenerationService(repository);

    await expect(
      service.completeJob({ jobId: "job-1", mediaId: "media-1" }),
    ).resolves.toMatchObject({
      status: "completed",
      outputMediaId: "media-1",
    });
    expect(repository.findUploadedMedia).toHaveBeenCalledWith("media-1");
    expect(repository.completeJobWithMediaId).toHaveBeenCalledWith(
      "job-1",
      "media-1",
    );
  });

  it("rejects unconfirmed or wrong-type completion media", async () => {
    const repository = repositoryFake({
      findJobDetail: jest.fn().mockResolvedValue(job({ status: "running" })),
      findUploadedMedia: jest.fn().mockResolvedValue({
        id: "media-1",
        mediaType: "video",
        url: "https://cdn.example/output.mp4",
        width: null,
        height: null,
        durationSeconds: 10,
        uploadedAt: new Date("2026-07-12T00:00:00Z"),
      }),
    });
    await expect(
      new GenerationService(repository).completeJob({
        jobId: "job-1",
        mediaId: "media-1",
      }),
    ).rejects.toThrow("Media type does not match generation job");
    expect(repository.completeJobWithMediaId).not.toHaveBeenCalled();
  });

  it("fails queued or running jobs and keeps repeated failure idempotent", async () => {
    const repository = repositoryFake({
      findJobDetail: jest.fn().mockResolvedValue(job({ status: "failed" })),
    });
    const service = new GenerationService(repository);

    await expect(
      service.failJob({ jobId: "job-1", errorMessage: "provider timeout" }),
    ).resolves.toMatchObject({ status: "failed" });
    expect(repository.failJob).toHaveBeenCalledWith(
      "job-1",
      "provider timeout",
    );

    repository.failJob.mockResolvedValue(false);
    await expect(
      service.failJob({ jobId: "job-1", errorMessage: "provider timeout" }),
    ).resolves.toMatchObject({ status: "failed" });

    repository.findJobDetail.mockResolvedValue(job({ status: "completed" }));
    await expect(
      service.failJob({ jobId: "job-1", errorMessage: "provider timeout" }),
    ).rejects.toThrow("Only queued or running generation jobs can fail");
  });

  it("retries only standalone failed jobs with a trimmed reason", async () => {
    const source = job({ status: "failed" });
    const repository = repositoryFake({
      findJob: jest.fn().mockResolvedValue(source),
    });
    const service = new GenerationService(repository);

    await expect(
      service.retryJob("job-1", " operator retry "),
    ).resolves.toMatchObject({ id: "job-2", originJobId: "job-1" });
    expect(repository.retryJob).toHaveBeenCalledWith(source, "operator retry");

    repository.findJob.mockResolvedValue(
      job({ status: "failed", draftId: "draft-1" }),
    );
    await expect(service.retryJob("job-1")).rejects.toThrow(
      "Draft generation jobs must be retried from draft review",
    );

    repository.findJob.mockResolvedValue(job({ status: "completed" }));
    await expect(service.retryJob("job-1")).rejects.toThrow(
      "Only failed generation jobs can be retried",
    );
  });
});
