import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { CharacterService } from "../characters/character.service";
type MemoryEmbeddingSources = Awaited<
  ReturnType<CharacterService["listMemoryEmbeddingSources"]>
>;
import { GenerationSettingsService } from "../settings/generation-settings.service";
import { LLM_LOG_TYPE, LlmLogService } from "../llm-logs/llm-log.service";
import { ReferenceEmbeddingClient } from "../shared/ai/reference-embedding";
import { PostMemoryEntry } from "./post-persona-context";

export class MemoryRetrievalError extends Error {}

@Injectable()
export class MemoryRetrievalService {
  constructor(
    private readonly characters: CharacterService,
    private readonly settings: GenerationSettingsService,
    private readonly logs: LlmLogService,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async client() {
    const settings = await this.settings.resolveChatSettings();
    if (!settings.embeddingApiUrl?.trim() || !settings.embeddingModel?.trim())
      throw new MemoryRetrievalError("memory_embedding_not_configured");
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
        LLM_LOG_TYPE.memoryEmbedding,
      ),
    };
  }

  // Explicit maintenance: valid existing vectors are reused; documents are unchanged.
  async indexMissing(memoryIds: string[]) {
    const { client, model } = await this.client();
    const sources = await this.characters.listMemoryEmbeddingSources();
    if (memoryIds.some((id) => !sources.some((source) => source.id === id)))
      throw new MemoryRetrievalError("memory_index_source_not_found");
    const missing = sources.filter(
      (source) =>
        memoryIds.includes(source.id) &&
        source.injection === "retrieved" &&
        (!source.indexed ||
          source.embeddingModel !== model ||
          source.embeddedTextSha256 !== source.sourceSha256),
    );
    const saved: string[] = [];
    for (const source of missing) {
      const [embedding] = await client.embed([source.content], {
        characterId: source.characterId,
        metadata: {
          purpose: "canon_memory_index",
          memoryId: source.id,
          sourceSha256: source.sourceSha256,
        },
      });
      if (
        !(await this.characters.saveMemoryEmbedding({
          characterId: source.characterId,
          memoryId: source.id,
          content: source.content,
          memorySha256: source.memorySha256,
          embedding,
          model,
        }))
      )
        throw new MemoryRetrievalError(`memory_source_changed:${source.id}`);
      saved.push(source.id);
    }
    return {
      model,
      dimensions: 1024,
      saved,
      reused: sources.filter(
        (source) =>
          source.injection === "retrieved" &&
          source.indexed &&
          source.embeddingModel === model &&
          source.embeddedTextSha256 === source.sourceSha256,
      ).length,
    };
  }

  async retrieve(input: {
    characterId: string;
    requestId: string;
    stage: string;
    query: string;
    memories: PostMemoryEntry[];
  }) {
    try {
      const { client, model } = await this.client();
      const before = await this.characters.listMemoryEmbeddingSources(
        input.characterId,
      );
      const sources = before.filter(
        (source) => source.injection === "retrieved",
      );
      for (const source of sources) {
        if (
          !source.indexed ||
          source.embeddingModel !== model ||
          source.embeddedTextSha256 !== source.sourceSha256
        )
          throw new MemoryRetrievalError(
            `memory_embedding_index_required:${source.id}`,
          );
      }
      // Validate the draft snapshot used by the planner, including authored routing.
      if (
        before.length !== input.memories.length ||
        before.some(
          (source) =>
            !input.memories.some(
              (memory) =>
                memory.sourceId === source.id &&
                memorySnapshot(memory) ===
                  memorySnapshot({
                    type: source.type,
                    content: source.content,
                    kind: source.kind,
                    injection: source.injection,
                    recallKeys: source.recallKeys,
                    occurredAt: source.occurredAt?.toISOString() ?? null,
                    occurredLabel: source.occurredLabel,
                    occurredPrecision: source.occurredPrecision,
                  }),
            ),
        )
      )
        throw new MemoryRetrievalError("memory_snapshot_changed");
      const queries = [
        {
          purpose: "post_intent",
          query: input.query,
          factsOnly: false,
          limit: 4,
        },
        ...(input.stage === "image_plan"
          ? [
              {
                purpose: "body_identity",
                query:
                  "캐릭터의 고정 신체 특징: 키, 체형과 몸의 비율, 성인 체형",
                factsOnly: true,
                limit: 2,
              },
              {
                purpose: "hair_identity",
                query: "캐릭터의 고정 머리 특징: 머리 길이, 색상, 헤어스타일",
                factsOnly: true,
                limit: 1,
              },
              {
                purpose: "face_identity",
                query:
                  "캐릭터의 고정 얼굴 특징: 눈 코 입, 얼굴 형태, 피부의 점과 정체성 표시",
                factsOnly: true,
                limit: 1,
              },
            ]
          : []),
      ].filter((query) => query.query.trim());
      const vectors =
        sources.length && queries.length
          ? await client.embed(
              queries.map(
                (query) =>
                  `Instruct: Retrieve character memories relevant to the described post intent or fixed visual identity.\nQuery:${query.query}`,
              ),
              {
                requestId: input.requestId,
                characterId: input.characterId,
                metadata: {
                  purpose: "canon_memory_retrieval",
                  stage: input.stage,
                },
              },
            )
          : [];
      const selected = new Set<string>();
      const ranked = [];
      for (let index = 0; index < vectors.length; index++) {
        const query = queries[index];
        const rows = await this.characters.searchMemoryEmbeddings(
          input.characterId,
          vectors[index],
          model,
          query.factsOnly,
        );
        // Calibrated against real unrelated intents and positive Canon contrasts.
        // Small budgets do not make a weak match relevant; require a floor and
        // keep only candidates near this query's strongest match.
        const topScore =
          rows.find((row) => Number.isFinite(row.score))?.score ?? 0;
        const queryCutoff = Math.max(0.3, topScore * 0.75);
        let count = 0;
        const candidates = rows.map((row) => {
          const source = sources.find((source) => source.id === row.id);
          if (!source || source.sourceSha256 !== row.sourceSha256)
            throw new MemoryRetrievalError(
              "memory_source_changed_during_search",
            );
          // An episode needs stronger evidence than stable factual context.
          const cutoff = Math.max(
            queryCutoff,
            source.kind === "event" ? 0.52 : 0.3,
          );
          const accepted =
            Number.isFinite(row.score) &&
            row.score > cutoff &&
            count < query.limit;
          if (accepted) {
            count++;
            selected.add(row.id);
          }
          return {
            ...row,
            cutoff,
            selected: accepted,
            reason: accepted
              ? "semantic_match"
              : row.score <= cutoff
                ? "below_relevance_threshold"
                : "candidate_budget",
          };
        });
        ranked.push({ ...query, topScore, cutoff: queryCutoff, candidates });
      }
      const after = await this.characters.listMemoryEmbeddingSources(
        input.characterId,
      );
      if (fingerprint(before) !== fingerprint(after))
        throw new MemoryRetrievalError("memory_source_changed_during_search");
      const preservedLegacyIds = new Set(
        input.memories
          .filter((memory) => !memory.injection)
          .slice(0, 20)
          .map((memory) => memory.sourceId),
      );
      return {
        selectedIds: [...selected],
        trace: {
          model,
          dimensions: 1024,
          threshold: 0.3,
          relativeThreshold: 0.75,
          eventThreshold: 0.52,
          maxSelected: 8,
          stage: input.stage,
          queries: ranked,
          selectedIds: [...selected],
          sources: before.map((source) => ({
            id: source.id,
            sourceSha256: source.sourceSha256,
            kind: source.kind,
            injection: source.injection,
            selected:
              source.injection === "always" ||
              selected.has(source.id) ||
              preservedLegacyIds.has(source.id),
            reason:
              source.injection === "always"
                ? "authored_always"
                : source.injection === null
                  ? "legacy_policy_preserved"
                  : selected.has(source.id)
                    ? "semantic_match"
                    : "not_selected",
          })),
          sourceSnapshotSha256: fingerprint(before),
        },
      };
    } catch (error) {
      if (error instanceof MemoryRetrievalError) throw error;
      throw new MemoryRetrievalError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

function fingerprint(sources: MemoryEmbeddingSources) {
  return createHash("sha256").update(JSON.stringify(sources)).digest("hex");
}

function memorySnapshot(memory: PostMemoryEntry) {
  return JSON.stringify({
    type: memory.type,
    content: memory.content,
    kind: memory.kind ?? null,
    injection: memory.injection ?? null,
    recallKeys: memory.recallKeys ?? [],
    occurredAt: memory.occurredAt ?? null,
    occurredLabel: memory.occurredLabel ?? null,
    occurredPrecision: memory.occurredPrecision ?? null,
  });
}
