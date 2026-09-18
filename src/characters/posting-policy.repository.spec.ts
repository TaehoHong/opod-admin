import { createDrizzleMock, sqlText } from "../../test/drizzle-mock";
import { PostingPolicyRepository } from "./posting-policy.repository";

describe("PostingPolicyRepository", () => {
  it("returns no latest run before the social activity schema is deployed", async () => {
    const mock = createDrizzleMock([{ rows: [{ tableName: null }] }]);
    const repository = new PostingPolicyRepository(mock.database as never);

    await expect(repository.findLatestRun("character-1")).resolves.toBeNull();
    expect(mock.client.execute).toHaveBeenCalledTimes(1);
  });

  it("reads the latest run when the social activity schema exists", async () => {
    const run = {
      processingStatus: "completed",
      scheduledAt: new Date("2026-09-18T01:00:00.000Z"),
      finishedAt: new Date("2026-09-18T01:01:00.000Z"),
      attemptCount: 1,
      lastErrorMessage: null,
    };
    const mock = createDrizzleMock([
      { rows: [{ tableName: "opod.character_social_activity_jobs" }] },
      { rows: [run] },
    ]);
    const repository = new PostingPolicyRepository(mock.database as never);

    await expect(repository.findLatestRun("character-1")).resolves.toEqual(run);
    expect(sqlText(mock.client.execute.mock.calls[1][0])).toContain(
      "from opod.character_social_activity_jobs",
    );
  });
});
