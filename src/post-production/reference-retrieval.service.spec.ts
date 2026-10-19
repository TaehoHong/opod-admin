import { ReferenceRetrievalService } from "./reference-retrieval.service";
const vector = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
function fixture() {
  const sources = Array.from({ length: 9 }, (_, i) => ({
    ownerId: "profile",
    mediaId: `id-${i}`,
    description: `caption-${i}`,
    embeddingModel: "fixture",
    indexed: true,
    compositionAnalysis: {
      version: "person-composition-v1",
      model: "vision-fixture",
      content: {
        personCount: 1,
        framing: "상반신",
        faceDirection: "정면",
        bodyDirection: "정면",
        pose: "서 있음",
        hands: null,
        gaze: "카메라",
        camera: "눈높이",
        placement: "중앙",
        occlusion: null,
      },
    },
  }));
  const ranked = sources.map((s) => ({
    id: s.mediaId,
    description: s.description,
    score: 0.5,
  }));
  const visual = {
    listReferenceEmbeddingSources: jest.fn().mockResolvedValue(sources),
    searchReferenceEmbeddings: jest
      .fn()
      .mockResolvedValueOnce(ranked)
      .mockResolvedValueOnce([ranked[8], ...ranked.slice(0, 8)])
      .mockResolvedValueOnce([
        ranked[7],
        ...ranked.filter((r) => r.id !== "id-7"),
      ]),
    saveReferenceEmbedding: jest.fn().mockResolvedValue(true),
  };
  const locations = {
    listReferenceEmbeddingSources: jest.fn().mockResolvedValue([]),
    searchReferenceEmbeddings: jest.fn(),
    saveReferenceEmbedding: jest.fn(),
  };
  const fetchFn = jest.fn(async (_url, options) => {
    const body = JSON.parse(options.body);
    return Response.json({
      model: "fixture",
      data: body.input.map((_: string, index: number) => ({
        index,
        embedding: vector,
      })),
    });
  });
  const service = new ReferenceRetrievalService(
    visual as never,
    locations as never,
    {
      resolveChatSettings: async () => ({
        embeddingApiUrl: "https://fixture.test/embeddings",
        embeddingModel: "fixture",
      }),
    } as never,
    {
      runJsonFetch: ({ execute }: { execute: () => Promise<Response> }) =>
        execute(),
    } as never,
    fetchFn as never,
  );
  const input = {
    characterId: "character",
    requestId: "draft",
    name: "Character",
    premise: "Scene",
    purpose: "purpose",
    locationIds: [],
  };
  return { service, input, visual, locations, fetchFn, sources };
}
describe("reference retrieval", () => {
  it("retains face/body anchors within a six candidate budget and records their scores", async () => {
    const { service, input, visual, fetchFn } = fixture();
    const result = await service.retrieve(input);
    expect(result.identityReferences.map((r) => r.id)).toEqual([
      "id-8",
      "id-7",
      "id-0",
      "id-1",
      "id-2",
      "id-3",
    ]);
    expect(result.trace.identitySelected[0]).toMatchObject({
      purpose: "face_identity",
      score: 0.5,
    });
    expect(visual.searchReferenceEmbeddings).toHaveBeenCalledWith(
      "character",
      vector,
      "fixture",
      20,
    );
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).input[0]).toContain(
      "Query:Scene\npurpose",
    );
  });
  it("uses the planned location query and leaves unindexed optional place references unused", async () => {
    const { service, input, locations, fetchFn } = fixture();
    locations.listReferenceEmbeddingSources.mockResolvedValue([
      {
        ownerId: "cafe",
        mediaId: "cafe-photo",
        description: "window",
        indexed: false,
        embeddingModel: null,
      },
    ]);
    const result = await service.retrieve({
      ...input,
      locationDescription: "카페 창가",
      locationIds: ["cafe"],
    });
    expect(result.locationReferences).toEqual({ cafe: [] });
    expect(result.trace.locationReferencesUnavailable).toEqual([
      { locationId: "cafe", mediaId: "cafe-photo" },
    ]);
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).input[0]).toContain(
      "Query:카페 창가\nScene\npurpose",
    );
    expect(locations.searchReferenceEmbeddings).not.toHaveBeenCalled();
  });
  it("requires current index coverage before any provider or planner call", async () => {
    const { service, input, sources, fetchFn } = fixture();
    sources[0].indexed = false;
    await expect(service.retrieve(input)).rejects.toThrow(
      "reference_embedding_index_required",
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it("detects a caption edit during retrieval", async () => {
    const { service, input, visual, sources } = fixture();
    visual.listReferenceEmbeddingSources
      .mockResolvedValueOnce(sources)
      .mockResolvedValueOnce(sources.map((s) => ({ ...s, indexed: false })));
    await expect(service.retrieve(input)).rejects.toThrow(
      "reference_embedding_index_changed",
    );
  });
  it("stops index writes when the caption CAS fails", async () => {
    const { service, visual } = fixture();
    visual.saveReferenceEmbedding.mockResolvedValueOnce(false);
    await expect(service.indexAll()).rejects.toThrow(
      "reference_caption_changed",
    );
    expect(visual.saveReferenceEmbedding).toHaveBeenCalledTimes(1);
  });
});
