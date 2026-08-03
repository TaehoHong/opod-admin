import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  DuplicateLocationKeyError,
  LocationsRepository,
} from "./locations.repository";
import { LocationsService } from "./locations.service";

const now = new Date("2026-08-03T00:00:00.000Z");
const row = {
  id: "location-1",
  characterId: "character-1",
  character: { id: "character-1", displayName: "서린", publicId: "seorin" },
  locationKey: "gym",
  displayName: "헬스장",
  description: "description",
  visualPrompt: "prompt",
  negativePrompt: "",
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  references: [],
};

function repository() {
  return {
    characterExists: jest.fn().mockResolvedValue(true),
    findUploadedMedia: jest.fn(),
    cursorMatchesFilter: jest.fn().mockResolvedValue(true),
    findMany: jest.fn().mockResolvedValue([row]),
    findById: jest.fn().mockResolvedValue(row),
    create: jest.fn().mockResolvedValue(row),
    update: jest.fn().mockResolvedValue(row),
    softDelete: jest.fn().mockResolvedValue(undefined),
    replaceReferences: jest.fn().mockResolvedValue(row),
  };
}

describe("LocationsService", () => {
  it("applies an exact character filter to the location list", async () => {
    const repo = repository();
    const service = new LocationsService(
      repo as unknown as LocationsRepository,
    );

    await service.list({
      characterId: " character-1 ",
      scope: "all",
      limit: 20,
    });

    expect(repo.findMany).toHaveBeenCalledWith({
      characterId: "character-1",
      scope: "all",
      take: 21,
    });
  });

  it("rejects duplicate location keys within the same scope", async () => {
    const repo = repository();
    repo.create.mockRejectedValue(new DuplicateLocationKeyError("gym"));
    const service = new LocationsService(
      repo as unknown as LocationsRepository,
    );

    await expect(
      service.create({
        locationKey: "gym",
        displayName: "헬스장",
        description: "",
        visualPrompt: "",
      }),
    ).rejects.toThrow(ConflictException);
  });

  it("accepts only unique confirmed image references and preserves their order", async () => {
    const repo = repository();
    repo.findUploadedMedia.mockResolvedValue({
      id: "media-1",
      mediaType: "image",
      uploadedAt: now,
    });
    const service = new LocationsService(
      repo as unknown as LocationsRepository,
    );

    await service.setReferences("location-1", [
      { mediaId: "media-1", description: "  정면 전경  " },
    ]);

    expect(repo.replaceReferences).toHaveBeenCalledWith("location-1", [
      { mediaId: "media-1", description: "정면 전경" },
    ]);

    await expect(
      service.setReferences("location-1", [
        { mediaId: "media-1", description: "a" },
        { mediaId: "media-1", description: "b" },
      ]),
    ).rejects.toThrow(BadRequestException);
  });
});
