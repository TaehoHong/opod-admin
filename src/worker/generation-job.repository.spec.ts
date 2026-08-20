import { GenerationJobRepository } from "./generation-job.repository";

describe("GenerationJobRepository", () => {
  it("loads only active identity references for generation", async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const repository = new GenerationJobRepository({
      generationJob: { findUnique },
    } as never);

    await repository.findForProcessing("job-1");

    expect(
      findUnique.mock.calls[0][0].include.character.include.visualProfile
        .include.referenceMedia.where,
    ).toEqual({ isActive: true });
  });

  it("stores provider progress as running-job metadata", async () => {
    const executeRaw = jest.fn().mockResolvedValue(1);
    const repository = new GenerationJobRepository({
      $executeRaw: executeRaw,
    } as never);

    await (
      repository as unknown as {
        recordProviderProgress(input: {
          jobId: string;
          progress: Record<string, unknown>;
        }): Promise<void>;
      }
    ).recordProviderProgress({
      jobId: "job-1",
      progress: {
        status: "running",
        phase: "generating",
        stage: "face",
        progress: 0.58,
      },
    });

    const [sql, progressJson, jobId] = executeRaw.mock.calls[0];
    expect(sql.join(" ")).toContain("jsonb_set");
    expect(sql.join(" ")).toContain("status = 'running'");
    expect(JSON.parse(progressJson)).toEqual({
      status: "running",
      phase: "generating",
      stage: "face",
      progress: 0.58,
    });
    expect(jobId).toBe("job-1");
  });

  // V4: 프롬프트당 1장이라 고를 것이 없다 — 유일한 출력이 곧 게시 이미지여야
  // 게시(outputMediaId)·평가(selected)·캡션 단계가 사람 없이 이어진다.
  // 후보가 여럿이면 종전대로 미선택으로 두어 v3 검수 흐름을 깨지 않는다.
  describe("persistSuccess", () => {
    function tx() {
      let mediaSeq = 0;
      const t = {
        media: {
          create: jest.fn(async () => ({ id: `media-${++mediaSeq}` })),
        },
        generationJob: {
          updateMany: jest.fn(async () => ({ count: 1 })),
        },
        generationJobOutput: {
          createMany: jest.fn<
            Promise<object>,
            [{ data: { selected: boolean }[] }]
          >(async () => ({})),
        },
        llmLog: { findFirst: jest.fn(async () => null) },
        llmLogMedia: { createMany: jest.fn(async () => ({})) },
        characterActionLog: { create: jest.fn(async () => ({})) },
      };
      return t;
    }
    const file = (n: number) => ({
      url: `https://cdn.local/${n}.png`,
      storageKey: null,
      contentType: "image/png",
      byteSize: 10,
      image: { width: 1, height: 1 },
    });

    it("selects the sole output as the shot image", async () => {
      const t = tx();
      const repository = new GenerationJobRepository({
        $transaction: (fn: (t: unknown) => Promise<void>) => fn(t),
      } as never);

      await repository.persistSuccess({
        jobId: "job-1",
        characterId: "character-1",
        files: [file(1)] as never,
        costUsd: 0,
        providerName: "fal",
      });

      expect(t.generationJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ outputMediaId: "media-1" }),
        }),
      );
      expect(t.generationJobOutput.createMany).toHaveBeenCalledWith({
        data: [
          {
            jobId: "job-1",
            mediaId: "media-1",
            candidateIndex: 0,
            selected: true,
          },
        ],
      });
    });

    it("leaves multiple candidates unselected for human review", async () => {
      const t = tx();
      const repository = new GenerationJobRepository({
        $transaction: (fn: (t: unknown) => Promise<void>) => fn(t),
      } as never);

      await repository.persistSuccess({
        jobId: "job-1",
        characterId: "character-1",
        files: [file(1), file(2)] as never,
        costUsd: 0,
        providerName: "fal",
      });

      expect(t.generationJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ outputMediaId: null }),
        }),
      );
      expect(
        t.generationJobOutput.createMany.mock.calls[0][0].data.map(
          (row) => row.selected,
        ),
      ).toEqual([false, false]);
    });
  });
});
