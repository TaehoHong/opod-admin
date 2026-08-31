import { createDrizzleMock } from "../../../test/drizzle-mock";
import { GenerationRepository } from "./generation.repository";

describe("GenerationRepository", () => {
  it("초안 확정과 감사 로그를 같은 트랜잭션에 기록한다", async () => {
    const mock = createDrizzleMock([[{ characterId: "character-1" }], []]);
    const repository = new GenerationRepository(mock.database as never);

    await expect(repository.confirmImageDraft("job-1")).resolves.toBe(true);

    expect(mock.client.transaction).toHaveBeenCalledTimes(1);
    expect(mock.operations[0].set).toEqual({ status: "queued" });
    expect(mock.operations[1].values).toMatchObject({
      actionType: "GENERATION_DRAFT_CONFIRMED",
      targetId: "job-1",
    });
  });

  it("완료 잡을 잠근 뒤 선택 후보와 대표 미디어를 함께 바꾼다", async () => {
    const mock = createDrizzleMock([
      { rows: [] },
      [{ selected: false, characterId: "character-1", outputMediaId: null }],
      [],
      [],
      [],
      [],
    ]);
    const repository = new GenerationRepository(mock.database as never);

    await expect(repository.selectOutput("job-1", "media-1")).resolves.toBe(
      "selected",
    );

    expect(mock.client.execute).toHaveBeenCalledTimes(1);
    expect(
      mock.operations.filter((operation) => operation.kind === "update"),
    ).toHaveLength(3);
    expect(mock.operations.at(-1)?.values).toMatchObject({
      actionType: "GENERATION_OUTPUT_SELECTED",
    });
  });

  it("URL 미디어 생성과 running 잡 완료를 원자적으로 처리한다", async () => {
    const mock = createDrizzleMock([[{ id: "media-1" }], [{ id: "job-1" }]]);
    const repository = new GenerationRepository(mock.database as never);

    await expect(
      repository.completeJobWithUrl({
        jobId: "job-1",
        mediaType: "image",
        url: "https://example.com/a.jpg",
      }),
    ).resolves.toBe(true);

    expect(mock.client.transaction).toHaveBeenCalledTimes(1);
    expect(mock.operations[1].set).toMatchObject({
      status: "completed",
      outputMediaId: "media-1",
    });
  });
});
