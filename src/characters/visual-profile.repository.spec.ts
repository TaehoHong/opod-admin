import { createDrizzleMock } from "../../test/drizzle-mock";
import { VisualProfileRepository } from "./visual-profile.repository";

describe("VisualProfileRepository", () => {
  it("비활성화와 레퍼런스 upsert를 한 트랜잭션에서 수행한다", async () => {
    const mock = createDrizzleMock([
      [{ id: "profile-1" }],
      [],
      [],
      [
        {
          id: "profile-1",
          characterId: "character-1",
          appearancePrompt: "",
          stylePrompt: "",
          negativePrompt: "",
          providerConfig: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [],
    ]);
    const repository = new VisualProfileRepository(mock.database as never);

    await repository.replaceReferences("character-1", ["media-1"]);

    expect(mock.client.transaction).toHaveBeenCalledTimes(1);
    expect(mock.operations.map((operation) => operation.kind)).toEqual([
      "insert",
      "update",
      "insert",
      "select",
      "select",
    ]);
    expect(mock.operations[2].values).toMatchObject({
      profileId: "profile-1",
      mediaId: "media-1",
      sortOrder: 10,
      isActive: true,
    });
  });

  it("활성·업로드 완료·미캡션 레퍼런스만 조회한다", async () => {
    const rows = [
      {
        profileId: "profile-1",
        mediaId: "media-1",
        media: {
          url: "https://example.com/a.jpg",
          storageKey: null,
          contentType: "image/jpeg",
        },
      },
    ];
    const mock = createDrizzleMock([rows]);
    const repository = new VisualProfileRepository(mock.database as never);

    await expect(
      repository.findUncaptionedReferences("character-1"),
    ).resolves.toEqual(rows);
  });
});
