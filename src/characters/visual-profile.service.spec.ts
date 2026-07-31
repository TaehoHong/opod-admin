import {
  VisualProfileRepository,
  type VisualProfileRow,
} from "./visual-profile.repository";
import { VisualProfileService } from "./visual-profile.service";

// Prisma를 흉내내지 않고 repository를 대신 세운다
// (docs/02-development-rules.md "Module and Repository Rules").
function repositoryFake(overrides: Partial<VisualProfileRepository> = {}) {
  return {
    characterExists: jest.fn().mockResolvedValue(true),
    findUploadedMedia: jest.fn(),
    findProfile: jest.fn().mockResolvedValue(null),
    upsertProfile: jest.fn(),
    findUncaptionedReferences: jest.fn().mockResolvedValue([]),
    setReferenceDescription: jest.fn(),
    replaceReferences: jest.fn(),
    createTestGenerationJob: jest.fn(),
    recordActionLog: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as jest.Mocked<VisualProfileRepository>;
}

function makeService(repository: jest.Mocked<VisualProfileRepository>) {
  return new VisualProfileService(repository);
}

const storedProfile = {
  id: "profile-1",
  characterId: "ai-1",
  appearancePrompt: "young woman, short black hair",
  stylePrompt: "film photography, Kodak Portra",
  negativePrompt: "blurry",
  providerConfig: null,
  updatedAt: new Date("2026-07-12T00:00:00.000Z"),
  referenceMedia: [
    {
      mediaId: "media-1",
      sortOrder: 10,
      media: { url: "https://cdn.local/ref-1.png" },
    },
  ],
} as unknown as VisualProfileRow;

describe("VisualProfileService", () => {
  it("returns an empty default profile before one exists", async () => {
    const service = makeService(repositoryFake());

    await expect(service.getProfile("ai-1")).resolves.toEqual({
      characterId: "ai-1",
      appearancePrompt: "",
      stylePrompt: "",
      negativePrompt: "",
      referenceMedia: [],
    });
  });

  it("rejects a missing character", async () => {
    const service = makeService(
      repositoryFake({ characterExists: jest.fn().mockResolvedValue(false) }),
    );

    await expect(service.getProfile("missing")).rejects.toThrow(
      "Character not found",
    );
  });

  it("upserts prompts and records an action log", async () => {
    const repository = repositoryFake({
      upsertProfile: jest.fn().mockResolvedValue(storedProfile),
    });
    const service = makeService(repository);

    await expect(
      service.upsertProfile({
        characterId: "ai-1",
        appearancePrompt: " young woman, short black hair ",
        stylePrompt: "film photography, Kodak Portra",
        negativePrompt: "blurry",
      }),
    ).resolves.toMatchObject({
      characterId: "ai-1",
      appearancePrompt: "young woman, short black hair",
      referenceMedia: [
        { mediaId: "media-1", url: "https://cdn.local/ref-1.png" },
      ],
    });
    expect(repository.upsertProfile).toHaveBeenCalledWith(
      "ai-1",
      expect.objectContaining({
        appearancePrompt: "young woman, short black hair",
      }),
    );
    expect(repository.recordActionLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "VISUAL_PROFILE_UPDATED" }),
    );
  });

  it("rejects overlong prompts", async () => {
    const service = makeService(repositoryFake());

    await expect(
      service.upsertProfile({
        characterId: "ai-1",
        appearancePrompt: "a".repeat(4001),
      }),
    ).rejects.toThrow("Appearance prompt must be at most 4000 characters");
  });

  it("replaces references with upload-confirmed image media only", async () => {
    const repository = repositoryFake({
      findUploadedMedia: jest.fn().mockResolvedValue({
        id: "media-1",
        mediaType: "image",
        uploadedAt: new Date(),
      }),
      replaceReferences: jest.fn().mockResolvedValue(storedProfile),
    });
    const service = makeService(repository);

    await expect(
      service.setReferences({ characterId: "ai-1", mediaIds: ["media-1"] }),
    ).resolves.toMatchObject({ characterId: "ai-1" });
    expect(repository.replaceReferences).toHaveBeenCalledWith("ai-1", [
      "media-1",
    ]);
  });

  it("rejects unconfirmed reference media", async () => {
    const service = makeService(
      repositoryFake({
        findUploadedMedia: jest.fn().mockResolvedValue({
          id: "media-1",
          mediaType: "image",
          uploadedAt: null,
        }),
      }),
    );

    await expect(
      service.setReferences({ characterId: "ai-1", mediaIds: ["media-1"] }),
    ).rejects.toThrow("Media upload is not confirmed");
  });

  it("rejects more than twenty references", async () => {
    const service = makeService(repositoryFake());

    await expect(
      service.setReferences({
        characterId: "ai-1",
        mediaIds: Array.from({ length: 21 }, (_, i) => `m${i + 1}`),
      }),
    ).rejects.toThrow("Reference media must be 20 or fewer");
  });

  it("compiles the test generation prompt from profile and scene", async () => {
    const repository = repositoryFake({
      findProfile: jest.fn().mockResolvedValue(storedProfile),
      createTestGenerationJob: jest
        .fn()
        .mockResolvedValue({ id: "job-1", status: "queued" }),
    });
    const service = makeService(repository);

    await expect(
      service.enqueueTestGeneration({
        characterId: "ai-1",
        scene: "walking on a beach at sunset",
      }),
    ).resolves.toEqual({
      jobId: "job-1",
      prompt:
        "young woman, short black hair, walking on a beach at sunset, film photography, Kodak Portra",
      status: "queued",
    });
    expect(repository.createTestGenerationJob).toHaveBeenCalledWith({
      characterId: "ai-1",
      prompt:
        "young woman, short black hair, walking on a beach at sunset, film photography, Kodak Portra",
    });
  });

  it("rejects test generation without any prompt material", async () => {
    const service = makeService(repositoryFake());

    await expect(
      service.enqueueTestGeneration({ characterId: "ai-1" }),
    ).rejects.toThrow("Visual profile prompts or a test scene are required");
  });
});
