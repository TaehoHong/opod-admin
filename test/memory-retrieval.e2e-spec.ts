import { randomUUID, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../src/core/database/database.service";
import { DatabaseTransactionContext } from "../src/core/database/database-transaction-context";
import { characters, characterMemories } from "../src/core/database/schema";
import { CharacterRepository } from "../src/characters/character.repository";
import { CharacterService } from "../src/characters/character.service";

const vector = (axis: number) =>
  Array.from({ length: 1024 }, (_, i) => (i === axis ? 1 : 0));
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
describe("scoped Canon pgvector retrieval", () => {
  const db = new DatabaseService();
  const domain = new CharacterService(
    new CharacterRepository(db, new DatabaseTransactionContext()),
    {} as never,
  );
  const model = "fixture-memory-model";
  let ids: string[];
  let memories: string[];
  const sourceHashes: Record<string, string> = {};
  beforeAll(async () => {
    await db.pool.query("SET search_path = opod");
    ids = (
      await db.client
        .insert(characters)
        .values([
          {
            publicId: `memory-${randomUUID()}`,
            displayName: "Fixture A",
            bio: "",
          },
          {
            publicId: `memory-${randomUUID()}`,
            displayName: "Fixture B",
            bio: "",
          },
        ])
        .returning()
    ).map((row) => row.id);
    memories = (
      await db.client
        .insert(characterMemories)
        .values([
          {
            characterId: ids[0],
            content: "고정 단발 머리",
            reason: "fixture",
            kind: "fact",
            injection: "retrieved",
          },
          {
            characterId: ids[0],
            content: "어제 산책했다",
            reason: "fixture",
            kind: "event",
            injection: "retrieved",
          },
          {
            characterId: ids[1],
            content: "다른 캐릭터 사실",
            reason: "fixture",
            kind: "fact",
            injection: "retrieved",
          },
          {
            characterId: ids[0],
            content: "항상 전달 사실",
            reason: "fixture",
            kind: "fact",
            injection: "always",
          },
          {
            characterId: ids[0],
            content: "삭제된 사실",
            reason: "fixture",
            kind: "fact",
            injection: "retrieved",
            deletedAt: new Date(),
          },
        ])
        .returning()
    ).map((row) => row.id);
    const sourceA = await domain.listMemoryEmbeddingSources(ids[0]);
    const sourceB = await domain.listMemoryEmbeddingSources(ids[1]);
    for (const source of [...sourceA, ...sourceB])
      sourceHashes[source.id] = source.memorySha256;
    await domain.saveMemoryEmbedding({
      characterId: ids[0],
      memoryId: memories[0],
      memorySha256: sourceHashes[memories[0]],
      content: "고정 단발 머리",
      embedding: vector(0),
      model,
    });
    await domain.saveMemoryEmbedding({
      characterId: ids[0],
      memoryId: memories[1],
      memorySha256: sourceHashes[memories[1]],
      content: "어제 산책했다",
      embedding: vector(1),
      model,
    });
    await domain.saveMemoryEmbedding({
      characterId: ids[1],
      memoryId: memories[2],
      memorySha256: sourceHashes[memories[2]],
      content: "다른 캐릭터 사실",
      embedding: vector(0),
      model,
    });
    await domain.saveMemoryEmbedding({
      characterId: ids[0],
      memoryId: memories[3],
      memorySha256: sourceHashes[memories[3]],
      content: "항상 전달 사실",
      embedding: vector(0),
      model,
    });
    await db.client
      .update(characterMemories)
      .set({
        embedding: vector(0),
        embeddingModel: model,
        embeddingSourceSha256: hash("삭제된 사실"),
        embeddedAt: new Date(),
      })
      .where(eq(characterMemories.id, memories[4]));
  });
  afterAll(() => db.onModuleDestroy());
  it("changes rank by query and excludes foreign, deleted and authored-always memories", async () => {
    const first = await domain.searchMemoryEmbeddings(ids[0], vector(0), model);
    const second = await domain.searchMemoryEmbeddings(
      ids[0],
      vector(1),
      model,
    );
    expect(first.map((row) => row.id)).toEqual(memories.slice(0, 2));
    expect(second.map((row) => row.id)).toEqual(memories.slice(0, 2).reverse());
    expect(first[0].score).toBeCloseTo(1);
    expect(first[0].sourceSha256).toBe(hash("고정 단발 머리"));
    expect(
      await domain.searchMemoryEmbeddings(ids[0], vector(0), "other-model"),
    ).toEqual([]);
  });
  it("uses only authored facts for fixed visual identity search", async () => {
    expect(
      (await domain.searchMemoryEmbeddings(ids[0], vector(1), model, true)).map(
        (row) => row.id,
      ),
    ).toEqual([memories[0]]);
  });
  it("excludes stale content hashes and refuses to save an old document after a change", async () => {
    await db.client
      .update(characterMemories)
      .set({ content: "변경된 머리" })
      .where(eq(characterMemories.id, memories[0]));
    const sources = await domain.listMemoryEmbeddingSources(ids[0]);
    expect(sources.find((row) => row.id === memories[0])).toMatchObject({
      sourceSha256: hash("변경된 머리"),
      embeddedTextSha256: hash("고정 단발 머리"),
    });
    expect(
      (await domain.searchMemoryEmbeddings(ids[0], vector(0), model)).map(
        (row) => row.id,
      ),
    ).toEqual([memories[1]]);
    expect(
      await domain.saveMemoryEmbedding({
        characterId: ids[0],
        memoryId: memories[0],
        memorySha256: sourceHashes[memories[0]],
        content: "고정 단발 머리",
        embedding: vector(0),
        model,
      }),
    ).toBe(false);
    const [row] = await db.client
      .select()
      .from(characterMemories)
      .where(eq(characterMemories.id, memories[0]));
    expect(row.content).toBe("변경된 머리");
    expect(row.embeddingSourceSha256).toBe(hash("고정 단발 머리"));
  });
  it("rejects malformed vectors and wrong owner/deleted writes", async () => {
    expect(() =>
      domain.saveMemoryEmbedding({
        characterId: ids[0],
        memoryId: memories[1],
        memorySha256: sourceHashes[memories[1]],
        content: "어제 산책했다",
        embedding: [1],
        model,
      }),
    ).toThrow();
    expect(
      await domain.saveMemoryEmbedding({
        characterId: ids[1],
        memoryId: memories[1],
        memorySha256: sourceHashes[memories[1]],
        content: "어제 산책했다",
        embedding: vector(0),
        model,
      }),
    ).toBe(false);
    expect(
      await domain.saveMemoryEmbedding({
        characterId: ids[0],
        memoryId: memories[4],
        memorySha256: sourceHashes[memories[4]],
        content: "삭제된 사실",
        embedding: vector(0),
        model,
      }),
    ).toBe(false);
  });
  it("refuses a maintenance write when routing changes but document text still matches", async () => {
    const [before] = await db.client
      .select()
      .from(characterMemories)
      .where(eq(characterMemories.id, memories[1]));
    await db.client
      .update(characterMemories)
      .set({ recallKeys: ["new authored keyword"] })
      .where(eq(characterMemories.id, memories[1]));
    expect(
      await domain.saveMemoryEmbedding({
        characterId: ids[0],
        memoryId: memories[1],
        memorySha256: sourceHashes[memories[1]],
        content: "어제 산책했다",
        embedding: vector(0),
        model,
      }),
    ).toBe(false);
    const [after] = await db.client
      .select()
      .from(characterMemories)
      .where(eq(characterMemories.id, memories[1]));
    expect(after.embedding).toEqual(before.embedding);
    expect(after.embeddedAt).toEqual(before.embeddedAt);
    expect(after.recallKeys).toEqual(["new authored keyword"]);
  });
});
