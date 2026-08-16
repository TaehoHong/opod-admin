import { DraftsRepository, RegenerationSource } from "./drafts.repository";

function makeRepository(prisma: unknown) {
  return new (DraftsRepository as new (prisma: unknown) => DraftsRepository)(
    prisma,
  );
}

const source: RegenerationSource = {
  id: "job-1",
  characterId: "ai-1",
  sortOrder: 2,
  status: "completed",
  inputPrompt: "장면 원문",
  prompt: "생성 프롬프트",
  candidateCount: 3,
  paramsJson: { aspect_ratio: "4:5" },
};

describe("DraftsRepository", () => {
  it("regenerates the latest shot and its audit log in one transaction", async () => {
    const findLatest = jest.fn().mockResolvedValue({ id: "job-1" });
    const transitionDraft = jest.fn().mockResolvedValue({ count: 1 });
    const createJob = jest.fn().mockResolvedValue({ id: "job-2" });
    const createActionLog = jest.fn().mockResolvedValue({});
    const transaction = jest.fn(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          generationJob: { findFirst: findLatest, create: createJob },
          postDraft: {
            updateMany: transitionDraft,
            findUnique: jest.fn(),
          },
          characterActionLog: { create: createActionLog },
        }),
    );
    const repository = makeRepository({ $transaction: transaction });

    await expect(
      repository.regenerateShot({
        draftId: "draft-1",
        source,
        prompt: "수정 프롬프트",
      }),
    ).resolves.toEqual({ outcome: "regenerated", jobId: "job-2" });
    expect(transaction).toHaveBeenCalledTimes(1);
    // 검수 상태(v2·v3) 또는 V4의 캡션·게시 대기 — 어느 쪽이든 같은 전이.
    expect(transitionDraft).toHaveBeenCalledWith({
      where: {
        id: "draft-1",
        OR: [
          { status: { in: ["needs_review", "failed"] } },
          // 실패한 컷은 초안이 generating이어도 그 자리에서 다시 만든다.
          { status: { in: ["generating", "regenerating"] } },
          expect.objectContaining({ status: "planned" }),
        ],
      },
      data: { status: "regenerating", errorMessage: null },
    });
    expect(createJob).toHaveBeenCalledWith({
      select: { id: true },
      data: {
        characterId: "ai-1",
        mediaType: "image",
        inputPrompt: "장면 원문",
        prompt: "수정 프롬프트",
        candidateCount: 3,
        paramsJson: { aspect_ratio: "4:5" },
        draftId: "draft-1",
        sortOrder: 2,
        originJobId: "job-1",
      },
    });
    expect(createActionLog).toHaveBeenCalledWith({
      data: {
        characterId: "ai-1",
        actionType: "DRAFT_SHOT_REGENERATED",
        targetTable: "post_drafts",
        targetId: "draft-1",
        reason: "shot 2 regeneration queued",
      },
    });
  });

  it("does not mutate a draft when the requested shot is stale", async () => {
    const transitionDraft = jest.fn();
    const createJob = jest.fn();
    const transaction = jest.fn(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          generationJob: {
            findFirst: jest.fn().mockResolvedValue({ id: "job-new" }),
            create: createJob,
          },
          postDraft: {
            updateMany: transitionDraft,
            findUnique: jest.fn(),
          },
          characterActionLog: { create: jest.fn() },
        }),
    );
    const repository = makeRepository({ $transaction: transaction });

    await expect(
      repository.regenerateShot({
        draftId: "draft-1",
        source,
        prompt: source.prompt,
      }),
    ).resolves.toEqual({ outcome: "stale-job" });
    expect(transitionDraft).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });

  it("switches the selected output and cached job media atomically", async () => {
    const updateOutputs = jest.fn().mockResolvedValue({ count: 1 });
    const updateJob = jest.fn().mockResolvedValue({});
    const transaction = jest.fn(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          generationJobOutput: { updateMany: updateOutputs },
          generationJob: { update: updateJob },
        }),
    );
    const repository = makeRepository({ $transaction: transaction });

    await repository.selectShotOutput("job-1", "media-2");

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(updateOutputs).toHaveBeenNthCalledWith(1, {
      where: { jobId: "job-1" },
      data: { selected: false },
    });
    expect(updateOutputs).toHaveBeenNthCalledWith(2, {
      where: { jobId: "job-1", mediaId: "media-2" },
      data: { selected: true },
    });
    expect(updateJob).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { outputMediaId: "media-2" },
    });
  });
});
