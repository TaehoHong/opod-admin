import {
  LLM_LOG_TYPE,
  LlmLogContext,
  LlmLogService,
  LlmLogType,
} from "../../llm-logs/llm-log.service";

export const REFERENCE_EMBEDDING_DIMENSIONS = 1024;
export type ReferenceEmbeddingSource = {
  ownerId: string;
  mediaId: string;
  description: string;
  embeddingModel: string | null;
  indexed: boolean;
};
export type RankedReference = {
  id: string;
  description: string;
  score: number;
};
export type ReferenceEmbeddingWrite = {
  ownerId: string;
  mediaId: string;
  description: string;
  embedding: number[];
  model: string;
};

export function assertReferenceEmbedding(
  value: unknown,
): asserts value is number[] {
  if (
    !Array.isArray(value) ||
    value.length !== REFERENCE_EMBEDDING_DIMENSIONS ||
    !value.every(
      (entry) => typeof entry === "number" && Number.isFinite(entry),
    ) ||
    !value.some((entry) => entry !== 0)
  ) {
    throw new Error(
      "Reference embedding must contain 1024 finite values and have nonzero norm",
    );
  }
}

export class ReferenceEmbeddingClient {
  constructor(
    private readonly config: { apiUrl: string; apiKey?: string; model: string },
    private readonly llmLogs: LlmLogService,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly logType: LlmLogType = LLM_LOG_TYPE.referenceEmbedding,
  ) {}

  async embed(input: string[], context?: LlmLogContext): Promise<number[][]> {
    const requestJson = {
      model: this.config.model,
      input,
      dimensions: REFERENCE_EMBEDDING_DIMENSIONS,
      encoding_format: "float",
    };
    const response = await this.llmLogs.runJsonFetch({
      type: this.logType,
      provider: "openai-compatible",
      model: this.config.model,
      endpoint: this.config.apiUrl,
      requestJson,
      context,
      execute: () =>
        this.fetchFn(this.config.apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.config.apiKey
              ? { Authorization: `Bearer ${this.config.apiKey}` }
              : {}),
          },
          body: JSON.stringify(requestJson),
          signal: AbortSignal.timeout(60_000),
        }),
    });
    if (!response.ok)
      throw new Error(`Reference embedding HTTP ${response.status}`);
    const result = (await response.json()) as {
      model?: string;
      data?: { index: number; embedding: unknown }[];
    };
    if (
      result.model !== this.config.model ||
      !Array.isArray(result.data) ||
      result.data.length !== input.length
    )
      throw new Error("Reference embedding model or result count mismatch");
    const vectors: number[][] = [];
    for (const row of result.data) {
      if (
        !Number.isInteger(row.index) ||
        row.index < 0 ||
        row.index >= input.length ||
        vectors[row.index]
      )
        throw new Error("Reference embedding result indices are invalid");
      assertReferenceEmbedding(row.embedding);
      vectors[row.index] = row.embedding;
    }
    return vectors;
  }
}
