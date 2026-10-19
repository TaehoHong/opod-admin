import { Injectable } from "@nestjs/common";
import { CharacterInfluencerService } from "../influencers/character-influencer.service";
import { InfluencerMediaService } from "../influencers/influencer-media.service";
import { GenerationSettingsService } from "../settings/generation-settings.service";
import { LlmLogService } from "../llm-logs/llm-log.service";
import { ReferenceEmbeddingClient } from "../shared/ai/reference-embedding";

export type InfluencerReferenceRetrievalInput = {
  characterId: string;
  requestId: string;
  accountConcept: string;
  imageStyle: string;
  constraints: string;
  operatorRequest?: string;
  usedSources?: { mediaIds: string[]; sha256s: string[] };
  excludedMediaIds?: string[];
  excludedSha256s?: string[];
  limit?: number;
};

@Injectable()
export class InfluencerReferenceRetrievalService {
  constructor(
    private readonly links: CharacterInfluencerService,
    private readonly media: InfluencerMediaService,
    private readonly settings: GenerationSettingsService,
    private readonly logs: LlmLogService,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async retrieve(input: InfluencerReferenceRetrievalInput) {
    const linked = await this.links.list([input.characterId]);
    if (!linked.length) return [];
    const settings = await this.settings.resolveChatSettings();
    const model = settings.embeddingModel?.trim();
    const apiUrl = settings.embeddingApiUrl?.trim();
    if (!model || !apiUrl)
      throw new Error("reference_embedding_not_configured");
    const client = new ReferenceEmbeddingClient(
      { apiUrl, apiKey: settings.embeddingApiKey, model },
      this.logs,
      this.fetchFn,
    );
    const query = JSON.stringify({
      accountConcept: input.accountConcept,
      imageStyle: input.imageStyle,
      constraints: input.constraints,
      operatorRequest: input.operatorRequest ?? "",
    });
    const [embedding] = await client.embed(
      [
        `Instruct: Retrieve reference image compositions and poses suitable for the described account and request.\nQuery:${query}`,
      ],
      {
        requestId: input.requestId,
        characterId: input.characterId,
        metadata: { purpose: "influencer_reference_retrieval", query },
      },
    );
    return this.media.searchReferences({
      influencerIds: linked.map((link) => link.influencerId),
      embedding,
      model,
      excludedMediaIds: [
        ...(input.usedSources?.mediaIds ?? []),
        ...(input.excludedMediaIds ?? []),
      ].map((id) => BigInt(id)),
      excludedSha256s: [
        ...(input.usedSources?.sha256s ?? []),
        ...(input.excludedSha256s ?? []),
      ],
      limit: input.limit ?? 12,
    });
  }

  async findReadSources(
    characterId: string,
    sources: { mediaId: string; sha256: string }[],
  ) {
    const linked = await this.links.list([characterId]);
    return this.media.findReadSources(
      linked.map((link) => link.influencerId),
      sources,
    );
  }
}
