import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHash, randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/domain/database/database.service";
import { CharacterRepository } from "../src/characters/character.repository";
import { adminHeaders } from "./admin-auth";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

describe("persisted character context", () => {
  let app: INestApplication;
  let headers: Awaited<ReturnType<typeof adminHeaders>>;
  let characterId: string;
  let foreignId: string;
  let personaId: string;
  const content = "차분하게 반응한다.\n지난 여행 이야기.";
  const fragments = [
    {
      content: "차분하게 반응한다.\n",
      kind: "behavior",
      injection: "always",
      recallKeys: [],
    },
    {
      content: "지난 여행 이야기.",
      kind: "lore",
      injection: "retrieved",
      recallKeys: ["여행"],
    },
  ];
  const path = () =>
    `/api/admin/v1/characters/${characterId}/personas/${personaId}/structure`;

  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    headers = await adminHeaders(app);
    for (let i = 0; i < 2; i++) {
      const response = await request(app.getHttpServer())
        .post("/api/admin/v1/characters")
        .set(headers)
        .send({
          publicId: `context-${randomUUID().slice(0, 8)}`,
          displayName: "Synthetic",
          bio: "Synthetic biography",
          interests: [],
        })
        .expect(201);
      if (i === 0) characterId = response.body.id;
      else foreignId = response.body.id;
    }
  });
  beforeEach(async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/admin/v1/characters/${characterId}/personas`)
      .set(headers)
      .send({ title: "Mixed source", content })
      .expect(201);
    personaId = response.body.id;
  });
  afterAll(async () => {
    await app?.close();
  });

  it("saves lossless fragments and rereads them after a new app connection", async () => {
    await request(app.getHttpServer())
      .put(path())
      .set(headers)
      .send({ sourceSha256: hash(content), fragments })
      .expect(200)
      .expect((res) =>
        expect(res.body.fragments).toEqual(
          fragments.map((f, ordinal) =>
            expect.objectContaining({ ...f, ordinal }),
          ),
        ),
      );
    await app.close();
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    headers = await adminHeaders(app);
    await request(app.getHttpServer())
      .get(path())
      .set(headers)
      .expect(200)
      .expect((res) => {
        expect(res.body.content).toBe(content);
        expect(res.body.sourceSha256).toBe(hash(content));
        expect(
          res.body.fragments
            .map((f: { content: string }) => f.content)
            .join(""),
        ).toBe(content);
      });
  });

  it("saves v2 persona facets and rejects legacy or unsafe v2 policies", async () => {
    const v2Fragments = [
      {
        content: fragments[0].content,
        kind: "motivation",
        injection: "always",
        recallKeys: [],
      },
      {
        content: fragments[1].content,
        kind: "tension",
        injection: "retrieved",
        recallKeys: ["여행"],
      },
    ];
    await request(app.getHttpServer())
      .put(path())
      .set(headers)
      .send({ sourceSha256: hash(content), fragments: v2Fragments })
      .expect(400);
    const saved = await request(app.getHttpServer())
      .put(path())
      .set(headers)
      .send({
        schemaVersion: 2,
        sourceSha256: hash(content),
        fragments: v2Fragments,
      })
      .expect(200);
    expect(saved.body).toMatchObject({ schemaVersion: 2 });
    expect(saved.body.fragments).toEqual(
      v2Fragments.map((fragment, ordinal) =>
        expect.objectContaining({ ...fragment, ordinal }),
      ),
    );

    for (const invalidFragments of [
      [{ ...v2Fragments[0], kind: "behavior" }, v2Fragments[1]],
      [
        {
          ...v2Fragments[0],
          kind: "creator_note",
          injection: "always",
        },
        v2Fragments[1],
      ],
      [
        { ...v2Fragments[0], kind: "greeting", injection: "retrieved" },
        v2Fragments[1],
      ],
    ]) {
      await request(app.getHttpServer())
        .put(path())
        .set(headers)
        .send({
          schemaVersion: 2,
          sourceSha256: hash(content),
          structureSha256: saved.body.structureSha256,
          fragments: invalidFragments,
        })
        .expect(400);
    }

    await request(app.getHttpServer())
      .get(path())
      .set(headers)
      .expect(200)
      .expect((res) => {
        expect(res.body.schemaVersion).toBe(2);
        expect(res.body.fragments).toEqual(saved.body.fragments);
      });
  });

  it("updates source and fragments atomically and rejects stale or legacy source-only edits", async () => {
    await request(app.getHttpServer())
      .put(path())
      .set(headers)
      .send({ sourceSha256: hash(content), fragments })
      .expect(200);
    await request(app.getHttpServer())
      .patch(path().replace("/structure", ""))
      .set(headers)
      .send({ content: "unsafe edit" })
      .expect(409);
    const next = "다른 반응.";
    const nextFragments = [
      { content: next, kind: "behavior", injection: "always", recallKeys: [] },
    ];
    await request(app.getHttpServer())
      .put(path())
      .set(headers)
      .send({
        sourceSha256: hash(content),
        content: next,
        fragments: nextFragments,
      })
      .expect(200);
    await request(app.getHttpServer())
      .put(path())
      .set(headers)
      .send({ sourceSha256: hash(content), content, fragments })
      .expect(409);
    await request(app.getHttpServer())
      .get(path())
      .set(headers)
      .expect(200)
      .expect((res) => expect(res.body.content).toBe(next));
  });

  it("rejects lossy splits, invalid policy, missing auth, and another character's source", async () => {
    await request(app.getHttpServer())
      .get(path().replace(personaId, "bad-id"))
      .set(headers)
      .expect(400);
    await request(app.getHttpServer())
      .put(path())
      .send({ sourceSha256: hash(content), fragments })
      .expect(403);
    await request(app.getHttpServer())
      .put(path().replace(characterId, foreignId))
      .set(headers)
      .send({ sourceSha256: hash(content), fragments })
      .expect(400);
    await request(app.getHttpServer())
      .put(path())
      .set(headers)
      .send({ sourceSha256: hash(content), fragments: [fragments[0]] })
      .expect(400);
    await request(app.getHttpServer())
      .put(path())
      .set(headers)
      .send({
        sourceSha256: hash(content),
        fragments: [{ ...fragments[0], kind: "made-up" }, fragments[1]],
      })
      .expect(400);
    await request(app.getHttpServer())
      .get(path())
      .set(headers)
      .expect(200)
      .expect((res) => {
        expect(res.body.content).toBe(content);
        expect(res.body.fragments).toEqual([]);
      });
  });

  it("allows only one competing source edit and rolls back a failed fragment replacement", async () => {
    const responses = await Promise.all(
      ["first edit", "second edit"].map((next) =>
        request(app.getHttpServer())
          .put(path())
          .set(headers)
          .send({
            sourceSha256: hash(content),
            content: next,
            fragments: [
              {
                content: next,
                kind: "behavior",
                injection: "always",
                recallKeys: [],
              },
            ],
          }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = responses.find((r) => r.status === 200)!.body;
    // Force a DB constraint failure after old fragments have been deleted in the transaction.
    await expect(
      app.get(CharacterRepository).replacePersonaStructure({
        characterId,
        personaId,
        sourceSha256: winner.sourceSha256,
        content: "invalid replacement",
        fragments: [
          {
            content: "invalid replacement",
            kind: "invalid-kind",
            injection: "always",
            recallKeys: [],
          },
        ],
      }),
    ).rejects.toThrow();
    await request(app.getHttpServer())
      .get(path())
      .set(headers)
      .expect(200)
      .expect((res) => {
        expect(res.body.content).toBe(winner.content);
        expect(res.body.fragments).toEqual(winner.fragments);
      });
  });

  it("persists canon routing, excludes foreign access, and rejects always-injected events in API and DB", async () => {
    const memory = await request(app.getHttpServer())
      .post(`/api/admin/v1/characters/${characterId}/memory`)
      .set(headers)
      .send({ content: "지난 여행", type: "event", reason: "authored" })
      .expect(201);
    const routing = `/api/admin/v1/characters/${characterId}/memory/${memory.body.id}/routing`;
    await request(app.getHttpServer())
      .put(routing)
      .set(headers)
      .send({ kind: "event", injection: "always", recallKeys: [] })
      .expect(400);
    await request(app.getHttpServer())
      .put(routing.replace(characterId, foreignId))
      .set(headers)
      .send({ kind: "event", injection: "retrieved", recallKeys: ["여행"] })
      .expect(400);
    await request(app.getHttpServer())
      .put(routing)
      .set(headers)
      .send({ kind: "event", injection: "retrieved", recallKeys: ["여행"] })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/admin/v1/characters/${characterId}/memory`)
      .set(headers)
      .expect(200)
      .expect((res) =>
        expect(
          res.body.items.find((m: { id: string }) => m.id === memory.body.id),
        ).toMatchObject({
          kind: "event",
          injection: "retrieved",
          recallKeys: ["여행"],
        }),
      );
    const pool = app.get(DatabaseService).pool;
    await expect(
      pool.query(
        "UPDATE opod.character_canon_memories SET context_injection_mode = 'always' WHERE id = $1",
        [memory.body.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("invalidates a canon index only when its content changes", async () => {
    const memory = await request(app.getHttpServer())
      .post(`/api/admin/v1/characters/${characterId}/memory`)
      .set(headers)
      .send({ content: "지난 여행", type: "event", reason: "authored" })
      .expect(201);
    const memoryPath = `/api/admin/v1/characters/${characterId}/memory/${memory.body.id}`;
    const pool = app.get(DatabaseService).pool;
    const vector = `[${Array.from({ length: 1024 }, () => 0.5).join(",")}]`;
    await pool.query(
      `UPDATE opod.character_canon_memories
       SET canon_embedding = $2::vector, embedding_model = 'synthetic-test',
           embedded_text_sha256 = $3, embedding_generated_at = '2026-09-01T00:00:00Z'
       WHERE id = $1`,
      [memory.body.id, vector, hash("지난 여행")],
    );
    const readIndex = async () =>
      (
        await pool.query(
          `SELECT canon_embedding::text AS embedding, embedding_model,
                  embedded_text_sha256 AS embedding_source_sha256,
                  embedding_generated_at AS embedded_at
           FROM opod.character_canon_memories WHERE id = $1`,
          [memory.body.id],
        )
      ).rows[0];
    const initialIndex = await readIndex();
    await request(app.getHttpServer())
      .put(`${memoryPath}/routing`)
      .set(headers)
      .send({ kind: "event", injection: "retrieved", recallKeys: ["여행"] })
      .expect(200);
    expect(await readIndex()).toEqual(initialIndex);
    await request(app.getHttpServer())
      .patch(memoryPath)
      .set(headers)
      .send({ content: "지난 여행", reason: "revised attribution" })
      .expect(200);
    expect(await readIndex()).toEqual(initialIndex);
    await request(app.getHttpServer())
      .patch(memoryPath)
      .set(headers)
      .send({ content: "다른 여행" })
      .expect(200)
      .expect((res) => {
        expect(res.body.content).toBe("다른 여행");
        expect(res.body).not.toHaveProperty("embedding");
        expect(res.body).not.toHaveProperty("embeddingSourceSha256");
      });
    expect(await readIndex()).toEqual({
      embedding: null,
      embedding_model: null,
      embedding_source_sha256: null,
      embedded_at: null,
    });
  });

  it("keeps fragment indexes private and prevents stale writers from indexing replaced content", async () => {
    const saved = await request(app.getHttpServer())
      .put(path())
      .set(headers)
      .send({ sourceSha256: hash(content), fragments })
      .expect(200);
    const pool = app.get(DatabaseService).pool;
    const fragmentId = saved.body.fragments[1].id;
    const vector = `[${Array.from({ length: 1024 }, () => 0.5).join(",")}]`;
    await pool.query(
      `UPDATE opod.character_persona_fragments
       SET embedding = $2::vector, embedding_model = 'synthetic-test',
           embedding_source_sha256 = $3, embedded_at = '2026-09-01T00:00:00Z'
       WHERE id = $1`,
      [fragmentId, vector, hash(fragments[1].content)],
    );
    const assertPrivate = (body: { fragments: Record<string, unknown>[] }) => {
      for (const fragment of body.fragments) {
        for (const field of [
          "embedding",
          "embeddingModel",
          "embeddingSourceSha256",
          "embeddedAt",
        ]) {
          expect(fragment).not.toHaveProperty(field);
        }
      }
    };
    assertPrivate(saved.body);
    await request(app.getHttpServer())
      .get(path())
      .set(headers)
      .expect(200)
      .expect((res) => assertPrivate(res.body));
    await request(app.getHttpServer())
      .put(path())
      .set(headers)
      .send({ sourceSha256: hash("stale source"), fragments })
      .expect(409);
    expect(
      (
        await pool.query(
          "SELECT embedding_model FROM opod.character_persona_fragments WHERE id = $1",
          [fragmentId],
        )
      ).rows[0].embedding_model,
    ).toBe("synthetic-test");
    const next = "새로운 여행 이야기.";
    await request(app.getHttpServer())
      .put(path())
      .set(headers)
      .send({
        sourceSha256: hash(content),
        content: next,
        fragments: [{ ...fragments[1], content: next }],
      })
      .expect(200)
      .expect((res) => assertPrivate(res.body));
    const replaced = await pool.query(
      `SELECT id, content, embedding, embedding_model, embedding_source_sha256, embedded_at
       FROM opod.character_persona_fragments WHERE persona_id = $1`,
      [personaId],
    );
    expect(replaced.rows).toEqual([
      {
        id: expect.any(String),
        content: next,
        embedding: null,
        embedding_model: null,
        embedding_source_sha256: null,
        embedded_at: null,
      },
    ]);
    expect(replaced.rows[0].id).not.toBe(fragmentId);
    expect(
      (
        await pool.query(
          "UPDATE opod.character_persona_fragments SET embedding = $2::vector WHERE id = $1",
          [fragmentId, vector],
        )
      ).rowCount,
    ).toBe(0);
  });

  it("links canon with CAS and rejects unsafe links and linked legacy writes", async () => {
    const own = await request(app.getHttpServer())
      .post(`/api/admin/v1/characters/${characterId}/memory`)
      .set(headers)
      .send({ content: "지난 여행", type: "event", reason: "authored" })
      .expect(201);
    const foreign = await request(app.getHttpServer())
      .post(`/api/admin/v1/characters/${foreignId}/memory`)
      .set(headers)
      .send({ content: "foreign", type: "fact", reason: "authored" })
      .expect(201);
    const initial = await request(app.getHttpServer())
      .put(path())
      .set(headers)
      .send({ sourceSha256: hash(content), fragments })
      .expect(200);
    await request(app.getHttpServer())
      .put(path())
      .set(headers)
      .send({
        sourceSha256: hash(content),
        structureSha256: initial.body.structureSha256,
        fragments: [fragments[0], { ...fragments[1], canonIds: [own.body.id] }],
      })
      .expect(400);
    await request(app.getHttpServer())
      .put(path())
      .set(headers)
      .send({
        sourceSha256: hash(content),
        structureSha256: initial.body.structureSha256,
        fragments: [
          fragments[0],
          {
            ...fragments[1],
            injection: "never_prompt",
            canonIds: [foreign.body.id],
          },
        ],
      })
      .expect(400);
    const linked = await request(app.getHttpServer())
      .put(path())
      .set(headers)
      .send({
        sourceSha256: hash(content),
        structureSha256: initial.body.structureSha256,
        fragments: [
          fragments[0],
          {
            ...fragments[1],
            injection: "never_prompt",
            canonIds: [own.body.id, own.body.id],
          },
        ],
      })
      .expect(200);
    expect(linked.body.fragments[1].canonIds).toEqual([own.body.id]);
    await request(app.getHttpServer())
      .put(path())
      .set(headers)
      .send({
        sourceSha256: hash(content),
        structureSha256: initial.body.structureSha256,
        fragments,
      })
      .expect(409);
    const memoryPath = `/api/admin/v1/characters/${characterId}/memory/${own.body.id}`;
    await request(app.getHttpServer())
      .patch(memoryPath)
      .set(headers)
      .send({ content: "changed" })
      .expect(409);
    await request(app.getHttpServer())
      .put(`${memoryPath}/routing`)
      .set(headers)
      .send({ kind: "event", injection: "retrieved", recallKeys: [] })
      .expect(409);
    await request(app.getHttpServer())
      .delete(memoryPath)
      .set(headers)
      .expect(409);
    await request(app.getHttpServer())
      .delete(path().replace("/structure", ""))
      .set(headers)
      .expect(409);
  });

  it("rejects unverifiable provenance and invalid event time without partial writes", async () => {
    const memory = await request(app.getHttpServer())
      .post(`/api/admin/v1/characters/${characterId}/memory`)
      .set(headers)
      .send({ content: "fact", type: "fact", reason: "authored" })
      .expect(201);
    const foreignPersona = await request(app.getHttpServer())
      .post(`/api/admin/v1/characters/${foreignId}/personas`)
      .set(headers)
      .send({ title: "foreign source", content: "차분" })
      .expect(201);
    const memoryPath = `/api/admin/v1/characters/${characterId}/memory/${memory.body.id}`;
    await request(app.getHttpServer())
      .patch(memoryPath)
      .set(headers)
      .send({ occurredPrecision: "day", occurredLabel: "2025-02-30" })
      .expect(400);
    await request(app.getHttpServer())
      .patch(memoryPath)
      .set(headers)
      .send({ occurredPrecision: "day", occurredLabel: "2026-99-01" })
      .expect(400);
    await request(app.getHttpServer())
      .patch(memoryPath)
      .set(headers)
      .send({ occurredPrecision: "year", occurredLabel: "0000" })
      .expect(400);
    await request(app.getHttpServer())
      .patch(memoryPath)
      .set(headers)
      .send({
        occurredPrecision: "month",
        occurredLabel: "2025-02",
        occurredAt: "2025-02-01T00:00:00Z",
      })
      .expect(400);
    await request(app.getHttpServer())
      .patch(memoryPath)
      .set(headers)
      .send({
        sourceRefs: [
          {
            kind: "manual",
            sourceId: randomUUID(),
            quote: "approved",
            sha256: hash("approved"),
          },
        ],
      })
      .expect(400);
    await request(app.getHttpServer())
      .patch(memoryPath)
      .set(headers)
      .send({
        sourceRefs: [
          { kind: "post", sourceId: randomUUID(), quote: "", sha256: hash("") },
        ],
      })
      .expect(400);
    await request(app.getHttpServer())
      .patch(memoryPath)
      .set(headers)
      .send({
        sourceRefs: [
          {
            kind: "persona_source",
            sourceId: personaId,
            quote: "차분",
            sha256: hash("wrong"),
            sourceSha256: hash(content),
            byteStart: 0,
            byteEnd: Buffer.byteLength("차분"),
          },
        ],
      })
      .expect(400);
    await request(app.getHttpServer())
      .patch(memoryPath)
      .set(headers)
      .send({
        sourceRefs: [
          {
            kind: "persona_source",
            sourceId: foreignPersona.body.id,
            quote: "차분",
            sha256: hash("차분"),
            sourceSha256: hash("차분"),
            byteStart: 0,
            byteEnd: Buffer.byteLength("차분"),
          },
        ],
      })
      .expect(400);
    await request(app.getHttpServer())
      .patch(memoryPath)
      .set(headers)
      .send({
        content: "must rollback",
        sourceRefs: [
          {
            kind: "persona_source",
            sourceId: personaId,
            quote: "여행",
            sha256: hash("여행"),
            sourceSha256: hash(content),
            byteStart: 0,
            byteEnd: Buffer.byteLength("여행"),
          },
        ],
      })
      .expect(400);
    await request(app.getHttpServer())
      .get(`/api/admin/v1/characters/${characterId}/memory`)
      .set(headers)
      .expect(200)
      .expect((res) =>
        expect(
          res.body.items.find(
            (item: { id: string }) => item.id === memory.body.id,
          ).content,
        ).toBe("fact"),
      );
  });
});
