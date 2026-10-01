import { MemoryRetrievalService } from "./memory-retrieval.service";

const model = "fixture-model";
const vector = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
function setup() {
  const sources = [
    {
      id: "visual",
      characterId: "c",
      content: "턱선 길이 블루블랙 단발",
      type: "fact",
      kind: "fact",
      injection: "retrieved",
      indexed: true,
      embeddingModel: model,
      sourceSha256: "vhash",
      embeddedTextSha256: "vhash",
    },
    {
      id: "event",
      characterId: "c",
      content: "어제 밤에 산책했다",
      type: "fact",
      kind: "event",
      injection: "retrieved",
      indexed: true,
      embeddingModel: model,
      sourceSha256: "ehash",
      embeddedTextSha256: "ehash",
    },
  ];
  const characters = {
    listMemoryEmbeddingSources: jest
      .fn()
      .mockImplementation(async () => sources),
    searchMemoryEmbeddings: jest
      .fn()
      .mockImplementation(async (_id, _vector, _model, factsOnly) =>
        factsOnly
          ? [{ id: "visual", sourceSha256: "vhash", score: 0.8 }]
          : [
              { id: "event", sourceSha256: "ehash", score: 0.1 },
              { id: "visual", sourceSha256: "vhash", score: 0.15 },
            ],
      ),
    saveMemoryEmbedding: jest.fn().mockResolvedValue(true),
  };
  const fetchFn = jest.fn(async () =>
    Response.json({
      model,
      data: [
        { index: 0, embedding: vector },
        { index: 1, embedding: vector },
        { index: 2, embedding: vector },
        { index: 3, embedding: vector },
      ],
    }),
  );
  const logs = { runJsonFetch: jest.fn(async ({ execute }) => execute()) };
  const settings = {
    resolveChatSettings: jest.fn(async () => ({
      embeddingApiUrl: "https://embed.test/embeddings",
      embeddingModel: model,
    })),
  };
  const service = new MemoryRetrievalService(
    characters as never,
    settings as never,
    logs as never,
    fetchFn as never,
  );
  const input = {
    characterId: "c",
    requestId: "r",
    stage: "image_plan",
    query: "카페 사진",
    memories: sources.map((source) => ({
      sourceId: source.id,
      type: "fact",
      content: source.content,
      kind: source.kind,
      injection: source.injection,
    })),
  };
  return { service, input, sources, characters, fetchFn, logs };
}

describe("Canon semantic retrieval", () => {
  it("retrieves fixed visual facts without an unrelated event and records both query scores", async () => {
    const { service, input, logs } = setup();
    const result = await service.retrieve(input);
    expect(result.selectedIds).toEqual(["visual"]);
    expect(result.trace.queries[0].candidates).toEqual([
      {
        id: "event",
        sourceSha256: "ehash",
        score: 0.1,
        cutoff: 0.52,
        selected: false,
        reason: "below_relevance_threshold",
      },
      {
        id: "visual",
        sourceSha256: "vhash",
        score: 0.15,
        cutoff: 0.3,
        selected: false,
        reason: "below_relevance_threshold",
      },
    ]);
    expect(result.trace.queries[1].candidates[0].selected).toBe(true);
    expect(logs.runJsonFetch.mock.calls[0][0].type).toBe(
      "admin.memory.embedding",
    );
  });
  it("returns no memories when the intent has no relevant matches", async () => {
    const { service, input, fetchFn } = setup();
    fetchFn.mockImplementation(async () =>
      Response.json({ model, data: [{ index: 0, embedding: vector }] }),
    );
    const result = await service.retrieve({ ...input, stage: "post_plan" });
    expect(result.selectedIds).toEqual([]);
  });
  it("rejects weak generic overlap even when its score passes the absolute floor", async () => {
    const { service, input, characters, fetchFn } = setup();
    fetchFn.mockImplementation(async () =>
      Response.json({ model, data: [{ index: 0, embedding: vector }] }),
    );
    characters.searchMemoryEmbeddings.mockResolvedValue([
      { id: "visual", sourceSha256: "vhash", score: 0.8 },
      { id: "event", sourceSha256: "ehash", score: 0.4 },
    ]);
    const result = await service.retrieve({ ...input, stage: "post_plan" });
    expect(result.selectedIds).toEqual(["visual"]);
    expect(result.trace.queries[0].cutoff).toBeCloseTo(0.6);
    expect(result.trace.queries[0].candidates[1]).toMatchObject({
      selected: false,
      reason: "below_relevance_threshold",
    });
  });
  it("keeps both strongly relevant episodes for a compound intent rather than forcing one", async () => {
    const { service, input, sources, characters, fetchFn } = setup();
    sources[0].kind = "event";
    input.memories[0].kind = "event";
    fetchFn.mockImplementation(async () =>
      Response.json({ model, data: [{ index: 0, embedding: vector }] }),
    );
    characters.searchMemoryEmbeddings.mockResolvedValue([
      { id: "visual", sourceSha256: "vhash", score: 0.695 },
      { id: "event", sourceSha256: "ehash", score: 0.54 },
    ]);
    const result = await service.retrieve({ ...input, stage: "post_plan" });
    expect(result.selectedIds).toEqual(["visual", "event"]);
  });
  it("excludes a weak past event while retaining equally scored stable context", async () => {
    const { service, input, characters, fetchFn } = setup();
    fetchFn.mockImplementation(async () =>
      Response.json({ model, data: [{ index: 0, embedding: vector }] }),
    );
    characters.searchMemoryEmbeddings.mockResolvedValue([
      { id: "visual", sourceSha256: "vhash", score: 0.44 },
      { id: "event", sourceSha256: "ehash", score: 0.427 },
    ]);
    const result = await service.retrieve({ ...input, stage: "post_plan" });
    expect(result.selectedIds).toEqual(["visual"]);
    expect(result.trace.queries[0].candidates[1]).toMatchObject({
      cutoff: 0.52,
      selected: false,
    });
  });
  it("stops before model calls when a stored source hash no longer matches", async () => {
    const { service, input, sources, fetchFn } = setup();
    sources[0].embeddedTextSha256 = "old-hash";
    await expect(service.retrieve(input)).rejects.toThrow(
      "memory_embedding_index_required:visual",
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it("rejects a routing/content change between search and prompt assembly", async () => {
    const { service, input, characters, sources } = setup();
    characters.listMemoryEmbeddingSources
      .mockResolvedValueOnce(sources)
      .mockResolvedValueOnce([
        { ...sources[0], injection: "always" },
        sources[1],
      ]);
    await expect(service.retrieve(input)).rejects.toThrow(
      "memory_source_changed_during_search",
    );
  });
  it("indexes only a missing document and preserves the exact document text", async () => {
    const { service, sources, fetchFn, characters, logs } = setup();
    sources[1].indexed = false;
    fetchFn.mockImplementation(async () =>
      Response.json({ model, data: [{ index: 0, embedding: vector }] }),
    );
    const result = await service.indexMissing(["event"]);
    expect(result).toEqual({
      model,
      dimensions: 1024,
      saved: ["event"],
      reused: 1,
    });
    expect(logs.runJsonFetch.mock.calls[0][0].requestJson.input).toEqual([
      "어제 밤에 산책했다",
    ]);
    expect(characters.saveMemoryEmbedding.mock.calls[0][0].content).toBe(
      "어제 밤에 산책했다",
    );
  });
});
