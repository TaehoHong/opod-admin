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
});
