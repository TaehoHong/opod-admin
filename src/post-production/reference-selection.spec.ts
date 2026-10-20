import {
  parseReferenceSelectionDecision,
  selectReferences,
} from "./reference-selection";

const candidate = (mediaId: string, sha256 = `hash-${mediaId}`) => ({
  mediaId,
  sha256,
  sourceUrl: `https://example.test/${mediaId}`,
});
const noMatch = {
  status: "no_match",
  selections: [],
  shortfallReason: "No suitable image",
};
const selected = (...ids: string[]) => ({
  status: "selected",
  selections: ids.map((mediaId) => ({ mediaId })),
  shortfallReason: "",
});

describe("selectReferences", () => {
  it("reads legacy selections with reasons while returning only selected IDs", () => {
    expect(
      parseReferenceSelectionDecision(
        {
          status: "selected",
          selections: [{ mediaId: "1", reason: "Legacy reason" }],
          shortfallReason: "",
        },
        [candidate("1")],
      ),
    ).toEqual(selected("1"));
  });
  it("spends at most one model call by default after no_match", async () => {
    const retrieveCandidates = jest
      .fn()
      .mockResolvedValueOnce([candidate("1")])
      .mockResolvedValueOnce([candidate("2")]);
    const selectCandidates = jest.fn().mockResolvedValue(noMatch);
    const result = await selectReferences({
      retrieveCandidates,
      selectCandidates,
    });
    expect(result.status).toBe("no_match");
    expect(result.attempts).toEqual([
      { candidates: [candidate("1")], decision: noMatch },
    ]);
    expect(selectCandidates).toHaveBeenCalledTimes(1);
    expect(retrieveCandidates).toHaveBeenCalledTimes(1);
  });

  it("stops after three valid no_match decisions at the configured limit", async () => {
    const retrieveCandidates = jest
      .fn()
      .mockResolvedValueOnce([candidate("1")])
      .mockResolvedValueOnce([candidate("2")])
      .mockResolvedValueOnce([candidate("3")]);
    const selectCandidates = jest.fn().mockResolvedValue(noMatch);
    const result = await selectReferences(
      { retrieveCandidates, selectCandidates },
      { maxAttempts: 3 },
    );
    expect(result.status).toBe("no_match");
    expect(result.attempts).toHaveLength(3);
    expect(selectCandidates).toHaveBeenCalledTimes(3);
    expect(retrieveCandidates).toHaveBeenCalledTimes(3);
  });

  it("returns selected metadata in model order and stops immediately", async () => {
    const retrieveCandidates = jest
      .fn()
      .mockResolvedValue([candidate("1"), candidate("2")]);
    const selectCandidates = jest.fn().mockResolvedValue(selected("2", "1"));
    const result = await selectReferences(
      { retrieveCandidates, selectCandidates },
      { maxAttempts: 3 },
    );
    expect(result.selectedCandidates).toEqual([candidate("2"), candidate("1")]);
    expect(result.status).toBe("selected");
    expect(retrieveCandidates).toHaveBeenCalledTimes(1);
    expect(selectCandidates).toHaveBeenCalledTimes(1);
  });

  it("caps shown candidates at twelve even when retrieval exceeds its requested limit", async () => {
    const candidates = Array.from({ length: 14 }, (_, index) =>
      candidate(String(index)),
    );
    const retrieveCandidates = jest.fn().mockResolvedValue(candidates);
    const selectCandidates = jest.fn().mockResolvedValue(noMatch);
    const result = await selectReferences({
      retrieveCandidates,
      selectCandidates,
    });
    expect(result.attempts[0].candidates).toEqual(candidates.slice(0, 12));
    expect(selectCandidates).toHaveBeenCalledWith(candidates.slice(0, 12));
    expect(retrieveCandidates).toHaveBeenCalledWith({
      limit: 12,
      excludedMediaIds: [],
      excludedSha256: [],
    });
  });

  it("excludes repeated IDs and files within and across attempts and passes exclusions to retrieval", async () => {
    const retrieveCandidates = jest
      .fn()
      .mockResolvedValueOnce([
        candidate("1"),
        candidate("1", "other-hash"),
        candidate("copy", "hash-1"),
        candidate("2"),
      ])
      .mockResolvedValueOnce([
        candidate("1", "new-hash"),
        candidate("copy-again", "hash-2"),
        candidate("3"),
      ]);
    const selectCandidates = jest
      .fn()
      .mockResolvedValueOnce(noMatch)
      .mockResolvedValueOnce(selected("3"));
    const result = await selectReferences(
      { retrieveCandidates, selectCandidates },
      { maxAttempts: 3 },
    );
    expect(result.attempts.map((attempt) => attempt.candidates)).toEqual([
      [candidate("1"), candidate("2")],
      [candidate("3")],
    ]);
    expect(retrieveCandidates).toHaveBeenNthCalledWith(2, {
      limit: 12,
      excludedMediaIds: ["1", "2"],
      excludedSha256: ["hash-1", "hash-2"],
    });
    expect(result.selectedCandidates).toEqual([candidate("3")]);
    expect(selectCandidates).toHaveBeenCalledTimes(2);
  });

  it("stops before the first model call when retrieval is empty", async () => {
    const retrieveCandidates = jest.fn().mockResolvedValue([]);
    const selectCandidates = jest.fn();
    const result = await selectReferences(
      { retrieveCandidates, selectCandidates },
      { maxAttempts: 3 },
    );
    expect(result).toEqual({
      status: "no_candidates",
      selectedCandidates: [],
      attempts: [{ candidates: [], decision: null }],
    });
    expect(selectCandidates).not.toHaveBeenCalled();
    expect(retrieveCandidates).toHaveBeenCalledTimes(1);
  });

  it("stops without a model call when no unseen candidates remain", async () => {
    const retrieveCandidates = jest.fn().mockResolvedValue([candidate("1")]);
    const selectCandidates = jest.fn().mockResolvedValue(noMatch);
    const result = await selectReferences(
      { retrieveCandidates, selectCandidates },
      { maxAttempts: 3 },
    );
    expect(result.status).toBe("no_candidates");
    expect(result.attempts[1]).toEqual({ candidates: [], decision: null });
    expect(selectCandidates).toHaveBeenCalledTimes(1);
    expect(retrieveCandidates).toHaveBeenCalledTimes(2);
  });

  it.each([
    undefined,
    { ...noMatch, shortfallReason: " " },
    { ...noMatch, selections: [{ mediaId: "1", reason: "pose" }] },
    selected(),
    selected("1", "2", "3", "4"),
    selected("outside"),
    selected("1", "1"),
  ])(
    "rejects malformed or ungrounded output without retry: %j",
    async (response) => {
      const retrieveCandidates = jest
        .fn()
        .mockResolvedValue([
          candidate("1"),
          candidate("2"),
          candidate("3"),
          candidate("4"),
        ]);
      const selectCandidates = jest.fn().mockResolvedValue(response);
      await expect(
        selectReferences(
          { retrieveCandidates, selectCandidates },
          { maxAttempts: 3 },
        ),
      ).rejects.toThrow();
      expect(selectCandidates).toHaveBeenCalledTimes(1);
      expect(retrieveCandidates).toHaveBeenCalledTimes(1);
    },
  );

  it("propagates provider errors without retry", async () => {
    const error = new Error("provider unavailable");
    const retrieveCandidates = jest.fn().mockResolvedValue([candidate("1")]);
    const selectCandidates = jest.fn().mockRejectedValue(error);
    await expect(
      selectReferences(
        { retrieveCandidates, selectCandidates },
        { maxAttempts: 3 },
      ),
    ).rejects.toBe(error);
    expect(selectCandidates).toHaveBeenCalledTimes(1);
    expect(retrieveCandidates).toHaveBeenCalledTimes(1);
  });

  it.each([0, 4, 1.5, NaN])(
    "rejects invalid attempt limits before retrieval: %s",
    async (maxAttempts) => {
      const retrieveCandidates = jest.fn();
      const selectCandidates = jest.fn();
      await expect(
        selectReferences(
          { retrieveCandidates, selectCandidates },
          { maxAttempts },
        ),
      ).rejects.toThrow("maxAttempts");
      expect(retrieveCandidates).not.toHaveBeenCalled();
      expect(selectCandidates).not.toHaveBeenCalled();
    },
  );
});
