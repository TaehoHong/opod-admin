import { CharacterInfluencerService } from "../influencers/character-influencer.service";
import { InfluencerMediaService } from "../influencers/influencer-media.service";
import { GenerationSettingsService } from "../settings/generation-settings.service";
import { LlmLogService } from "../llm-logs/llm-log.service";
import { InfluencerReferenceRetrievalService } from "./influencer-reference-retrieval.service";

const input = {
  characterId: "character",
  requestId: "request",
  accountConcept: "daily walks",
  imageStyle: "casual",
  constraints: "outdoors",
  operatorRequest: "park",
};
function setup(linked = [{ influencerId: 7n }]) {
  const links = { list: jest.fn(async () => linked) };
  const media = {
    searchReferences: jest.fn(async () => [{ mediaId: "91" }]),
    findReadSources: jest.fn(async () => []),
  };
  const settings = {
    resolveChatSettings: jest.fn(async () => ({
      embeddingApiUrl: "https://embedding.invalid",
      embeddingModel: "model",
    })),
  };
  const fetchFn = jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          model: "model",
          data: [{ index: 0, embedding: Array(1024).fill(0.1) }],
        }),
        { status: 200 },
      ),
  );
  const logs = {
    runJsonFetch: jest.fn(
      async ({ execute }: { execute: () => Promise<Response> }) => execute(),
    ),
  };
  const service = new InfluencerReferenceRetrievalService(
    links as unknown as CharacterInfluencerService,
    media as unknown as InfluencerMediaService,
    settings as unknown as GenerationSettingsService,
    logs as unknown as LlmLogService,
    fetchFn as typeof fetch,
  );
  return { service, media, fetchFn, logs };
}
describe("influencer reference retrieval", () => {
  it("returns no candidates without linked accounts and makes no embedding request", async () => {
    const { service, fetchFn } = setup([]);
    await expect(service.retrieve(input)).resolves.toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it("restricts search to linked accounts and excludes published and previously seen originals", async () => {
    const { service, media, fetchFn } = setup();
    await expect(
      service.retrieve({
        ...input,
        usedSources: { mediaIds: ["11"], sha256s: ["used"] },
        excludedMediaIds: ["12"],
        excludedSha256s: ["seen"],
      }),
    ).resolves.toEqual([{ mediaId: "91" }]);
    expect(media.searchReferences).toHaveBeenCalledWith(
      expect.objectContaining({
        influencerIds: [7n],
        model: "model",
        limit: 12,
        excludedMediaIds: [11n, 12n],
        excludedSha256s: ["used", "seen"],
      }),
    );
    const request = JSON.parse(
      (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1]
        .body as string,
    ) as { input: string[] };
    for (const value of [
      input.accountConcept,
      input.imageStyle,
      input.constraints,
      input.operatorRequest,
    ])
      expect(request.input[0]).toContain(value);
  });
  it("rejects a mismatched embedding model before candidate search", async () => {
    const { service, media, fetchFn } = setup();
    fetchFn.mockResolvedValueOnce(
      new Response(JSON.stringify({ model: "wrong", data: [] }), {
        status: 200,
      }),
    );
    await expect(service.retrieve(input)).rejects.toThrow(
      "model or result count mismatch",
    );
    expect(media.searchReferences).not.toHaveBeenCalled();
  });
});

describe("influencer original read validation", () => {
  it("rejects source bytes changed after selection even when the media ID still exists", async () => {
    const repository = {
      findReadSources: async () => [{ id: 91n, sha256: "changed" }],
    };
    const service = new InfluencerMediaService(
      repository as unknown as ConstructorParameters<
        typeof InfluencerMediaService
      >[0],
    );
    await expect(
      service.findReadSources([7n], [{ mediaId: "91", sha256: "selected" }]),
    ).rejects.toThrow("reference_source_changed");
  });
  it("rejects a source missing from the current linked account scope", async () => {
    const repository = { findReadSources: async () => [] };
    const service = new InfluencerMediaService(
      repository as unknown as ConstructorParameters<
        typeof InfluencerMediaService
      >[0],
    );
    await expect(
      service.findReadSources([], [{ mediaId: "91", sha256: "selected" }]),
    ).rejects.toThrow("reference_source_changed");
  });
});
