import { VisualProfileRepository } from "./visual-profile.repository";

describe("VisualProfileRepository", () => {
  it("deactivates deselected references without deleting their metadata", async () => {
    const references = {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn(),
    };
    const tx = {
      characterVisualProfile: {
        upsert: jest.fn().mockResolvedValue({ id: "profile-1" }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({}),
      },
      characterVisualProfileReference: references,
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    };
    const repository = new VisualProfileRepository(prisma as never);

    await repository.replaceReferences("character-1", ["media-1"]);

    expect(references.updateMany).toHaveBeenCalledWith({
      where: {
        profileId: "profile-1",
        isActive: true,
        mediaId: { notIn: ["media-1"] },
      },
      data: { isActive: false },
    });
    expect(references.upsert).toHaveBeenCalledWith({
      where: {
        profileId_mediaId: { profileId: "profile-1", mediaId: "media-1" },
      },
      create: {
        profileId: "profile-1",
        mediaId: "media-1",
        sortOrder: 10,
        isActive: true,
      },
      update: { sortOrder: 10, isActive: true },
    });
    expect(references.deleteMany).not.toHaveBeenCalled();
  });

  it("deactivates every active reference when the active set is empty", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const tx = {
      characterVisualProfile: {
        upsert: jest.fn().mockResolvedValue({ id: "profile-1" }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({}),
      },
      characterVisualProfileReference: {
        updateMany,
        upsert: jest.fn(),
      },
    };
    const repository = new VisualProfileRepository({
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    } as never);

    await repository.replaceReferences("character-1", []);

    expect(updateMany).toHaveBeenCalledWith({
      where: { profileId: "profile-1", isActive: true },
      data: { isActive: false },
    });
    expect(tx.characterVisualProfileReference.upsert).not.toHaveBeenCalled();
  });

  it("only captions active uploaded references", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = new VisualProfileRepository({
      characterVisualProfileReference: { findMany },
    } as never);

    await repository.findUncaptionedReferences("character-1");

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
      }),
    );
  });
});
