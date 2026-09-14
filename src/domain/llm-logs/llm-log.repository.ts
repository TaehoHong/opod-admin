import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, ilike, lte, lt, or, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import { llmLogMedia, llmLogs, media } from "../database/schema";

export type LlmLogStatus = "running" | "succeeded" | "failed";
export type LlmLogListFilter = {
  status?: LlmLogStatus;
  type?: string;
  provider?: string;
  model?: string;
  requestId?: string;
  generationJobId?: string;
  from?: Date;
  to?: Date;
};

const listFields = {
  id: llmLogs.id,
  type: llmLogs.type,
  provider: llmLogs.provider,
  model: llmLogs.model,
  status: llmLogs.status,
  isStreaming: llmLogs.isStreaming,
  requestId: llmLogs.requestId,
  providerRequestId: llmLogs.providerRequestId,
  userId: llmLogs.userId,
  characterId: llmLogs.characterId,
  generationJobId: llmLogs.generationJobId,
  httpStatus: llmLogs.httpStatus,
  errorType: llmLogs.errorType,
  durationMs: llmLogs.durationMs,
  inputTokens: llmLogs.inputTokens,
  outputTokens: llmLogs.outputTokens,
  totalTokens: llmLogs.totalTokens,
  responseModel: llmLogs.responseModel,
  finishReason: llmLogs.finishReason,
  timeToFirstTokenMs: llmLogs.timeToFirstTokenMs,
  cachedInputTokens: llmLogs.cachedInputTokens,
  cacheWriteTokens: llmLogs.cacheWriteTokens,
  reasoningTokens: llmLogs.reasoningTokens,
  cost: llmLogs.cost,
  upstreamCost: llmLogs.upstreamCost,
  createdAt: llmLogs.createdAt,
  completedAt: llmLogs.completedAt,
  _count: {
    media: sql<number>`(select count(*)::int from ${llmLogMedia} where ${llmLogMedia.llmLogId} = ${llmLogs.id})`,
  },
} as const;

export type LlmLogListRow = Pick<
  typeof llmLogs.$inferSelect,
  | "id"
  | "type"
  | "provider"
  | "model"
  | "status"
  | "isStreaming"
  | "requestId"
  | "providerRequestId"
  | "userId"
  | "characterId"
  | "generationJobId"
  | "httpStatus"
  | "errorType"
  | "durationMs"
  | "inputTokens"
  | "outputTokens"
  | "totalTokens"
  | "responseModel"
  | "finishReason"
  | "timeToFirstTokenMs"
  | "cachedInputTokens"
  | "cacheWriteTokens"
  | "reasoningTokens"
  | "cost"
  | "upstreamCost"
  | "createdAt"
  | "completedAt"
> & { _count: { media: number } };
export type LlmLogDetailRow = typeof llmLogs.$inferSelect & {
  media: Array<
    typeof llmLogMedia.$inferSelect & { media: typeof media.$inferSelect }
  >;
};
export type JsonValue = unknown;
export type LlmLogCreateInput = {
  type: string;
  provider: string;
  model: string;
  endpoint: string;
  isStreaming: boolean;
  requestId?: string;
  userId?: string;
  characterId?: string;
  generationJobId?: string;
  systemPromptJson: JsonValue | null;
  userPromptJson: JsonValue | null;
  requestJson: JsonValue;
  metadataJson?: JsonValue;
  redactedPaths: string[];
  inputMediaIds?: string[];
};
export type LlmLogFinishInput = {
  status?: LlmLogStatus;
  responseJson?: JsonValue | null;
  redactedPaths?: string[];
  providerRequestId?: string;
  httpStatus?: number;
  errorType?: string;
  errorMessage?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  responseModel?: string;
  usageJson?: JsonValue | null;
  finishReason?: string;
  timeToFirstTokenMs?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  cost?: number;
  upstreamCost?: number;
  completedAt?: Date;
};
export type LlmLogHandleRow = {
  id: bigint;
  redactedPaths: string[];
  createdAt: Date;
};

@Injectable()
export class LlmLogRepository {
  constructor(private readonly database: DatabaseService) {}

