import { Injectable } from "@nestjs/common";
import { VisualProfileService } from "../characters/visual-profile.service";
import { LocationsService } from "../locations/locations.service";
import { GenerationSettingsService } from "../settings/generation-settings.service";
import { LlmLogService } from "../llm-logs/llm-log.service";
import {
  RankedReference,
  ReferenceEmbeddingClient,
} from "../shared/ai/reference-embedding";

export class ReferenceRetrievalError extends Error {}
export type ReferenceRetrievalInput = {
  characterId: string;
  requestId: string;
  name: string;
  premise: string;
  purpose: string;
  operatorRequest?: string;
  locationIds: string[];
};

@Injectable()
export class ReferenceRetrievalService {
  constructor(
    private readonly visual: VisualProfileService,
    private readonly locations: LocationsService,
    private readonly settings: GenerationSettingsService,
    private readonly logs: LlmLogService,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async client() {
    const settings = await this.settings.resolveChatSettings();
    if (!settings.embeddingApiUrl?.trim() || !settings.embeddingModel?.trim())
      throw new ReferenceRetrievalError("reference_embedding_not_configured");
    return {
      model: settings.embeddingModel,
      client: new ReferenceEmbeddingClient(
        {
          apiUrl: settings.embeddingApiUrl,
          apiKey: settings.embeddingApiKey,
          model: settings.embeddingModel,
        },
        this.logs,
        this.fetchFn,
      ),
    };
  }

  // Explicit maintenance operation; caption text is passed unchanged and CAS-protected.
  async indexAll() {
    const { client, model } = await this.client();
    const [identity, location] = await Promise.all([
      this.visual.listReferenceEmbeddingSources(),
      this.locations.listReferenceEmbeddingSources(),
    ]);
    const sources = [
      ...identity.map((source) => ({ ...source, kind: "identity" as const })),
      ...location.map((source) => ({ ...source, kind: "location" as const })),
    ];
    const saved: { kind: string; ownerId: string; mediaId: string }[] = [];
    for (let offset = 0; offset < sources.length; offset += 4) {
      const batch = sources.slice(offset, offset + 4);
      const vectors = await client.embed(
        batch.map((source) => source.description),
        {
          inputMediaIds: batch.map((source) => source.mediaId),
          metadata: {
            purpose: "reference_caption_index",
            ownerIds: batch.map((source) => source.ownerId),
          },
        },
      );
      for (let index = 0; index < batch.length; index++) {
        const source = batch[index];
        const owner = source.kind === "identity" ? this.visual : this.locations;
        if (
          !(await owner.saveReferenceEmbedding({
            ...source,
            embedding: vectors[index],
            model,
          }))
        )
          throw new ReferenceRetrievalError(
            `reference_caption_changed:${source.kind}:${source.mediaId}`,
          );
        saved.push({
          kind: source.kind,
          ownerId: source.ownerId,
          mediaId: source.mediaId,
        });
      }
    }
    return { model, dimensions: 1024, saved };
  }

  async retrieve(input: ReferenceRetrievalInput) {
    try {
      const { client, model } = await this.client();
      const [identitySources, allLocations] = await Promise.all([
        this.visual.listReferenceEmbeddingSources(input.characterId),
        this.locations.listReferenceEmbeddingSources(input.characterId),
      ]);
      const locationSources = allLocations.filter((source) =>
        input.locationIds.includes(source.ownerId),
      );
      const sources = [...identitySources, ...locationSources];
      if (
        sources.some(
          (source) => !source.indexed || source.embeddingModel !== model,
        )
      )
        throw new ReferenceRetrievalError("reference_embedding_index_required");
      const queries = [
        {
          purpose: "scene",
          query: [input.premise, input.purpose, input.operatorRequest]
            .filter(Boolean)
            .join("\n"),
        },
        {
          purpose: "face_identity",
          query: `${input.name}: 얼굴 정체성, 눈 코 입, 얼굴 윤곽, 머리 모양과 머리 색을 확인할 수 있는 사진`,
        },
        {
          purpose: "body_identity",
          query: `${input.name}: 전신 체형, 신체 비율, 자세를 확인할 수 있는 사진`,
        },
      ];
      const vectors = sources.length
        ? await client.embed(
            queries.map(
              ({ query }) =>
                `Instruct: Retrieve reference image captions relevant to the described scene or identity evidence.\nQuery:${query}`,
            ),
            {
              requestId: input.requestId,
              characterId: input.characterId,
              metadata: { purpose: "reference_retrieval", queries },
            },
          )
        : [];
      const identityRanks: RankedReference[][] = [];
      if (identitySources.length) {
        for (const vector of vectors)
          identityRanks.push(
            await this.visual.searchReferenceEmbeddings(
              input.characterId,
              vector,
              model,
              20,
            ),
          );
      }
      const selected = new Map<string, RankedReference & { purpose: string }>();
      for (const [rankIndex, purpose] of [
        [1, "face_identity"],
        [2, "body_identity"],
        [0, "scene"],
      ] as const) {
        for (const reference of (identityRanks[rankIndex] ?? []).slice(
          0,
          rankIndex === 0 ? 20 : 1,
        )) {
          if (!selected.has(reference.id))
            selected.set(reference.id, { ...reference, purpose });
          if (selected.size === 6) break;
        }
      }
      const locationRanks: Record<string, RankedReference[]> = {};
      for (const locationId of input.locationIds) {
        locationRanks[locationId] = locationSources.some(
          (source) => source.ownerId === locationId,
        )
          ? await this.locations.searchReferenceEmbeddings(
              input.characterId,
              locationId,
              vectors[0],
              model,
              4,
            )
          : [];
      }
      const [identityAfter, locationsAfter] = await Promise.all([
        this.visual.listReferenceEmbeddingSources(input.characterId),
        this.locations.listReferenceEmbeddingSources(input.characterId),
      ]);
      if (
        JSON.stringify(identityAfter) !== JSON.stringify(identitySources) ||
        JSON.stringify(
          locationsAfter.filter((source) =>
            input.locationIds.includes(source.ownerId),
          ),
        ) !== JSON.stringify(locationSources)
      )
        throw new ReferenceRetrievalError("reference_embedding_index_changed");
      return {
        identityReferences: [...selected.values()].map(
          ({ id, description }) => ({ id, description }),
        ),
        locationReferences: Object.fromEntries(
          Object.entries(locationRanks).map(([id, ranks]) => [
            id,
            ranks.map(({ id, description }) => ({ id, description })),
          ]),
        ),
        trace: {
          model,
          dimensions: 1024,
          queries,
          identityCandidates: identityRanks,
          identitySelected: [...selected.values()],
          locationSelected: locationRanks,
        },
      };
    } catch (error) {
      if (error instanceof ReferenceRetrievalError) throw error;
      throw new ReferenceRetrievalError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
