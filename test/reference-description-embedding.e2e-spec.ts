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

describe("reference description embedding freshness", () => {
  const database = new DatabaseService();
  const visual = new VisualProfileService(
    new VisualProfileRepository(database),
  );
  const locations = new LocationsService(new LocationsRepository(database));
  const embedding = Array.from({ length: 1024 }, (_, index) =>
    index === 0 ? 1 : 0,
  );
  const indexed = {
    embedding,
    embeddingModel: "test-embedding",
    embeddedAt: new Date("2026-01-01"),
  };
  let characterId: string;
  let mediaId: string;

  beforeAll(async () => {
    [characterId, mediaId] = await Promise.all([
      database.client
        .insert(characters)
        .values({
          publicId: `embedding-${randomUUID()}`,
          displayName: "Reference test",
          bio: "test",
        })
        .returning()
        .then(([row]) => row.id),
      database.client
        .insert(media)
        .values({
          mediaType: "image",
          url: "https://example.test/reference.jpg",
          uploadedAt: new Date(),
        })
        .returning()
        .then(([row]) => row.id),
    ]);
  });
  afterAll(async () => {
    await database.onModuleDestroy();
  });

  it("keeps an identity embedding for identical text and clears it when the description changes", async () => {
    await visual.setReferences({ characterId, mediaIds: [mediaId] });
    await visual.updateReferenceDescription({
      characterId,
      mediaId,
      description: "front view",
    });
    await database.client
      .update(characterVisualProfileReferences)
      .set(indexed)
      .where(eq(characterVisualProfileReferences.mediaId, mediaId));
    await visual.updateReferenceDescription({
      characterId,
      mediaId,
      description: "front view",
    });
    const [unchanged] = await database.client
      .select()
      .from(characterVisualProfileReferences)
      .where(eq(characterVisualProfileReferences.mediaId, mediaId));
    expect(unchanged).toMatchObject(indexed);
    await visual.updateReferenceDescription({
      characterId,
      mediaId,
      description: "rear view",
    });
    const [changed] = await database.client
      .select()
      .from(characterVisualProfileReferences)
      .where(eq(characterVisualProfileReferences.mediaId, mediaId));
    expect(changed).toMatchObject({
      description: "rear view",
      embedding: null,
      embeddingModel: null,
      embeddedAt: null,
    });
  });

  it("keeps a location embedding for identical text and clears it when the description changes", async () => {
    const location = await locations.create({
      characterId,
      locationKey: `embedding-${randomUUID()}`,
      displayName: "Room",
      description: "test",
      visualPrompt: "test",
    });
    await locations.setReferences(location.id, [
      { mediaId, description: "front view" },
    ]);
    await database.client
      .update(characterLocationReferences)
      .set(indexed)
      .where(eq(characterLocationReferences.locationId, location.id));
    await locations.setReferences(location.id, [
      { mediaId, description: "front view" },
    ]);
    const [unchanged] = await database.client
      .select()
      .from(characterLocationReferences)
      .where(eq(characterLocationReferences.locationId, location.id));
    expect(unchanged).toMatchObject(indexed);
    await locations.setReferences(location.id, [
      { mediaId, description: "rear view" },
    ]);
    const [changed] = await database.client
      .select()
      .from(characterLocationReferences)
      .where(eq(characterLocationReferences.locationId, location.id));
    expect(changed).toMatchObject({
      description: "rear view",
      embedding: null,
      embeddingModel: null,
      embeddedAt: null,
    });
  });
});
