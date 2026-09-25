import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/domain/database/database.service";
import { CharacterService } from "../src/characters/character.service";
import { CharacterActionLogService } from "../src/characters/character-action-log.service";
import { CharacterSocialActivityPolicyService } from "../src/characters/character-social-activity-policy.service";
import {
  characterActionLogs,
  characterSocialActivityJobs,
  characterSocialActivityPolicies,
  characters,
  postReactions,
  posts,
} from "../src/domain/database/schema";
import { and, eq } from "drizzle-orm";
import { adminHeaders } from "./admin-auth";

const policy = {
  enabled: true,
  activeStartLocalTime: "08:30",
  activeEndLocalTime: "23:00:00",
  activityIntervalMinutes: 30,
  maxDailyPostViews: 120,
  maxDailyPostLikes: 12,
  maxDailyFollows: 3,
  postLikeProbability: 0.125,
};

describe("character social activity admin API", () => {
  let app: INestApplication;
  let database: DatabaseService;
  let headers: Record<string, string>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    database = app.get(DatabaseService);
    headers = await adminHeaders(app);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createCharacter(timezone?: string) {
    return request(app.getHttpServer())
      .post("/api/admin/v1/characters")
      .set(headers)
      .send({
        publicId: `social-${randomUUID().slice(0, 8)}`,
        displayName: "Social actor",
        bio: "Social activity test",
        interests: [],
        ...(timezone ? { timezone } : {}),
      })
      .expect(201)
      .then((response) => response.body as { id: string });
  }

  it("persists a full policy and exposes timezone after a fresh application read", async () => {
    const character = await createCharacter("Asia/Seoul");
    await request(app.getHttpServer())
      .get(`/api/admin/v1/characters/${character.id}/social-activity-policy`)
      .set(headers)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          characterId: character.id,
          timezone: "Asia/Seoul",
          policy: null,
        });
      });

    await request(app.getHttpServer())
      .put(`/api/admin/v1/characters/${character.id}/social-activity-policy`)
      .set(headers)
      .send(policy)
      .expect(200)
      .expect((response) => {
        expect(response.body.policy).toMatchObject({
          enabled: true,
          activeStartLocalTime: "08:30:00",
          activeEndLocalTime: "23:00:00",
          postLikeProbability: 0.125,
        });
        expect(response.body.policy.nextActivityAt).toEqual(expect.any(String));
      });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const reloadedApp = moduleRef.createNestApplication();
    await reloadedApp.init();
    try {
      const reloadedHeaders = await adminHeaders(reloadedApp);
      await request(reloadedApp.getHttpServer())
        .get(`/api/admin/v1/characters/${character.id}`)
        .set(reloadedHeaders)
        .expect(200)
        .expect((response) => {
          expect(response.body.timezone).toBe("Asia/Seoul");
        });
    } finally {
      await reloadedApp.close();
    }
  });

  it("rejects invalid or missing timezone on enable and permits a valid timezone change", async () => {
    await request(app.getHttpServer())
      .post("/api/admin/v1/characters")
      .set(headers)
      .send({
        publicId: `invalid-${randomUUID().slice(0, 8)}`,
        displayName: "Invalid timezone",
        bio: "Invalid timezone",
        timezone: "+09:00",
      })
      .expect(400);

    const normalized = await createCharacter("asia/seoul");
    await request(app.getHttpServer())
      .get(`/api/admin/v1/characters/${normalized.id}`)
      .set(headers)
      .expect(200)
      .expect((response) => expect(response.body.timezone).toBe("Asia/Seoul"));

    const character = await createCharacter();
    await request(app.getHttpServer())
      .put(`/api/admin/v1/characters/${character.id}/social-activity-policy`)
      .set(headers)
      .send(policy)
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/admin/v1/characters/${character.id}`)
      .set(headers)
      .send({ timezone: "America/New_York" })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/admin/v1/characters/${character.id}/social-activity-policy`)
      .set(headers)
      .send(policy)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/admin/v1/characters/${character.id}`)
      .set(headers)
      .send({ timezone: "Asia/Tokyo" })
      .expect(200)
      .expect((response) => expect(response.body.timezone).toBe("Asia/Tokyo"));
    await request(app.getHttpServer())
      .patch(`/api/admin/v1/characters/${character.id}`)
      .set(headers)
      .send({ timezone: null })
      .expect(400);
  });

  it("enforces authentication, CSRF, policy bounds, and actor eligibility", async () => {
    const character = await createCharacter("UTC");
    const path = `/api/admin/v1/characters/${character.id}/social-activity-policy`;
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer())
      .put(path)
      .set("cookie", headers.cookie)
      .send(policy)
      .expect(403);

    for (const invalid of [
      { ...policy, activeEndLocalTime: "08:30" },
      { ...policy, activityIntervalMinutes: 1.5 },
      { ...policy, maxDailyPostViews: 2147483648 },
      { ...policy, postLikeProbability: 1.1 },
    ]) {
      await request(app.getHttpServer())
        .put(path)
        .set(headers)
        .send(invalid)
        .expect(400);
    }

    await request(app.getHttpServer())
      .patch(`/api/admin/v1/characters/${character.id}/status`)
      .set(headers)
      .send({ status: "inactive", reason: "eligibility test" })
      .expect(200);
    await request(app.getHttpServer())
      .put(path)
      .set(headers)
      .send(policy)
      .expect(400);

    const legacy = await createCharacter("UTC");
    await database.client
      .update(characters)
      .set({ timezone: "asia/seoul" })
      .where(eq(characters.id, legacy.id));
    await request(app.getHttpServer())
      .put(`/api/admin/v1/characters/${legacy.id}/social-activity-policy`)
      .set(headers)
      .send(policy)
      .expect(400);
    const [stored] = await database.client
      .select({ enabled: characterSocialActivityPolicies.enabled })
      .from(characterSocialActivityPolicies)
      .where(eq(characterSocialActivityPolicies.characterId, legacy.id));
    expect(stored?.enabled).not.toBe(true);
  });

  it("atomically disables the policy and cancels its active job", async () => {
    const character = await createCharacter("UTC");
    await request(app.getHttpServer())
      .put(`/api/admin/v1/characters/${character.id}/social-activity-policy`)
      .set(headers)
      .send(policy)
      .expect(200);
    const [runningJob] = await database.client
      .insert(characterSocialActivityJobs)
      .values({
        characterId: character.id,
        scheduledAt: new Date(),
        nextAttemptAt: new Date(),
        processingStatus: "running",
        processingLeaseToken: randomUUID(),
        processingLeaseExpiresAt: new Date(Date.now() + 60_000),
      })
      .returning({ id: characterSocialActivityJobs.id });

    await request(app.getHttpServer())
      .put(`/api/admin/v1/characters/${character.id}/social-activity-policy`)
      .set(headers)
      .send({ ...policy, enabled: false })
      .expect(200)
      .expect((response) => {
        expect(response.body.policy).toMatchObject({
          enabled: false,
          nextActivityAt: null,
        });
        expect(response.body.latestJob).toMatchObject({
          id: expect.any(String),
          processingStatus: "cancelled",
          finishedAt: expect.any(String),
        });
      });

    const [cancelledJob] = await database.client
      .select({
        processingLeaseToken: characterSocialActivityJobs.processingLeaseToken,
        processingLeaseExpiresAt:
          characterSocialActivityJobs.processingLeaseExpiresAt,
      })
      .from(characterSocialActivityJobs)
      .where(eq(characterSocialActivityJobs.id, runningJob.id));
    expect(cancelledJob).toEqual({
      processingLeaseToken: null,
      processingLeaseExpiresAt: null,
    });

    await request(app.getHttpServer())
      .get(`/api/admin/v1/characters/${character.id}/posting-policy`)
      .set(headers)
      .expect(200)
      .expect((response) => expect(response.body.lastRun).toBeNull());
  });

  it("disables policy and cancels queued work when the character is deactivated", async () => {
    const character = await createCharacter("UTC");
    await request(app.getHttpServer())
      .put(`/api/admin/v1/characters/${character.id}/social-activity-policy`)
      .set(headers)
      .send(policy)
      .expect(200);
    await database.client.insert(characterSocialActivityJobs).values({
      characterId: character.id,
      scheduledAt: new Date(),
      nextAttemptAt: new Date(),
      processingStatus: "queued",
    });

    await request(app.getHttpServer())
      .patch(`/api/admin/v1/characters/${character.id}/status`)
      .set(headers)
      .send({ status: "inactive", reason: "operator deactivated character" })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/admin/v1/characters/${character.id}/social-activity-policy`)
      .set(headers)
      .expect(200)
      .expect((response) => {
        expect(response.body.policy).toMatchObject({
          enabled: false,
          nextActivityAt: null,
        });
        expect(response.body.latestJob.processingStatus).toBe("cancelled");
      });
  });

  it("DELETE disables policy and cancels unfinished work", async () => {
    const character = await createCharacter("UTC");
    await request(app.getHttpServer())
      .put(`/api/admin/v1/characters/${character.id}/social-activity-policy`)
      .set(headers)
      .send(policy)
      .expect(200);
    await database.client.insert(characterSocialActivityJobs).values({
      characterId: character.id,
      scheduledAt: new Date(),
      nextAttemptAt: new Date(),
      processingStatus: "queued",
    });
    await request(app.getHttpServer())
      .delete(`/api/admin/v1/characters/${character.id}`)
      .set(headers)
      .send({ reason: "operator deleted character" })
      .expect(200);
    const [storedPolicy] = await database.client
      .select()
      .from(characterSocialActivityPolicies)
      .where(eq(characterSocialActivityPolicies.characterId, character.id));
    const [job] = await database.client
      .select()
      .from(characterSocialActivityJobs)
      .where(eq(characterSocialActivityJobs.characterId, character.id));
    expect(storedPolicy.enabled).toBe(false);
    expect(storedPolicy.nextActivityAt).toBeNull();
    expect(job.processingStatus).toBe("cancelled");
  });

  it("shares the actor transaction and rolls back policy and audit together", async () => {
    const character = await createCharacter("UTC");
    const other = await createCharacter("UTC");
    const characters = app.get(CharacterService);
    const policies = app.get(CharacterSocialActivityPolicyService);
    const actionLogs = app.get(CharacterActionLogService);
    await expect(
      characters.withActivityTransaction(character.id, async () => {
        await characters.withActivityTransaction(character.id, async () => {
          await policies.upsert(character.id, policy);
          await actionLogs.record({
            characterId: character.id,
            actionType: "TEST_ROLLBACK",
            targetTable: "characters",
            targetId: character.id,
            reason: "rollback test",
          });
        });
        await expect(
          characters.withActivityTransaction(other.id, async () => undefined),
        ).rejects.toThrow("actor mismatch");
        throw new Error("rollback requested");
      }),
    ).rejects.toThrow("rollback requested");
    const [storedPolicy, logs] = await Promise.all([
      database.client
        .select()
        .from(characterSocialActivityPolicies)
        .where(eq(characterSocialActivityPolicies.characterId, character.id)),
      database.client
        .select()
        .from(characterActionLogs)
        .where(
          and(
            eq(characterActionLogs.characterId, character.id),
            eq(characterActionLogs.actionType, "TEST_ROLLBACK"),
          ),
        ),
    ]);
    expect(storedPolicy).toHaveLength(0);
    expect(logs).toHaveLength(0);
  });

  it("records one audit log for repeated manual reaction requests", async () => {
    const author = await createCharacter("UTC");
    const actor = await createCharacter("UTC");
    const [post] = await database.client
      .insert(posts)
      .values({ characterId: author.id, content: "Manual like" })
      .returning();
    const url = `/api/admin/v1/posts/${post.id}/reactions`;
    const first = await request(app.getHttpServer())
      .post(url)
      .set(headers)
      .send({ characterId: actor.id, reactionType: "like" })
      .expect(201);
    await request(app.getHttpServer())
      .post(url)
      .set(headers)
      .send({ characterId: actor.id, reactionType: "like" })
      .expect(201)
      .expect((response) => expect(response.body.id).toBe(first.body.id));
    const logs = await database.client
      .select()
      .from(characterActionLogs)
      .where(
        and(
          eq(characterActionLogs.characterId, actor.id),
          eq(characterActionLogs.actionType, "POST_REACTION_CREATED"),
          eq(characterActionLogs.targetId, first.body.id as string),
        ),
      );
    expect(logs).toHaveLength(1);
  });

  it("returns an existing automated character like without duplicating its audit log", async () => {
    const author = await createCharacter("UTC");
    const actor = await createCharacter("UTC");
    const [post] = await database.client
      .insert(posts)
      .values({ characterId: author.id, content: "Already liked" })
      .returning();
    const [existing] = await database.client
      .insert(postReactions)
      .values({ postId: post.id, characterId: actor.id, reactionType: "like" })
      .returning();

    await request(app.getHttpServer())
      .post(`/api/admin/v1/posts/${post.id}/reactions`)
      .set(headers)
      .send({ characterId: actor.id, reactionType: "like" })
      .expect(201)
      .expect((response) => expect(response.body.id).toBe(existing.id));

    const [facts, audit] = await Promise.all([
      database.client
        .select()
        .from(postReactions)
        .where(
          and(
            eq(postReactions.postId, post.id),
            eq(postReactions.characterId, actor.id),
            eq(postReactions.reactionType, "like"),
          ),
        ),
      database.client
        .select()
        .from(characterActionLogs)
        .where(
          and(
            eq(characterActionLogs.characterId, actor.id),
            eq(characterActionLogs.actionType, "POST_REACTION_CREATED"),
            eq(characterActionLogs.targetId, existing.id),
          ),
        ),
    ]);
    expect(facts).toHaveLength(1);
    expect(audit).toHaveLength(0);
  });
});
