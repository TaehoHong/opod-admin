import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../src/core/database/database.service";
import {
  characters,
  media,
  characterVisualProfileReferences,
  characterLocationReferences,
} from "../src/core/database/schema";
import { VisualProfileRepository } from "../src/characters/visual-profile.repository";
import { VisualProfileService } from "../src/characters/visual-profile.service";
import { LocationsRepository } from "../src/locations/locations.repository";
import { LocationsService } from "../src/locations/locations.service";

const vector = (axis: number) =>
  Array.from({ length: 1024 }, (_, i) => (i === axis ? 1 : 0));
describe("scoped pgvector reference retrieval", () => {
  const db = new DatabaseService();
  const visual = new VisualProfileService(new VisualProfileRepository(db));
  const locations = new LocationsService(new LocationsRepository(db));
  const model = "fixture-retrieval";
  let ids: string[];
  let mediaIds: string[];
  let profileId: string;
  let locationId: string;
  let foreignLocationId: string;
  beforeAll(async () => {
    await db.pool.query("SET search_path = opod");
    expect((await db.pool.query("SHOW search_path")).rows[0].search_path).toBe(
      "opod",
    );
    ids = (
      await db.client
        .insert(characters)
        .values(
          [0, 1].map((i) => ({
            publicId: `retrieval-${randomUUID()}`,
            displayName: `Retrieval ${i}`,
            bio: "fixture",
          })),
        )
        .returning()
    ).map((r) => r.id);
    mediaIds = (
      await db.client
        .insert(media)
        .values(
          [0, 1, 2].map(() => ({
            mediaType: "image" as const,
            url: "https://fixture.test/image.png",
            uploadedAt: new Date(),
          })),
        )
        .returning()
    ).map((r) => r.id);
    await visual.setReferences({
      characterId: ids[0],
      mediaIds: mediaIds.slice(0, 2),
    });
    await visual.setReferences({
      characterId: ids[1],
      mediaIds: [mediaIds[2]],
    });
    for (let i = 0; i < 3; i++)
      await visual.updateReferenceDescription({
        characterId: ids[i === 2 ? 1 : 0],
        mediaId: mediaIds[i],
        description: `caption-${i}`,
      });
    const sources = await visual.listReferenceEmbeddingSources(ids[0]);
    profileId = sources[0].ownerId;
    const all = await visual.listReferenceEmbeddingSources();
    for (const source of all.filter((s) => mediaIds.includes(s.mediaId))) {
      await visual.saveReferenceEmbedding({
        ...source,
        embedding: vector(source.mediaId === mediaIds[1] ? 1 : 0),
        model,
      });
    }
    for (const owner of [0, 1]) {
      const location = await locations.create({
        characterId: ids[owner],
        locationKey: `retrieval-${randomUUID()}`,
        displayName: "Room",
        description: "Room",
        visualPrompt: "Room",
      });
      if (owner === 0) locationId = location.id;
      else foreignLocationId = location.id;
      await locations.setReferences(location.id, [
        { mediaId: mediaIds[0], description: "room caption" },
      ]);
      await locations.saveReferenceEmbedding({
        ownerId: location.id,
        mediaId: mediaIds[0],
        description: "room caption",
        embedding: vector(0),
        model,
      });
    }
  });
  afterAll(() => db.onModuleDestroy());

  it("changes rank with the query vector and excludes another character/model", async () => {
    const first = await visual.searchReferenceEmbeddings(
      ids[0],
      vector(0),
      model,
      20,
    );
    const second = await visual.searchReferenceEmbeddings(
      ids[0],
      vector(1),
      model,
      20,
    );
    expect(first.map((r) => r.id)).toEqual(mediaIds.slice(0, 2));
    expect(second.map((r) => r.id)).toEqual(mediaIds.slice(0, 2).reverse());
    expect(first[0].score).toBeCloseTo(1);
    expect(
      await visual.searchReferenceEmbeddings(
        ids[0],
        vector(0),
        "other-model",
        20,
      ),
    ).toEqual([]);
    expect(
      await locations.searchReferenceEmbeddings(
        ids[0],
        foreignLocationId,
        vector(0),
        model,
        4,
      ),
    ).toEqual([]);
    expect(
      await locations.searchReferenceEmbeddings(
        ids[0],
        locationId,
        vector(0),
        model,
        4,
      ),
    ).toHaveLength(1);
  });

  it("refuses stale caption writes for both domains and rejects malformed vectors", async () => {
    await visual.updateReferenceDescription({
      characterId: ids[0],
      mediaId: mediaIds[0],
      description: "changed",
    });
    expect(
      await visual.saveReferenceEmbedding({
        ownerId: profileId,
        mediaId: mediaIds[0],
        description: "caption-0",
        embedding: vector(0),
        model,
      }),
    ).toBe(false);
    await locations.setReferences(locationId, [
      { mediaId: mediaIds[0], description: "changed room" },
    ]);
    expect(
      await locations.saveReferenceEmbedding({
        ownerId: locationId,
        mediaId: mediaIds[0],
        description: "room caption",
        embedding: vector(0),
        model,
      }),
    ).toBe(false);
    expect(() =>
      visual.saveReferenceEmbedding({
        ownerId: profileId,
        mediaId: mediaIds[0],
        description: "changed",
        embedding: [1],
        model,
      }),
    ).toThrow();
    const [row] = await db.client
      .select()
      .from(characterVisualProfileReferences)
      .where(eq(characterVisualProfileReferences.mediaId, mediaIds[0]));
    expect(row.embedding).toBeNull();
    const [location] = await db.client
      .select()
      .from(characterLocationReferences)
      .where(eq(characterLocationReferences.locationId, locationId));
    expect(location.embedding).toBeNull();
  });

  it("excludes inactive and unuploaded references", async () => {
    await db.client
      .update(characterVisualProfileReferences)
      .set({ isActive: false })
      .where(eq(characterVisualProfileReferences.mediaId, mediaIds[1]));
    expect(
      await visual.searchReferenceEmbeddings(ids[0], vector(1), model, 20),
    ).toEqual([]);
    await db.client
      .update(media)
      .set({ uploadedAt: null })
      .where(eq(media.id, mediaIds[2]));
    expect(
      await visual.searchReferenceEmbeddings(ids[1], vector(0), model, 20),
    ).toEqual([]);
  });
});
