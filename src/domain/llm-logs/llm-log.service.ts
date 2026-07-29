import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isUUID } from "class-validator";
import { PrismaService } from "../database/prisma.service";
import { decodeCursor, PageInput, pageFromRows } from "../database/page";

export const LLM_LOG_TYPE = {
  contentPlan: "admin.content.plan",
  imagePromptBuild: "admin.image.prompt",
  referenceCaption: "admin.reference.caption",
  connectionTest: "admin.connection.test",
  imageGenerate: "admin.image.generate",
} as const;

export type LlmLogType = (typeof LLM_LOG_TYPE)[keyof typeof LLM_LOG_TYPE];

export type LlmLogContext = {
  requestId?: string;
  userId?: string;
  characterId?: string;
  generationJobId?: string;
  metadata?: Record<string, unknown>;
  inputMediaIds?: string[];
};

export type LlmLogHandle = {
  id: bigint;
  redactedPaths: string[];
  startedAt: number;
};

@Injectable()
export class LlmLogService {
  private readonly logger = new Logger(LlmLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(
    input: {
      status?: string;
      type?: string;
      provider?: string;
      model?: string;
      requestId?: string;
      generationJobId?: string;
      from?: string;
      to?: string;
    } & PageInput,
  ) {
    const cursor = bigintCursor(input.cursor);
    const status = input.status?.trim();
    if (status && !["running", "succeeded", "failed"].includes(status)) {
      throw new BadRequestException("Invalid LLM log status");
    }
    const from = optionalDate(input.from, "from");
    const to = optionalDate(input.to, "to");
    if (from && to && from > to) {
      throw new BadRequestException("from must be before to");
    }
    const generationJobId = input.generationJobId?.trim();
    if (generationJobId && !isUUID(generationJobId)) {
      throw new BadRequestException("generationJobId must be a UUID");
    }
    const where: Prisma.LlmLogWhereInput = {
      ...(status
        ? { status: status as "running" | "succeeded" | "failed" }
        : {}),
      ...(input.type?.trim() ? { type: input.type.trim() } : {}),
      ...(input.provider?.trim() ? { provider: input.provider.trim() } : {}),
      ...(input.model?.trim()
        ? { model: { contains: input.model.trim(), mode: "insensitive" } }
        : {}),
      ...(input.requestId?.trim() ? { requestId: input.requestId.trim() } : {}),
      ...(generationJobId ? { generationJobId } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };
    const rows = await this.prisma.llmLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        provider: true,
        model: true,
        status: true,
        isStreaming: true,
        requestId: true,
        providerRequestId: true,
        userId: true,
        characterId: true,
        generationJobId: true,
        httpStatus: true,
        errorType: true,
        durationMs: true,
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        createdAt: true,
        completedAt: true,
        _count: { select: { media: true } },
      },
    });
    return pageFromRows(
      rows.map((row) => ({
        ...row,
        id: row.id.toString(),
        mediaCount: row._count.media,
        _count: undefined,
        createdAt: row.createdAt.toISOString(),
        completedAt: row.completedAt?.toISOString(),
      })),
      input.limit,
    );
  }

  async get(idValue: string) {
    const id = bigintId(idValue);
    const log = await this.prisma.llmLog.findUnique({
      where: { id },
      include: {
        media: {
          orderBy: [{ role: "asc" }, { sortOrder: "asc" }],
          include: { media: true },
        },
      },
    });
    if (!log) throw new NotFoundException("LLM log not found");
    return {
      ...log,
      id: log.id.toString(),
      createdAt: log.createdAt.toISOString(),
      completedAt: log.completedAt?.toISOString(),
      media: log.media.map((relation) => ({
        role: relation.role,
        sortOrder: relation.sortOrder,
        ...relation.media,
        createdAt: relation.media.createdAt.toISOString(),
        uploadedAt: relation.media.uploadedAt?.toISOString(),
      })),
    };
  }

  async runJsonFetch(input: {
    type: LlmLogType;
    provider: string;
    model: string;
    endpoint: string;
    requestJson: unknown;
    context?: LlmLogContext;
    execute(): Promise<Response>;
    isSuccessful?(response: Response): boolean;
  }): Promise<Response> {
    const handle = await this.start({
      ...input,
      isStreaming: false,
    });
    let response: Response;
    try {
      response = await input.execute();
    } catch (error) {
      await this.fail(handle, error);
      throw error;
    }

    const responseJson = await responsePayload(response.clone());
    if (input.isSuccessful?.(response) ?? response.ok) {
      await this.succeed(handle, {
        responseJson,
        providerRequestId: providerRequestId(response, responseJson),
        httpStatus: response.status,
      });
    } else {
      await this.fail(
        handle,
        new Error(`provider returned HTTP ${response.status}`),
        {
          responseJson,
          providerRequestId: providerRequestId(response, responseJson),
          httpStatus: response.status,
        },
      );
    }
    return response;
  }

  async start(input: {
    type: LlmLogType;
    provider: string;
    model: string;
    endpoint: string;
    requestJson: unknown;
    isStreaming?: boolean;
    context?: LlmLogContext;
  }): Promise<LlmLogHandle> {
    const request = redactLlmPayload(input.requestJson, "$.request");
    const endpoint = redactLlmPayload(input.endpoint, "$.endpoint");
    const metadata = redactLlmPayload(
      input.context?.metadata ?? null,
      "$.metadata",
    );
    const redactedPaths = uniquePaths(
      request.redactedPaths,
      endpoint.redactedPaths,
      metadata.redactedPaths,
    );
    const messages =
      isRecord(request.value) && Array.isArray(request.value.messages)
        ? request.value.messages
        : [];
    const systemPromptJson = messages.filter(
      (message) => isRecord(message) && message.role === "system",
    );
    const userPromptJson = messages.filter(
      (message) => isRecord(message) && message.role === "user",
    );
    const context = input.context;
    const log = await this.prisma.llmLog.create({
      data: {
        type: input.type,
        provider: input.provider,
        model: input.model,
        endpoint: String(endpoint.value),
        isStreaming: input.isStreaming ?? false,
        requestId: context?.requestId,
        userId: context?.userId,
        characterId: context?.characterId,
        generationJobId: context?.generationJobId,
        systemPromptJson: jsonOrNull(
          systemPromptJson.length > 0 ? systemPromptJson : null,
        ),
        userPromptJson: jsonOrNull(
          userPromptJson.length > 0 ? userPromptJson : null,
        ),
        requestJson: request.value as Prisma.InputJsonValue,
        metadataJson: jsonOrUndefined(metadata.value),
        redactedPaths,
        ...(context?.inputMediaIds?.length
          ? {
              media: {
                create: [...new Set(context.inputMediaIds)].map(
                  (mediaId, sortOrder) => ({
                    mediaId,
                    role: "input" as const,
                    sortOrder,
                  }),
                ),
              },
            }
          : {}),
      },
      select: { id: true },
    });
    return {
      id: log.id,
      redactedPaths,
      startedAt: Date.now(),
    };
  }

  async findRunning(input: {
    type: LlmLogType;
    generationJobId: string;
    providerRequestId: string;
  }): Promise<LlmLogHandle> {
    const log = await this.prisma.llmLog.findFirst({
      where: {
        type: input.type,
        generationJobId: input.generationJobId,
        status: "running",
        OR: [
          { providerRequestId: input.providerRequestId },
          { providerRequestId: null },
        ],
      },
      orderBy: { id: "desc" },
      select: { id: true, redactedPaths: true, createdAt: true },
    });
    if (!log) {
      throw new Error("running LLM log was not found for provider request");
    }
    return {
      id: log.id,
      redactedPaths: log.redactedPaths,
      startedAt: log.createdAt.getTime(),
    };
  }

  async setProviderRequestId(
    handle: LlmLogHandle,
    providerRequestId: string,
  ): Promise<void> {
    try {
      await this.prisma.llmLog.update({
        where: { id: handle.id },
        data: { providerRequestId },
      });
    } catch (error) {
      this.logger.error(
        `failed to record provider request id for LLM log ${handle.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async succeed(
    handle: LlmLogHandle,
    result: {
      responseJson: unknown;
      providerRequestId?: string;
      httpStatus?: number;
    },
  ): Promise<void> {
    const response = redactLlmPayload(result.responseJson, "$.response");
    const usage = usageOf(response.value);
    try {
      await this.prisma.llmLog.update({
        where: { id: handle.id },
        data: {
          status: "succeeded",
          responseJson: jsonOrNull(response.value),
          redactedPaths: uniquePaths(
            handle.redactedPaths,
            response.redactedPaths,
          ),
          providerRequestId: result.providerRequestId,
          httpStatus: result.httpStatus ?? 200,
          durationMs: Math.max(0, Date.now() - handle.startedAt),
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          completedAt: new Date(),
        },
      });
    } catch (error) {
      this.logFinishError(handle.id, error);
    }
  }

  async fail(
    handle: LlmLogHandle,
    error: unknown,
    result: {
      responseJson?: unknown;
      providerRequestId?: string;
      httpStatus?: number;
    } = {},
  ): Promise<void> {
    const response = redactLlmPayload(
      result.responseJson ?? null,
      "$.response",
    );
    const failure = errorFields(error);
    try {
      await this.prisma.llmLog.update({
        where: { id: handle.id },
        data: {
          status: "failed",
          responseJson: jsonOrNull(response.value),
          redactedPaths: uniquePaths(
            handle.redactedPaths,
            response.redactedPaths,
            failure.isRedacted ? ["$.errorMessage"] : [],
          ),
          providerRequestId:
            result.providerRequestId ?? failure.providerRequestId,
          httpStatus: result.httpStatus ?? failure.httpStatus,
          errorType: failure.errorType,
          errorMessage: failure.errorMessage,
          durationMs: Math.max(0, Date.now() - handle.startedAt),
          completedAt: new Date(),
        },
      });
    } catch (writeError) {
      this.logFinishError(handle.id, writeError);
    }
  }

  private logFinishError(id: bigint, error: unknown): void {
    this.logger.error(
      `failed to finalize LLM log ${id}`,
      error instanceof Error ? error.stack : String(error),
    );
  }
}

export function redactLlmPayload(
  input: unknown,
  rootPath = "$",
): { value: unknown; redactedPaths: string[] } {
  const redactedPaths: string[] = [];

  const visit = (value: unknown, path: string, key = ""): unknown => {
    if (
      value == null ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      redactedPaths.push(path);
      return "[REDACTED]";
    }
    if (typeof value === "string") {
      if (
        /^data:[^;,]+;base64,/i.test(value) ||
        (/(base64|binary|bytes)/i.test(key) && value.length > 256)
      ) {
        redactedPaths.push(path);
        return "[REDACTED]";
      }
      return redactUrl(value, path, redactedPaths);
    }
    if (Array.isArray(value)) {
      return value.map((item, index) => visit(item, `${path}[${index}]`));
    }
    if (typeof value === "object") {
      const output: Record<string, unknown> = {};
      for (const [childKey, childValue] of Object.entries(value)) {
        const childPath = `${path}.${childKey}`;
        if (
          /(authorization|api[-_]?key|cookie|secret|access[-_]?token|refresh[-_]?token|internal[-_]?token)/i.test(
            childKey,
          )
        ) {
          redactedPaths.push(childPath);
          output[childKey] = "[REDACTED]";
        } else {
          output[childKey] = visit(childValue, childPath, childKey);
        }
      }
      return output;
    }
    return String(value);
  };

  return { value: visit(input, rootPath), redactedPaths };
}

function redactUrl(
  value: string,
  path: string,
  redactedPaths: string[],
): string {
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (
        /^(x-amz-|x-goog-)|signature|credential|security-token|(^|_)token$|^sig$/i.test(
          key,
        )
      ) {
        url.searchParams.delete(key);
        redactedPaths.push(`${path}.query.${key}`);
      }
    }
    return url.toString();
  } catch {
    return value;
  }
}

async function responsePayload(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function providerRequestId(
  response: Response,
  body: unknown,
): string | undefined {
  if (isRecord(body)) {
    const id = body.request_id ?? body.id;
    if (typeof id === "string") return id;
  }
  return response.headers.get("x-request-id") ?? undefined;
}

function usageOf(value: unknown): {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
} {
  const usage = isRecord(value) && isRecord(value.usage) ? value.usage : null;
  if (!usage) return {};
  const input = numberOf(usage.prompt_tokens ?? usage.input_tokens);
  const output = numberOf(usage.completion_tokens ?? usage.output_tokens);
  const total =
    numberOf(usage.total_tokens) ?? ((input ?? 0) + (output ?? 0) || undefined);
  return { inputTokens: input, outputTokens: output, totalTokens: total };
}

function errorFields(error: unknown): {
  providerRequestId?: string;
  httpStatus?: number;
  errorType: string;
  errorMessage: string;
  isRedacted: boolean;
} {
  const record = isRecord(error) ? error : {};
  const rawMessage =
    error instanceof Error ? error.message : String(record.message ?? error);
  const errorMessage = redactErrorMessage(rawMessage);
  return {
    providerRequestId:
      typeof record.request_id === "string" ? record.request_id : undefined,
    httpStatus: typeof record.status === "number" ? record.status : undefined,
    errorType:
      error instanceof Error ? error.name : String(record.name ?? "Error"),
    errorMessage,
    isRedacted: errorMessage !== rawMessage,
  };
}

function redactErrorMessage(value: string): string {
  return value
    .replace(/\b(Bearer|Key)\s+\S+/gi, "$1 [REDACTED]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) =>
      redactUrl(url, "$.errorMessage", []).replace(/[?&]$/, ""),
    )
    .replace(
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|cookie)=([^&\s]+)/gi,
      "$1=[REDACTED]",
    );
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function uniquePaths(...groups: string[][]): string[] {
  return [...new Set(groups.flat())];
}

function jsonOrNull(
  value: unknown,
): Prisma.InputJsonValue | Prisma.JsonNullValueInput {
  return value == null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function jsonOrUndefined(value: unknown): Prisma.InputJsonValue | undefined {
  return value == null ? undefined : (value as Prisma.InputJsonValue);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function bigintCursor(cursor?: string): bigint | undefined {
  const value = decodeCursor(cursor);
  return value === undefined ? undefined : bigintId(value);
}

function bigintId(value: string): bigint {
  try {
    const id = BigInt(value);
    if (id <= 0n) throw new Error("non-positive");
    return id;
  } catch {
    throw new BadRequestException("Invalid LLM log id");
  }
}

function optionalDate(
  value: string | undefined,
  field: string,
): Date | undefined {
  if (!value?.trim()) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${field} must be a valid date`);
  }
  return date;
}
