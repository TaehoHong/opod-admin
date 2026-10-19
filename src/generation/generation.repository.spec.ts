import { createDrizzleMock } from "../../test/drizzle-mock";
import { GenerationRepository } from "./generation.repository";

describe("GenerationRepository", () => {
  it("초안 확정과 감사 로그를 같은 트랜잭션에 기록한다", async () => {
    const mock = createDrizzleMock([
      { rows: [] },
      [{ characterId: "character-1" }],
      [],
    ]);
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

describe("reference generation persistence", () => {
  const metadata = {
    promptRevision: "2",
    shotId: "shot-a",
    prompt: "Image 1 source",
    negativePrompt: "blur",
    generation: {
      id: "17",
      revision: 1,
      aiModelId: "4",
      provider: "spicyapi",
      effectiveModel: "model",
    },
    generationParams: { aspect_ratio: "4:5" },
    references: [
      {
        id: "SOURCE_1",
        role: "source",
        inputOrder: 1,
        promptLabel: "Image 1",
        sha256: "a".repeat(64),
        media: { url: "", storageKey: "source.png" },
      },
    ],
  };
  const planned = () => ({
    id: "job-a",
    draftId: "draft-a",
    characterId: "character-a",
    sortOrder: 0,
    prompt: metadata.prompt,
    paramsJson: { _referenceAgent: metadata, _postAgent: { promptId: "17" } },
  });

  it("preserves submitted jobs and validates their frozen snapshot in the same transaction", async () => {
    const job = planned();
    const mock = createDrizzleMock([
      [],
      [
        {
          ...job,
          status: "completed",
          prompt: "provider merged negative",
          inputPrompt: metadata.prompt,
          candidateCount: 1,
          mediaType: "image",
          paramsJson: {
            ...job.paramsJson,
            _providerProgress: { status: "running" },
          },
        },
      ],
    ]);
    await expect(
      new GenerationRepository(mock.database as never).ensureReferenceDraftJobs(
        [job],
      ),
    ).resolves.toBeUndefined();
    expect(mock.client.transaction).toHaveBeenCalledTimes(1);
    expect(mock.operations.map((operation) => operation.kind)).toEqual([
      "insert",
      "select",
    ]);
    expect(mock.operations[0].values).toEqual([
      expect.objectContaining({ status: "draft", candidateCount: 1 }),
    ]);
  });

  it("rejects a reused deterministic job ID with changed frozen inputs", async () => {
    const job = planned();
    const mock = createDrizzleMock([
      [],
      [
        {
          ...job,
          inputPrompt: metadata.prompt,
          candidateCount: 1,
          mediaType: "image",
          paramsJson: {
            ...job.paramsJson,
            _referenceAgent: { ...metadata, negativePrompt: "different" },
          },
        },
      ],
    ]);
    await expect(
      new GenerationRepository(mock.database as never).ensureReferenceDraftJobs(
        [job],
      ),
    ).rejects.toThrow("snapshot conflict");
  });

  it("requeues a failed reference job with the same ID and frozen inputs", async () => {
    const job = {
      ...planned(),
      status: "failed",
      provider: "old",
      providerRequestId: "old-request",
      attemptCount: 3,
    };
    const mock = createDrizzleMock([
      { rows: [{ locked: true }] },
      [{ ...job, status: "queued" }],
      [],
    ]);
    const result = await new GenerationRepository(
      mock.database as never,
    ).retryJob(job as never, "retry");
    expect(result.id).toBe(job.id);
    expect(mock.operations.map((operation) => operation.kind)).toEqual([
      "update",
      "insert",
    ]);
    expect(mock.operations[0].set).toMatchObject({
      status: "queued",
      provider: null,
      providerRequestId: null,
      paramsJson: job.paramsJson,
    });
    expect(mock.operations[1].values).toMatchObject({
      targetId: job.id,
      reason: "retry",
    });
  });
});

it("does not confirm an old reference job while source reset owns the execution lock", async () => {
  const mock = createDrizzleMock([{ rows: [{ locked: false }] }]);
  expect(
    await new GenerationRepository(mock.database as never).confirmImageDraft(
      "job-1",
    ),
  ).toBe(false);
  expect(mock.client.update).not.toHaveBeenCalled();
  expect(mock.client.insert).not.toHaveBeenCalled();
});
