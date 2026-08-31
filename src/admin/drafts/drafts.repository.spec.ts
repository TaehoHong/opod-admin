import { createDrizzleMock } from "../../../test/drizzle-mock";
import { DraftsRepository, type RegenerationSource } from "./drafts.repository";

const source: RegenerationSource = {
  id: "job-1",
  characterId: "character-1",
  sortOrder: 0,
  status: "completed",
  inputPrompt: null,
  prompt: "old",
  candidateCount: 1,
  paramsJson: {},
};

describe("DraftsRepository", () => {
  it("최신 컷만 재생성하고 감사 로그를 같은 트랜잭션에 쓴다", async () => {
    const mock = createDrizzleMock([
      [{ id: "job-1" }],
      [{ id: "draft-1" }],
      [{ id: "job-2" }],
      [],
    ]);
    const repository = new DraftsRepository(mock.database as never);

    await expect(
      repository.regenerateShot({ draftId: "draft-1", source, prompt: "new" }),
    ).resolves.toEqual({ outcome: "regenerated", jobId: "job-2" });

    expect(mock.operations[1].set).toMatchObject({ status: "regenerating" });
    expect(mock.operations[2].values).toMatchObject({
      originJobId: "job-1",
      prompt: "new",
    });
    expect(mock.operations[3].values).toMatchObject({
      actionType: "DRAFT_SHOT_REGENERATED",
    });
  });

  it("요청한 컷이 최신이 아니면 초안을 변경하지 않는다", async () => {
    const mock = createDrizzleMock([[{ id: "job-newer" }]]);
    const repository = new DraftsRepository(mock.database as never);

    await expect(
      repository.regenerateShot({ draftId: "draft-1", source, prompt: "new" }),
    ).resolves.toEqual({ outcome: "stale-job" });
    expect(mock.operations).toHaveLength(1);
  });

  it("후보 선택과 대표 미디어 갱신을 한 트랜잭션에서 수행한다", async () => {
    const mock = createDrizzleMock([[], [], []]);
    const repository = new DraftsRepository(mock.database as never);

    await repository.selectShotOutput("job-1", "media-1");

    expect(mock.client.transaction).toHaveBeenCalledTimes(1);
    expect(mock.operations.map((operation) => operation.set)).toEqual([
      { selected: false },
      { selected: true },
      { outputMediaId: "media-1" },
    ]);
  });
});
