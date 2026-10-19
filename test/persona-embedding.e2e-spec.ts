import { randomUUID } from "node:crypto";
import { DatabaseService } from "../src/core/database/database.service";
import { DatabaseTransactionContext } from "../src/core/database/database-transaction-context";
import { CharacterService } from "../src/characters/character.service";
import { CharacterRepository } from "../src/characters/character.repository";
import { CharacterActionLogService } from "../src/characters/character-action-log.service";
import { CharacterActionLogRepository } from "../src/characters/character-action-log.repository";

describe("persona fragment embedding maintenance", () => {
  const db = new DatabaseService();
  const tx = new DatabaseTransactionContext();
  const domain = new CharacterService(
    new CharacterRepository(db, tx),
    new CharacterActionLogService(new CharacterActionLogRepository(db, tx)),
  );
  const embedding = Array.from({ length: 1024 }, (_, i) => +(i === 0));
  let characterId: string;
  let foreignId: string;
  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const c = await domain.createCharacter({
        publicId: `persona-index-${randomUUID()}`,
        displayName: "Fixture",
        bio: "",
      });
      if (i === 0) characterId = c.id;
      else foreignId = c.id;
    }
  });
  afterAll(() => db.onModuleDestroy());
  it("indexes current retrieved text and rejects foreign, stale, replaced and hidden fragments", async () => {
    const p = await domain.createCharacterPersona({
      characterId,
      title: "world",
      content: "고향은 인천이다.",
    });
    let source = await domain.getPersonaStructure(characterId, p.id);
    const fragments = [
      {
        content: p.content,
        kind: "identity",
        injection: "retrieved",
        recallKeys: ["고향"],
      },
    ];
    source = await domain.putPersonaStructure(characterId, p.id, {
      schemaVersion: 2,
      sourceSha256: source.sourceSha256,
      structureSha256: source.structureSha256,
      fragments,
    });
    const [row] = await domain.listPersonaEmbeddingSources(characterId);
    expect(row.indexed).toBe(false);
    expect(await domain.listPersonaEmbeddingSources(foreignId)).toEqual([]);
    const write = {
      characterId,
      personaId: p.id,
      fragmentId: row.id,
      content: p.content,
      embedding,
      model: "fixture",
    };
    expect(
      await domain.savePersonaEmbedding({ ...write, characterId: foreignId }),
    ).toBe(false);
    expect(
      await domain.savePersonaEmbedding({ ...write, content: "옛 본문" }),
    ).toBe(false);
    expect(await domain.savePersonaEmbedding(write)).toBe(true);
    const [indexed] = await domain.listPersonaEmbeddingSources(characterId);
    expect(indexed.indexed).toBe(true);
    expect(indexed.embeddedTextSha256).toBe(indexed.sourceSha256);
    source = await domain.putPersonaStructure(characterId, p.id, {
      schemaVersion: 2,
      sourceSha256: source.sourceSha256,
      structureSha256: source.structureSha256,
      fragments,
    });
    expect(await domain.savePersonaEmbedding(write)).toBe(false);
    const current = { ...write, fragmentId: source.fragments[0].id };
    expect(await domain.savePersonaEmbedding(current)).toBe(true);
    source = await domain.putPersonaStructure(characterId, p.id, {
      schemaVersion: 2,
      sourceSha256: source.sourceSha256,
      structureSha256: source.structureSha256,
      fragments: [{ ...fragments[0], injection: "never_prompt" }],
    });
    expect(await domain.listPersonaEmbeddingSources(characterId)).toEqual([]);
    expect(
      await domain.savePersonaEmbedding({
        ...write,
        fragmentId: source.fragments[0].id,
      }),
    ).toBe(false);
  });
  it("rejects malformed vectors before writing", () => {
    expect(() =>
      domain.savePersonaEmbedding({
        characterId,
        personaId: randomUUID(),
        fragmentId: randomUUID(),
        content: "text",
        model: "fixture",
        embedding: [1],
      }),
    ).toThrow("1024");
  });
});
