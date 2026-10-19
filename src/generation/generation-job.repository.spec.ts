import { createDrizzleMock, sqlText } from "../../test/drizzle-mock";
import { GenerationJobRepository } from "./generation-job.repository";

describe("GenerationJobRepository", () => {
  it("provider 진행 상태를 기존 JSON에 병합하는 SQL을 실행한다", async () => {
    const mock = createDrizzleMock([{ rows: [] }]);
    const repository = new GenerationJobRepository(mock.database as never);

    await repository.recordProviderProgress({
      jobId: "job-1",
      progress: { status: "running" },
    });

    const query = mock.client.execute.mock.calls[0][0];
    expect(sqlText(query)).toContain("jsonb_set(coalesce(params_json");
    expect(sqlText(query)).toContain("status = 'running'");
  });

  it("단일 결과를 대표 이미지로 선택해 완료 상태와 함께 저장한다", async () => {
    const mock = createDrizzleMock([
      [{ id: "media-1" }],
      [{ id: "job-1" }],
      [],
      [],
      [],
      [],
    ]);
    const repository = new GenerationJobRepository(mock.database as never);

    await repository.persistSuccess({
      jobId: "job-1",
      characterId: "character-1",
      costUsd: 0.2,
      providerName: "test",
      files: [
        {
          url: "https://example.com/a.jpg",
          contentType: "image/jpeg",
          byteSize: 10,
          image: { width: 100, height: 100 },
        },
      ],
    });

    expect(mock.operations[1].set).toMatchObject({
      status: "completed",
      outputMediaId: "media-1",
    });
    expect(mock.operations[2].values).toEqual([
      expect.objectContaining({ mediaId: "media-1", selected: true }),
    ]);
  });
});

it("checks accepted reference build IDs and prompt revision before auto claim", async () => {
  const mock = createDrizzleMock([{ rows: [] }]);
  await new GenerationJobRepository(
    mock.database as never,
  ).claimNextQueuedImageJob(60);
  const query = sqlText(mock.client.execute.mock.calls[0][0]);
  expect(query).toContain("'generationBuild'->'jobIds'");
  expect(query).toContain("'_referenceAgent'->>'promptRevision'");
});

it.each(["next", "specific"])(
  "does not claim a %s reference job while reset owns its execution lock",
  async (kind) => {
    const mock = createDrizzleMock([
      { rows: [{ id: "job-1" }] },
      { rows: [{ locked: false }] },
    ]);
    const repository = new GenerationJobRepository(mock.database as never);
    expect(
      await (kind === "next"
        ? repository.claimNextQueuedImageJob(60)
        : repository.claimQueuedImageJob("job-1", 60)),
    ).toBeUndefined();
    expect(mock.client.update).not.toHaveBeenCalled();
    expect(mock.client.transaction).toHaveBeenCalledTimes(1);
    expect(sqlText(mock.client.execute.mock.calls[1][0])).toContain(
      "pg_try_advisory_xact_lock",
    );
    expect(sqlText(mock.client.execute.mock.calls[1][0])).toContain(
      "reference-execute:",
    );
  },
);

it("acquires the reset coordination lock before the claim update obtains its fresh snapshot", async () => {
  const mock = createDrizzleMock([
    { rows: [{ id: "job-1" }] },
    { rows: [{ locked: true }] },
    [{ id: "job-1" }],
  ]);
  expect(
    await new GenerationJobRepository(
      mock.database as never,
    ).claimNextQueuedImageJob(60),
  ).toBe("job-1");
  expect(mock.client.execute.mock.invocationCallOrder[1]).toBeLessThan(
    mock.client.update.mock.invocationCallOrder[0],
  );
  expect(mock.operations[0].set).toMatchObject({ status: "running" });
});