  async findManyForList(input: {
    filter: LlmLogListFilter;
    take: number;
    cursor?: bigint;
  }): Promise<LlmLogListRow[]> {
    const { filter } = input;
    const [cursor] =
      input.cursor !== undefined
        ? await this.database.client
            .select({ id: llmLogs.id, createdAt: llmLogs.createdAt })
            .from(llmLogs)
            .where(eq(llmLogs.id, input.cursor))
            .limit(1)
        : [];
    return this.database.client
      .select(listFields)
      .from(llmLogs)
      .where(
        and(
          filter.status ? eq(llmLogs.status, filter.status) : undefined,
          filter.type ? eq(llmLogs.type, filter.type) : undefined,
          filter.provider ? eq(llmLogs.provider, filter.provider) : undefined,
          filter.model
            ? or(
                ilike(llmLogs.model, `%${filter.model}%`),
                ilike(llmLogs.responseModel, `%${filter.model}%`),
              )
            : undefined,
          filter.requestId
            ? eq(llmLogs.requestId, filter.requestId)
            : undefined,
          filter.generationJobId
            ? eq(llmLogs.generationJobId, filter.generationJobId)
            : undefined,
          filter.from ? gte(llmLogs.createdAt, filter.from) : undefined,
          filter.to ? lte(llmLogs.createdAt, filter.to) : undefined,
          cursor
            ? or(
                lt(llmLogs.createdAt, cursor.createdAt),
                and(
                  eq(llmLogs.createdAt, cursor.createdAt),
                  lt(llmLogs.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(llmLogs.createdAt), desc(llmLogs.id))
      .limit(input.take);
  }

  async findByIdWithMedia(id: bigint): Promise<LlmLogDetailRow | null> {
    const [log] = await this.database.client
      .select()
      .from(llmLogs)
      .where(eq(llmLogs.id, id))
      .limit(1);
    if (!log) return null;
    const relations = await this.database.client
      .select({
        llmLogId: llmLogMedia.llmLogId,
        mediaId: llmLogMedia.mediaId,
        role: llmLogMedia.role,
        sortOrder: llmLogMedia.sortOrder,
        media,
      })
      .from(llmLogMedia)
      .innerJoin(media, eq(media.id, llmLogMedia.mediaId))
      .where(eq(llmLogMedia.llmLogId, id))
      .orderBy(asc(llmLogMedia.role), asc(llmLogMedia.sortOrder));
    return { ...log, media: relations };
  }

  async create(input: LlmLogCreateInput): Promise<bigint> {
    return this.database.client.transaction(async (tx) => {
      const mediaIds = [...new Set(input.inputMediaIds ?? [])];
      const [log] = await tx
        .insert(llmLogs)
        .values({
          type: input.type,
          provider: input.provider,
          model: input.model,
          endpoint: input.endpoint,
          isStreaming: input.isStreaming,
          requestId: input.requestId,
          userId: input.userId,
          characterId: input.characterId,
          generationJobId: input.generationJobId,
          systemPromptJson: input.systemPromptJson,
          userPromptJson: input.userPromptJson,
          requestJson: input.requestJson,
          metadataJson: input.metadataJson,
          redactedPaths: input.redactedPaths,
        })
        .returning({ id: llmLogs.id });
      if (mediaIds.length > 0) {
        await tx.insert(llmLogMedia).values(
          mediaIds.map((mediaId, sortOrder) => ({
            llmLogId: log.id,
            mediaId,
            role: "input" as const,
            sortOrder,
          })),
        );
      }
      return log.id;
    });
  }

  findRunning(input: {
    type: string;
    generationJobId: string;
    providerRequestId: string;
  }): Promise<LlmLogHandleRow | null> {
    return this.database.client
      .select({
        id: llmLogs.id,
        redactedPaths: llmLogs.redactedPaths,
        createdAt: llmLogs.createdAt,
      })
      .from(llmLogs)
      .where(
        and(
          eq(llmLogs.type, input.type),
          eq(llmLogs.generationJobId, input.generationJobId),
          eq(llmLogs.status, "running"),
          or(
            eq(llmLogs.providerRequestId, input.providerRequestId),
            sql`${llmLogs.providerRequestId} is null`,
          ),
        ),
      )
      .orderBy(desc(llmLogs.id))
      .limit(1)
      .then(([row]) => row ?? null);
  }

  async finish(id: bigint, input: LlmLogFinishInput): Promise<void> {
    const { cost, upstreamCost, ...rest } = input;
    await this.database.client
      .update(llmLogs)
      .set({
        ...rest,
        ...(cost === undefined ? {} : { cost: String(cost) }),
        ...(upstreamCost === undefined
          ? {}
          : { upstreamCost: String(upstreamCost) }),
      })
      .where(eq(llmLogs.id, id));
  }
}
