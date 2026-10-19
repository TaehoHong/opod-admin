import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import sharp from "sharp";
import { AppModule } from "../src/app.module";
import { ADMIN_REQUEST_HEADER } from "../src/auth/admin-session";
import { GenerationSettingsService } from "../src/settings/generation-settings.service";
import { InfluencerMediaStore } from "../src/influencers/influencer-media-store";
import { InfluencerMediaService } from "../src/influencers/influencer-media.service";

class MemoryImageStore {
  readonly objects = new Map<string, Buffer>();
  async save(key: string, bytes: Buffer) {
    this.objects.set(key, bytes);
  }
  async url(key: string) {
    return `https://images.example.test/${key}`;
  }
}
describe("influencer media upload and analysis", () => {
  let app: INestApplication;
  let headers: Record<string, string>;
  let influencerId: string;
  let image: Buffer;
  let fetchSpy: jest.SpyInstance;
  let resolveSpy: jest.SpyInstance;
  const store = new MemoryImageStore();
  const endpoint = "/api/admin/v1/influencer-media";
  const analysis = {
    model: "vision-test",
    version: "composition-v1",
    content: {
      description: "person in cafe",
      framing: "waist up",
      pose: "seated",
      background: "cafe",
    },
  };
  const metadata = (postId: string, analyzed = false) => ({
    influencerId,
    postId,
    postUrl: `https://www.instagram.com/p/${postId}/`,
    slideIndex: 1,
    assetType: "image",
    analysis: analyzed ? analysis : null,
  });
  const upload = (body: object, bytes?: Buffer) =>
    request(app.getHttpServer())
      .post(endpoint)
      .set(headers)
      .field("metadata", JSON.stringify(body))
      .attach("file", bytes ?? image, "image.jpeg");
  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(InfluencerMediaStore)
        .useValue(store)
        .compile()
    ).createNestApplication();
    await app.init();
    const login = await request(app.getHttpServer())
      .post("/api/admin/v1/auth/login")
      .set(ADMIN_REQUEST_HEADER, "e2e")
      .send({ email: "admin@example.test", password: "test-password-1" })
      .expect(201);
    headers = {
      cookie: String(login.headers["set-cookie"]?.[0]).split(";")[0],
      [ADMIN_REQUEST_HEADER]: "e2e",
    };
    const c = await request(app.getHttpServer())
      .post("/api/admin/v1/characters")
      .set(headers)
      .send({ publicId: randomUUID(), displayName: "Media", bio: "test" })
      .expect(201);
    const account = await request(app.getHttpServer())
      .post(`/api/admin/v1/characters/${c.body.id}/influencers`)
      .set(headers)
      .send({ url: "https://instagram.com/media_fixture/" })
      .expect(201);
    influencerId = account.body.id;
    image = await sharp({
      create: { width: 4, height: 4, channels: 3, background: "red" },
    })
      .jpeg()
      .toBuffer();
    const settings = app.get(GenerationSettingsService);
    const resolved = await settings.resolveChatSettings();
    resolveSpy = jest.spyOn(settings, "resolveChatSettings").mockResolvedValue({
      ...resolved,
      embeddingApiUrl: "https://embedding.example.test/v1/embeddings",
      embeddingModel: "test-1024",
    });
    fetchSpy = jest.spyOn(globalThis, "fetch");
  });
  beforeEach(() => {
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "test-1024",
          data: [{ index: 0, embedding: [1, ...Array(1023).fill(0)] }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  });
  afterAll(async () => {
    fetchSpy?.mockRestore();
    resolveSpy?.mockRestore();
    await app?.close();
  });
  it("stores files without analysis, then analyzes once and preserves analysis on a null retry", async () => {
    const body = metadata("PHOTO1");
    const added = await upload(body).expect(201);
    expect(added.body).toMatchObject({
      created: true,
      analysisStatus: "missing",
      embedding: { status: "not_requested" },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    const analyzed = await upload({ ...body, analysis }).expect(200);
    expect(analyzed.body).toMatchObject({
      id: added.body.id,
      created: false,
      embedding: { status: "ready", model: "test-1024" },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const input = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(input.input[0]).toContain("pose: seated");
    expect(input.input[0]).not.toContain("cafe");
    await upload({ ...body, analysis }).expect(200);
    await upload(body).expect(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const list = await request(app.getHttpServer())
      .get(endpoint)
      .query({ influencerId, postId: "PHOTO1" })
      .set(headers)
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].analysis.content.pose).toBe("seated");
    expect(list.body.items[0].embedding).toBeUndefined();
    expect(list.body.items[0].imageUrl).toContain(
      "https://images.example.test/",
    );
  });
  it("preserves analysis after embedding failure and retries only the embedding", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("unavailable", { status: 503 }),
    );
    const failed = await upload(metadata("FAIL1", true)).expect(201);
    expect(failed.body).toMatchObject({
      analysisStatus: "saved",
      embedding: { status: "failed" },
    });
    const waiting = await request(app.getHttpServer())
      .get(endpoint)
      .query({ influencerId, postId: "FAIL1", work: "embedding" })
      .set(headers)
      .expect(200);
    expect(waiting.body.items[0].analysis.model).toBe("vision-test");
    const retry = await upload(metadata("FAIL1", true)).expect(200);
    expect(retry.body.embedding.status).toBe("ready");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
  it("rejects different image bytes at the same slide without replacing the original", async () => {
    const first = await upload(metadata("CONFLICT1")).expect(201);
    const other = await sharp({
      create: { width: 4, height: 4, channels: 3, background: "blue" },
    })
      .jpeg()
      .toBuffer();
    await upload(metadata("CONFLICT1"), other).expect(409);
    const row = await app.get(InfluencerMediaService).find({
      influencerId: BigInt(influencerId),
      postId: "CONFLICT1",
      slideIndex: 1,
    });
    expect(row?.sha256).toBe(first.body.sha256);
  });
  it("invalidates embeddings when analysis changes and rejects stale embedding writes", async () => {
    await upload(metadata("CHANGE1", true)).expect(201);
    const domain = app.get(InfluencerMediaService);
    const old = (await domain.find({
      influencerId: BigInt(influencerId),
      postId: "CHANGE1",
      slideIndex: 1,
    }))!;
    fetchSpy.mockResolvedValueOnce(new Response("failure", { status: 503 }));
    const updated = await upload({
      ...metadata("CHANGE1"),
      analysis: {
        ...analysis,
        content: { ...analysis.content, pose: "standing" },
      },
    }).expect(200);
    expect(updated.body.embedding.status).toBe("failed");
    const current = await domain.find({
      influencerId: BigInt(influencerId),
      postId: "CHANGE1",
      slideIndex: 1,
    });
    expect(current?.embedding).toBeNull();
    expect(current?.analysis?.pose).toBe("standing");
    await expect(
      domain.saveEmbedding(old, "test-1024", [1, ...Array(1023).fill(0)]),
    ).rejects.toThrow("analysis_changed");
  });
  it("shares raw captions across sibling slides, preserves null retries and embedding, and records confirmed empty", async () => {
    const body = metadata("CAPTION1", true);
    const raw = "  original caption\n#tag  ";
    const first = await upload({ ...body, sourceCaption: raw }).expect(201);
    expect(first.body.sourceCaption).toBe(raw);
    const inherited = await upload({
      ...body,
      slideIndex: 2,
      sourceCaption: null,
    }).expect(201);
    expect(inherited.body.sourceCaption).toBe(raw);
    const preserved = await upload({ ...body, analysis: null }).expect(200);
    expect(preserved.body.sourceCaption).toBe(raw);
    const nullRetry = await upload({
      ...body,
      analysis: null,
      sourceCaption: null,
    }).expect(200);
    expect(nullRetry.body.sourceCaption).toBe(raw);
    const rawList = await request(app.getHttpServer())
      .get(endpoint)
      .query({ influencerId, postId: "CAPTION1" })
      .set(headers)
      .expect(200);
    expect(
      rawList.body.items.map(
        (row: { sourceCaption: string }) => row.sourceCaption,
      ),
    ).toEqual([raw, raw]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const domain = app.get(InfluencerMediaService);
    const before = (await domain.find({
      influencerId: BigInt(influencerId),
      postId: "CAPTION1",
      slideIndex: 1,
    }))!;
    const cleared = await upload({
      ...body,
      analysis: null,
      slideIndex: 2,
      sourceCaption: "",
    }).expect(200);
    expect(cleared.body.sourceCaption).toBe("");
    await upload({ ...body, analysis: null, slideIndex: 3 }).expect(201);
    const after = (await domain.find({
      influencerId: BigInt(influencerId),
      postId: "CAPTION1",
      slideIndex: 1,
    }))!;
    expect(after.embedding).toEqual(before.embedding);
    expect(after.embeddingModel).toBe(before.embeddingModel);
    const list = await request(app.getHttpServer())
      .get(endpoint)
      .query({ influencerId, postId: "CAPTION1" })
      .set(headers)
      .expect(200);
    expect(
      list.body.items.map(
        (row: { sourceCaption: string }) => row.sourceCaption,
      ),
    ).toEqual(["", "", ""]);
    const unknown = await upload(metadata("CAPTION_UNKNOWN")).expect(201);
    expect(unknown.body.sourceCaption).toBeNull();
    const unknownList = await request(app.getHttpServer())
      .get(endpoint)
      .query({ influencerId, postId: "CAPTION_UNKNOWN" })
      .set(headers)
      .expect(200);
    expect(unknownList.body.items[0].sourceCaption).toBeNull();
  });
  it("serializes concurrent sibling caption saves and rolls back identity conflicts", async () => {
    const domain = app.get(InfluencerMediaService);
    await upload({
      ...metadata("CAPTION_FIXTURE"),
      sourceCaption: "initial",
    }).expect(201);
    const original = (await domain.find({
      influencerId: BigInt(influencerId),
      postId: "CAPTION_FIXTURE",
      slideIndex: 1,
    }))!;
    const write = {
      influencerId: original.influencerId,
      postId: "CAPTION_RACE",
      postUrl: "https://www.instagram.com/p/CAPTION_RACE/",
      slideIndex: original.slideIndex,
      assetType: original.assetType,
      mediaKey: original.mediaKey,
      sha256: original.sha256,
    };
    const results = await Promise.all([
      domain.register({ ...write, slideIndex: 1, sourceCaption: "first" }),
      domain.register({ ...write, slideIndex: 2, sourceCaption: "second" }),
      domain.register({ ...write, slideIndex: 3, sourceCaption: null }),
    ]);
    expect(results).toHaveLength(3);
    const rows = await domain.list({
      influencerId: BigInt(influencerId),
      postId: "CAPTION_RACE",
      limit: 100,
    });
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.sourceCaption)).size).toBe(1);
    expect(["first", "second"]).toContain(rows[0].sourceCaption);
    await expect(
      domain.register({
        ...write,
        sourceCaption: "must roll back",
        sha256: "different",
      }),
    ).rejects.toThrow("media_identity_conflict");
    const unchanged = await domain.list({
      influencerId: BigInt(influencerId),
      postId: "CAPTION_RACE",
      limit: 100,
    });
    expect(unchanged.map((row) => row.sourceCaption)).toEqual(
      rows.map((row) => row.sourceCaption),
    );
    await domain.register({ ...write, sourceCaption: "last successful" });
    await domain.register({
      ...write,
      postId: "OTHER_POST",
      sourceCaption: "other post",
    });
    const otherAccount = await request(app.getHttpServer())
      .post("/api/admin/v1/characters")
      .set(headers)
      .send({ publicId: randomUUID(), displayName: "Other media", bio: "test" })
      .expect(201);
    const account = await request(app.getHttpServer())
      .post(`/api/admin/v1/characters/${otherAccount.body.id}/influencers`)
      .set(headers)
      .send({ url: "https://instagram.com/other_media_fixture/" })
      .expect(201);
    await domain.register({
      ...write,
      influencerId: BigInt(account.body.id),
      sourceCaption: "other account",
    });
    const final = await domain.list({
      influencerId: BigInt(influencerId),
      postId: "CAPTION_RACE",
      limit: 100,
    });
    expect(final.map((row) => row.sourceCaption)).toEqual(
      Array(3).fill("last successful"),
    );
  });
  it("retains the multipart metadata byte limit for multibyte source captions", async () => {
    const body = {
      ...metadata("CAPTION_LIMIT"),
      sourceCaption: "가".repeat(7000),
    };
    expect(JSON.stringify(body).length).toBeLessThan(20000);
    await upload(body).expect(400);
  });
  it("rejects unauthenticated, malformed, unsupported and forged media requests", async () => {
    await request(app.getHttpServer()).get(endpoint).expect(401);
    await request(app.getHttpServer())
      .post(endpoint)
      .set("cookie", headers.cookie)
      .expect(403);
    await upload({ ...metadata("BAD1"), analysis: { model: "x" } }).expect(400);
    await upload(metadata("BAD2"), Buffer.from("not an image")).expect(422);
    await upload({ ...metadata("BAD3"), mediaKey: "arbitrary/path" }).expect(
      400,
    );
    await upload({
      ...metadata("BAD4"),
      influencerId: "9223372036854775808",
    }).expect(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
