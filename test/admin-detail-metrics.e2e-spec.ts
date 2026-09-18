import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/domain/database/database.service";
import {
  characters,
  generationJobs,
  postComments,
  postDrafts,
  postReactions,
  posts,
} from "../src/domain/database/schema";
import { adminHeaders } from "./admin-auth";

describe("admin detail metrics", () => {
  let app: INestApplication;
  let headers: Awaited<ReturnType<typeof adminHeaders>>;
  let database: DatabaseService;
  let characterId: string;
  let draftId: string;

  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    headers = await adminHeaders(app);
    database = app.get(DatabaseService);

    characterId = randomUUID();
    await database.client.execute(sql`
      insert into ${characters}
        (id, public_id, display_name, bio, interests, updated_at)
      values (
        ${characterId},
        ${`metrics-${randomUUID().slice(0, 8)}`},
        'Metrics Character',
        'Metrics fixture',
        ARRAY[]::text[],
        ${new Date()}
      )
    `);

    const now = Date.now();
    const [recentPost, olderPost] = await database.client
      .insert(posts)
      .values([
        {
          characterId,
          contentType: "feed",
          content: "recent",
          createdAt: new Date(now - 3 * 86_400_000),
        },
        {
          characterId,
          contentType: "feed",
          content: "older",
          createdAt: new Date(now - 10 * 86_400_000),
        },
        {
          characterId,
          contentType: "feed",
          content: "outside window",
          createdAt: new Date(now - 45 * 86_400_000),
        },
      ])
      .returning();

    await database.client.insert(postComments).values([
      { postId: recentPost.id, characterId, body: "first" },
      { postId: olderPost.id, characterId, body: "second" },
    ]);
    await database.client.insert(postReactions).values([
      {
        postId: recentPost.id,
        characterId,
        reactionType: "like",
      },
    ]);

    const [draft] = await database.client
      .insert(postDrafts)
      .values({
        characterId,
        draftType: "post",
        contentType: "feed",
        caption: "recent",
        status: "published",
        attemptCount: 2,
        publishedPostId: recentPost.id,
        createdAt: new Date(now - 4 * 86_400_000),
        updatedAt: recentPost.createdAt,
      })
      .returning();
    draftId = draft.id;

    await database.client.insert(generationJobs).values([
      {
        characterId,
        draftId,
        mediaType: "image",
        prompt: "first",
        status: "completed",
        attemptCount: 1,
      },
      {
        characterId,
        draftId,
        mediaType: "image",
        prompt: "second",
        status: "failed",
        attemptCount: 3,
      },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns character publishing and engagement metrics", async () => {
    await request(app.getHttpServer())
      .get(`/api/admin/v1/characters/${characterId}/metrics`)
      .set(headers)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual({
          lastPostAt: expect.any(String),
          postsLast7Days: 1,
          postsLast30Days: 2,
          commentsLast30Days: 2,
          reactionsLast30Days: 1,
        });
      });
  });

  it("returns production and engagement metrics for a unified post work item", async () => {
    await request(app.getHttpServer())
      .get(`/api/admin/v1/post-work-items/${draftId}/metrics`)
      .set(headers)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual({
          productionStartedAt: expect.any(String),
          lastChangedAt: expect.any(String),
          publishedAt: expect.any(String),
          draftAttemptCount: 2,
          generationJobCount: 2,
          failedGenerationJobCount: 1,
          generationAttemptCount: 4,
          commentCount: 1,
          reactionCount: 1,
        });
      });
  });
});
