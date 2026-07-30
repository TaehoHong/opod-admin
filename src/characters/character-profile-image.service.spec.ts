import { BadRequestException } from "@nestjs/common";
import { CharacterProfileImageService } from "./character-profile-image.service";

const emptyProfile = {
  characterId: "character-1",
  image: null,
  crop: { x: 0.5, y: 0.5, zoom: 1 },
};

describe("CharacterProfileImageService", () => {
  it("assigns a confirmed image with normalized crop values", async () => {
    const save = jest.fn().mockResolvedValue({
      characterId: "character-1",
      image: {
        id: "media-1",
        url: "https://cdn.example/profile.png",
        width: 1200,
        height: 1600,
      },
      crop: { x: 0.2, y: 0.7, zoom: 2 },
    });
    const service = new CharacterProfileImageService({
      get: jest.fn().mockResolvedValue(emptyProfile),
      findMedia: jest.fn().mockResolvedValue({
        id: "media-1",
        mediaType: "image",
        uploadedAt: new Date("2026-07-30T00:00:00.000Z"),
      }),
      save,
    } as never);

    await expect(
      service.set("character-1", {
        mediaId: "media-1",
        crop: { x: 0.2, y: 0.7, zoom: 2 },
      }),
    ).resolves.toMatchObject({
      image: { id: "media-1" },
      crop: { x: 0.2, y: 0.7, zoom: 2 },
    });
    expect(save).toHaveBeenCalledWith("character-1", {
      mediaId: "media-1",
      crop: { x: 0.2, y: 0.7, zoom: 2 },
    });
  });

  it.each([
    [
      "pending upload",
      {
        id: "media-1",
        mediaType: "image",
        uploadedAt: null,
      },
      "Media upload is not confirmed",
    ],
    [
      "video",
      {
        id: "media-1",
        mediaType: "video",
        uploadedAt: new Date("2026-07-30T00:00:00.000Z"),
      },
      "Profile media must be an image",
    ],
  ])("rejects %s media", async (_label, media, message) => {
    const service = new CharacterProfileImageService({
      get: jest.fn().mockResolvedValue(emptyProfile),
      findMedia: jest.fn().mockResolvedValue(media),
      save: jest.fn(),
    } as never);

    await expect(
      service.set("character-1", { mediaId: "media-1" }),
    ).rejects.toThrow(message);
  });

  it("rejects crop values outside the supported range", async () => {
    const service = new CharacterProfileImageService({
      get: jest.fn().mockResolvedValue(emptyProfile),
      findMedia: jest.fn().mockResolvedValue({
        id: "media-1",
        mediaType: "image",
        uploadedAt: new Date("2026-07-30T00:00:00.000Z"),
      }),
      save: jest.fn(),
    } as never);

    await expect(
      service.set("character-1", {
        mediaId: "media-1",
        crop: { x: -0.1, y: 0.5, zoom: 1 },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("clears the relation and resets crop values without deleting media", async () => {
    const clear = jest.fn().mockResolvedValue(emptyProfile);
    const repository = {
      get: jest.fn().mockResolvedValue({
        ...emptyProfile,
        image: { id: "media-1", url: "https://cdn.example/profile.png" },
      }),
      clear,
    };
    const service = new CharacterProfileImageService(repository as never);

    await expect(service.clear("character-1")).resolves.toEqual(emptyProfile);
    expect(clear).toHaveBeenCalledWith("character-1");
    expect(repository).not.toHaveProperty("deleteMedia");
  });
});
