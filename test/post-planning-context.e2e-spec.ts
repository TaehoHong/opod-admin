import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/domain/database/database.service";
import {
  characters,
  characterPersonas,
  characterPersonaFragments,
  characterPersonaCanonLinks,
  characterMemories,
  postDrafts,
} from "../src/domain/database/schema";
import { DraftWorkerRepository } from "../src/worker/draft-worker.repository";
import { projectPostPersonaContext } from "../src/worker/post-persona-context";

describe("post planning persisted context", () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });

  it("loads roles, old relevant Canon and source links while isolating deleted and foreign records", async () => {
    const db = app.get(DatabaseService).client;
    const characterId = randomUUID();
    const foreignId = randomUUID();
    await db.insert(characters).values(
      [characterId, foreignId].map((id) => ({
        id,
        publicId: `planning-${id}`,
        displayName: "Synthetic",
        bio: "꽃집에서 일한다.",
      })),
    );
    const personaId = randomUUID();
    const identityId = randomUUID();
    const linkedId = randomUUID();
    await db.insert(characterPersonas).values({
      id: personaId,
      characterId,
      schemaVersion: 2,
      title: "인물 설정",
      content: "꽃집에서 일한다.옮겨진 비공개 원문.",
    });
    await db.insert(characterPersonaFragments).values([
      {
        id: identityId,
        personaId,
        ordinal: 0,
        content: "꽃집에서 일한다.",
        kind: "identity",
        injection: "always",
      },
      {
        id: linkedId,
        personaId,
        ordinal: 1,
        content: "옮겨진 비공개 원문.",
        kind: "relationship",
        injection: "never_prompt",
      },
    ]);
    const deletedSourceId = randomUUID();
    await db.insert(characterPersonas).values({
      id: deletedSourceId,
      characterId,
      title: "deleted",
      content: "삭제된 설정",
      deletedAt: new Date(),
    });
    const canonId = randomUUID();
    const deletedCanonId = randomUUID();
    const foreignCanonId = randomUUID();
    await db.insert(characterMemories).values([
      {
        id: canonId,
        characterId,
        content: "강릉에서 엄마를 만났다.",
        type: "event",
        reason: "fixture",
        kind: "event",
        injection: "retrieved",
        recallKeys: ["강릉"],
        occurredAt: new Date("2026-08-01T00:00:00Z"),
        createdAt: new Date("2026-08-01T00:00:00Z"),
      },
      {
        id: deletedCanonId,
        characterId,
        content: "삭제된 강릉 기억",
        type: "event",
        reason: "fixture",
        deletedAt: new Date(),
      },
      {
        id: foreignCanonId,
        characterId: foreignId,
        content: "다른 캐릭터의 강릉 기억",
        type: "event",
        reason: "fixture",
      },
      ...Array.from({ length: 21 }, (_, i) => ({
        characterId,
        content: `unrelated ${i}`,
        type: "event",
        reason: "fixture",
        kind: "event",
        injection: "retrieved",
        recallKeys: ["등산"],
      })),
    ]);
    // Even invalid links written outside the authoring service must not cross characters.
    await db.insert(characterPersonaCanonLinks).values(
      [canonId, deletedCanonId, foreignCanonId].map((memoryId) => ({
        fragmentId: linkedId,
        memoryId,
      })),
    );
    const draftId = randomUUID();
    await db.insert(postDrafts).values({
      id: draftId,
      characterId,
      conceptJson: { pipelineVersion: "post-pipeline-v4" },
    });

    const draft = await app
      .get(DraftWorkerRepository)
      .findPlannedDraft(draftId);
    expect(draft).not.toBeNull();
    const context = projectPostPersonaContext({
      ...draft!.character,
      query: "강릉에 간 날",
    });
    if (context.status !== "ready")
      throw new Error("stored context was invalid");
    expect(context.personas).toEqual([
      expect.objectContaining({
        sourceId: personaId,
        fragmentId: identityId,
        schemaVersion: 2,
        kind: "identity",
        injection: "always",
      }),
    ]);
    expect(context.memories).toEqual([
      expect.objectContaining({
        sourceId: canonId,
        occurredAt: "2026-08-01T00:00:00.000Z",
        personaSources: [{ sourceId: personaId, fragmentId: linkedId }],
      }),
    ]);
    expect(
      draft!.character.personas[0].fragments?.find(
        (fragment) => fragment.id === linkedId,
      )?.canonIds,
    ).toEqual([canonId]);
    expect(JSON.stringify(context)).not.toContain("비공개 원문");
    expect(JSON.stringify(context)).not.toContain("삭제된");
    expect(JSON.stringify(context)).not.toContain("다른 캐릭터");
  });
});
