import { ConflictException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { InfluencerMediaService } from "../influencers/influencer-media.service";
import type { InfluencerMediaRow } from "../influencers/influencer-media.repository";
import { CharacterInfluencerService } from "../influencers/character-influencer.service";
import { LlmLogContext, LlmLogService } from "../llm-logs/llm-log.service";
import { ImageCompositionAnalyzer } from "../post-production/image-composition-analyzer";
import { MediaBytesReader } from "../post-production/reference-captioner";
import { selectCharacterVisuals } from "../post-production/reference-visual-selection";
import { ReferencePromptImage } from "../post-production/reference-image-prompt";
import { GenerationSettingsService } from "../settings/generation-settings.service";
import {
  COMPOSITION_FIELDS,
  COMPOSITION_VERSION,
  compositionText,
  CompositionAnalysis,
  parseComposition,
  readCompositionAnalysis,
} from "../shared/ai/image-composition";
import { ReferenceEmbeddingClient } from "../shared/ai/reference-embedding";
import { StrictJsonAgentClient } from "../shared/ai/strict-json-agent";
import { VisualProfileService } from "./visual-profile.service";

export type MatchedCharacterVisual = ReferencePromptImage & {
  mediaId: string;
  reason: string;
  score: number;
};

// Coordinates existing domain owners; never reads repositories directly.
@Injectable()
export class VisualCompositionService {
  constructor(
    private readonly visuals: VisualProfileService,
    private readonly sns: InfluencerMediaService,
    private readonly links: CharacterInfluencerService,
    private readonly settings: GenerationSettingsService,
    private readonly logs: LlmLogService,
    private readonly readBytes: MediaBytesReader,
  ) {}

  private async analyzer() {
    const config = await this.settings.resolvePlannerSettings();
    if (!config.apiUrl || !config.apiKey || !config.model)
      throw new Error("composition_analysis_llm_not_configured");
    return new ImageCompositionAnalyzer(
      new StrictJsonAgentClient(
        { apiUrl: config.apiUrl, apiKey: config.apiKey, model: config.model },
        fetch,
        this.logs,
      ),
      this.readBytes,
      config.model,
    );
  }

  private async embeddings() {
    const config = await this.settings.resolveChatSettings();
    if (!config.embeddingApiUrl || !config.embeddingModel)
      throw new Error("reference_embedding_not_configured");
    return {
      model: config.embeddingModel,
      client: new ReferenceEmbeddingClient(
        {
          apiUrl: config.embeddingApiUrl,
          apiKey: config.embeddingApiKey,
          model: config.embeddingModel,
        },
        this.logs,
      ),
    };
  }

  async prepareCharacter(characterId: string, limit = 20) {
    const context = {
      characterId,
      metadata: {
        purpose: "character_composition_index",
        version: COMPOSITION_VERSION,
      },
    };
    const profile = await this.visuals.getProfile(characterId);
    let analyzed = 0;
    for (const reference of profile.referenceMedia.filter(
      (item) => item.isActive,
    )) {
      if (readCompositionAnalysis(reference.compositionAnalysis)) continue;
      if (analyzed >= limit) continue;
      const analysis = await (
        await this.analyzer()
      ).analyze(
        {
          url: reference.storageKey ? "" : reference.url,
          storageKey: reference.storageKey,
          contentType: reference.contentType,
        },
        { ...context, inputMediaIds: [reference.mediaId] },
      );
      if (
        !(await this.visuals.saveCompositionAnalysis({
          characterId,
          mediaId: reference.mediaId,
          description: reference.description,
          expectedAnalysis: reference.compositionAnalysis,
          analysis,
        }))
      )
        throw new ConflictException("character_visual_changed");
      analyzed++;
    }
    const { client, model } = await this.embeddings();
    const sources =
      await this.visuals.listReferenceEmbeddingSources(characterId);
    let indexed = 0;
    for (const source of sources) {
      if (!source.compositionAnalysis) continue;
      if (source.indexed && source.embeddingModel === model) continue;
      const [embedding] = await client.embed(
        [compositionText(source.compositionAnalysis.content)],
        {
          ...context,
          inputMediaIds: [source.mediaId],
        },
      );
      if (
        !(await this.visuals.saveReferenceEmbedding({
          ...source,
          embedding,
          model,
        }))
      )
        throw new ConflictException("character_visual_changed");
      indexed++;
    }
    return { analyzed, indexed, total: sources.length, model };
  }

  async sourceAnalysis(
    row: InfluencerMediaRow,
    context: LlmLogContext,
  ): Promise<CompositionAnalysis> {
    let content;
    if (
      row.analysisVersion === COMPOSITION_VERSION &&
      row.analysisModel &&
      row.analysis
    ) {
      content = parseComposition(
        Object.fromEntries(
          COMPOSITION_FIELDS.map((field) => [field, row.analysis![field]]),
        ),
      );
    }
    const analysis: CompositionAnalysis = content
      ? { version: COMPOSITION_VERSION, model: row.analysisModel!, content }
      : await (
          await this.analyzer()
        ).analyze({ url: "", storageKey: row.mediaKey }, context);
    const saved = content
      ? row
      : await this.sns.saveComposition(
          row,
          {
            ...row.analysis,
            description: String(
              row.analysis?.description ?? compositionText(analysis.content),
            ),
            ...analysis.content,
          },
          analysis.model,
          analysis.version,
        );
    const { client, model } = await this.embeddings();
    if (!saved.embedding || saved.embeddingModel !== model) {
      const snapshot = await this.sns.prepareEmbedding(saved, model);
      const [embedding] = await client.embed(
        [compositionText(analysis.content)],
        context,
      );
      await this.sns.saveEmbedding(snapshot, model, embedding);
    }
    return analysis;
  }

  // Explicit, resumable maintenance: existing current-version rows are skipped.
  async prepareLibrary(characterId: string) {
    // Bound vision calls per HTTP request; repeated calls resume missing work.
    const character = await this.prepareCharacter(characterId, 3);
    const links = await this.links.list([characterId]);
    let after: bigint | undefined;
    let sourceCount = 0;
    if (links.length)
      for (;;) {
        const sources = await this.sns.list({
          influencerIds: links.map((link) => link.influencerId),
          after,
          limit: 100,
        });
        for (const row of sources) {
          if (
            row.analysisVersion === COMPOSITION_VERSION &&
            row.embedding &&
            row.embeddingModel === character.model
          )
            continue;
          if (character.analyzed + sourceCount >= 3) break;
          await this.sourceAnalysis(row, {
            characterId,
            inputMediaIds: [],
            metadata: {
              purpose: "sns_composition_index",
              mediaId: String(row.id),
            },
          });
          sourceCount++;
        }
        if (sources.length < 100 || character.analyzed + sourceCount >= 3)
          break;
        after = sources[sources.length - 1].id;
      }
    return { character, sourceCount };
  }

  async status(characterId: string) {
    const profile = await this.visuals.getProfile(characterId);
    const { model } = await this.embeddings();
    const sources =
      await this.visuals.listReferenceEmbeddingSources(characterId);
    const active = profile.referenceMedia.filter(
      (reference) => reference.isActive,
    );
    return {
      model,
      total: active.length,
      analyzed: active.filter((reference) =>
        readCompositionAnalysis(reference.compositionAnalysis),
      ).length,
      indexed: sources.filter(
        (source) =>
          source.compositionAnalysis &&
          source.indexed &&
          source.embeddingModel === model,
      ).length,
    };
  }

  async match(input: {
    characterId: string;
    source: InfluencerMediaRow;
    maxReferences: number;
    slotPrefix: string;
    client: StrictJsonAgentClient;
    context: LlmLogContext;
  }) {
    const sourceAnalysis = await this.sourceAnalysis(
      input.source,
      input.context,
    );
    if (sourceAnalysis.content.personCount === 0)
      return {
        sourceAnalysis,
        references: [] as MatchedCharacterVisual[],
        trace: null,
      };
    if (input.maxReferences < 1)
      throw new Error("reference_model_requires_identity_slot");
    await this.prepareCharacter(input.characterId);
    const { client, model } = await this.embeddings();
    const query = compositionText(sourceAnalysis.content);
    const [embedding] = await client.embed([query], {
      ...input.context,
      metadata: {
        purpose: "source_to_character_composition",
        sourceMediaId: String(input.source.id),
        query,
      },
    });
    const ranks = await this.visuals.searchReferenceEmbeddings(
      input.characterId,
      embedding,
      model,
      6,
    );
    const profile = await this.visuals.getProfile(input.characterId);
    const candidates = ranks.map((rank) => {
      const reference = profile.referenceMedia.find(
        (item) => item.mediaId === rank.id && item.isActive,
      );
      const composition = readCompositionAnalysis(
        reference?.compositionAnalysis,
      );
      if (!reference || !composition)
        throw new ConflictException("character_visual_changed");
      return {
        mediaId: rank.id,
        score: rank.score,
        description: reference.description,
        composition,
        media: {
          url: reference.storageKey ? "" : reference.url,
          storageKey: reference.storageKey,
          contentType: reference.contentType,
        },
      };
    });
    if (!candidates.length) throw new Error("character_visual_no_candidates");
    const selected = await selectCharacterVisuals({
      client: input.client,
      readBytes: this.readBytes,
      source: { url: "", storageKey: input.source.mediaKey },
      sourceComposition: sourceAnalysis,
      candidates,
      maxReferences: input.maxReferences,
      context: input.context,
    });
    const references = await Promise.all(
      selected.selections.map(async (selection, index) => {
        const candidate = candidates.find(
          (item) => item.mediaId === selection.mediaId,
        )!;
        const { bytes } = await this.readBytes(candidate.media);
        return {
          id: `CHARACTER_${index + 1}`,
          role: "character_identity" as const,
          inputOrder: index + 1,
          promptLabel: `${input.slotPrefix} ${index + 1}`,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          media: candidate.media,
          mediaId: candidate.mediaId,
          reason: selection.reason,
          score: candidate.score,
        };
      }),
    );
    return {
      sourceAnalysis,
      references,
      trace: {
        model,
        query,
        candidates: ranks,
        producerLogId: selected.producerLogId,
      },
    };
  }
}
