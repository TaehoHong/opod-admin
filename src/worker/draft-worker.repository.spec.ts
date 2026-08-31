import { createDrizzleMock, sqlText } from "../../test/drizzle-mock";
import { DraftWorkerRepository } from "./draft-worker.repository";

describe("DraftWorkerRepository", () => {
  it("legacy 초안을 SKIP LOCKED 순서로 claim한다", async () => {
    const mock = createDrizzleMock([{ rows: [{ id: "draft-1" }] }]);
    const repository = new DraftWorkerRepository(mock.database as never);

    await expect(repository.claimPlannedDraft(120)).resolves.toBe("draft-1");

    const query = sqlText(mock.client.execute.mock.calls[0][0]);
    expect(query).toContain("for update of d skip locked");
    expect(query).toContain("pipelineVersion");
    expect(query).toContain("not in");
  });

  it("V3/V4 자동 claim은 Agent 단계만 집는다", async () => {
    const mock = createDrizzleMock([{ rows: [] }]);
    const repository = new DraftWorkerRepository(mock.database as never);

    await repository.claimV3Draft(120);

    const query = sqlText(mock.client.execute.mock.calls[0][0]);
    expect(query).toContain("post_plan");
    expect(query).toContain("image_plan");
    expect(query).toContain("image_prompt");
    expect(query).toContain("caption");
    expect(query).not.toContain("'publish','memory'");
  });

  it("수동 실행은 publish 단계를 caption으로 되감는다", async () => {
    const mock = createDrizzleMock([{ rows: [{ id: "draft-1" }] }]);
    const repository = new DraftWorkerRepository(mock.database as never);

    await expect(repository.claimV3DraftNow("draft-1", 120)).resolves.toBe(
      true,
    );

    const query = sqlText(mock.client.execute.mock.calls[0][0]);
    expect(query).toContain("then '\"caption\"'::jsonb");
    expect(query).toContain("captionBuild");
  });

  it("V3 산출물 CAS와 감사 로그를 같은 트랜잭션에 저장한다", async () => {
    const mock = createDrizzleMock([[{ id: "draft-1" }], []]);
    const repository = new DraftWorkerRepository(mock.database as never);

    await expect(
      repository.persistV3Artifact({
        draftId: "draft-1",
        characterId: "character-1",
        expected: {
          stage: "post_plan",
          state: "running",
          artifactKey: "postPlanning",
          revision: null,
        },
        conceptJson: { pipeline: { stage: "image_plan", state: "pending" } },
        actionType: "DRAFT_V3_POST_PLAN_READY",
        reason: "ready",
      }),
    ).resolves.toBe(true);

    expect(mock.client.transaction).toHaveBeenCalledTimes(1);
    expect(mock.operations[0].set).toMatchObject({
      status: "planned",
      leaseExpiresAt: null,
      attemptCount: 0,
    });
    expect(mock.operations[1].values).toMatchObject({
      actionType: "DRAFT_V3_POST_PLAN_READY",
    });
  });

  it("게시 CAS가 실패하면 미디어와 게시글을 만들지 않는다", async () => {
    const mock = createDrizzleMock([[]]);
    const repository = new DraftWorkerRepository(mock.database as never);

    await expect(
      repository.persistPublishedPost({
        draftId: "draft-1",
        characterId: "character-1",
        contentType: "feed",
        caption: "caption",
        hashtags: [],
        media: [{ originalMediaId: "media-1", finishedFile: null }],
      }),
    ).rejects.toThrow("draft left the publishable state");
    expect(mock.operations).toHaveLength(1);
  });
});
