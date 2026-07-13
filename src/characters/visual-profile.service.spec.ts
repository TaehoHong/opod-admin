import { VisualProfileService } from "./visual-profile.service";

function prismaMock(overrides: Record<string, unknown> = {}) {
  return {
    character: {
      findUnique: jest.fn().mockResolvedValue({ id: "ai-1" }),
    },
    characterVisualProfile: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
    },
    characterVisualProfileReference: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    characterActionLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    generationJob: {
      create: jest.fn(),
    },
    media: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
    ...overrides,
  };
}

function makeService(prisma: ReturnType<typeof prismaMock>) {
  return new (
    VisualProfileService as new (prisma: unknown) => VisualProfileService
  )(prisma);
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
};

describe("VisualProfileService", () => {
  it("returns an empty default profile before one exists", async () => {
    const prisma = prismaMock();
    const service = makeService(prisma);

    await expect(service.getProfile("ai-1")).resolves.toEqual({
      characterId: "ai-1",
      appearancePrompt: "",
      stylePrompt: "",
      negativePrompt: "",
      referenceMedia: [],
    });
  });

  it("rejects a missing character", async () => {
    const prisma = prismaMock({
      character: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    const service = makeService(prisma);

    await expect(service.getProfile("missing")).rejects.toThrow(
      "Character not found",
    );
  });

  it("upserts prompts and records an action log", async () => {
    const prisma = prismaMock();
    prisma.characterVisualProfile.upsert.mockResolvedValue(storedProfile);
    const service = makeService(prisma);

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
    expect(prisma.characterVisualProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { characterId: "ai-1" },
        create: expect.objectContaining({
          characterId: "ai-1",
          appearancePrompt: "young woman, short black hair",
        }),
      }),
    );
    expect(prisma.characterActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actionType: "VISUAL_PROFILE_UPDATED" }),
    });
  });

  it("rejects overlong prompts", async () => {
    const prisma = prismaMock();
    const service = makeService(prisma);

    await expect(
      service.upsertProfile({
        characterId: "ai-1",
        appearancePrompt: "a".repeat(4001),
      }),
    ).rejects.toThrow("Appearance prompt must be at most 4000 characters");
  });

  it("replaces references with upload-confirmed image media only", async () => {
    const prisma = prismaMock();
    prisma.media.findUnique.mockResolvedValue({
      id: "media-1",
      mediaType: "image",
      uploadedAt: new Date(),
    });
    const txDeleteMany = jest.fn();
    const txCreateMany = jest.fn();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          characterVisualProfile: {
            upsert: jest.fn().mockResolvedValue({ id: "profile-1" }),
            findUnique: jest.fn().mockResolvedValue(storedProfile),
          },
          characterVisualProfileReference: {
            deleteMany: txDeleteMany,
            createMany: txCreateMany,
          },
        }),
    );
    const service = makeService(prisma);

    await expect(
      service.setReferences({ characterId: "ai-1", mediaIds: ["media-1"] }),
    ).resolves.toMatchObject({ characterId: "ai-1" });
    expect(txDeleteMany).toHaveBeenCalledWith({
      where: { profileId: "profile-1" },
    });
    expect(txCreateMany).toHaveBeenCalledWith({
      data: [{ profileId: "profile-1", mediaId: "media-1", sortOrder: 10 }],
    });
  });

  it("rejects unconfirmed reference media", async () => {
    const prisma = prismaMock();
    prisma.media.findUnique.mockResolvedValue({
      id: "media-1",
      mediaType: "image",
      uploadedAt: null,
    });
    const service = makeService(prisma);

    await expect(
      service.setReferences({ characterId: "ai-1", mediaIds: ["media-1"] }),
    ).rejects.toThrow("Media upload is not confirmed");
  });

  it("rejects more than five references", async () => {
    const prisma = prismaMock();
    const service = makeService(prisma);

    await expect(
      service.setReferences({
        characterId: "ai-1",
        mediaIds: ["m1", "m2", "m3", "m4", "m5", "m6"],
      }),
    ).rejects.toThrow("Reference media must be 5 or fewer");
  });

  it("compiles the test generation prompt from profile and scene", async () => {
    const prisma = prismaMock();
    prisma.characterVisualProfile.findUnique.mockResolvedValue(storedProfile);
    prisma.generationJob.create.mockResolvedValue({
      id: "job-1",
      status: "queued",
    });
    const service = makeService(prisma);

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
    expect(prisma.generationJob.create).toHaveBeenCalledWith({
      data: {
        characterId: "ai-1",
        mediaType: "image",
        prompt:
          "young woman, short black hair, walking on a beach at sunset, film photography, Kodak Portra",
      },
      select: { id: true, status: true },
    });
  });

  it("rejects test generation without any prompt material", async () => {
    const prisma = prismaMock();
    const service = makeService(prisma);

    await expect(
      service.enqueueTestGeneration({ characterId: "ai-1" }),
    ).rejects.toThrow("Visual profile prompts or a test scene are required");
  });
});
