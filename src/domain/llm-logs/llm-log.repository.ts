import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";

// entity repository — PrismaService는 이 계층에서만 쓴다
// (docs/02-development-rules.md "Module and Repository Rules").
//
// 서비스는 요청·응답 payload의 마스킹과 토큰 집계를 담당하고, 여기서는
// 질의만 맡는다. 서비스가 Prisma 타입을 몰라도 되도록 입력 형태를 직접
// 선언한다.

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
} as const;

export type LlmLogListRow = Prisma.LlmLogGetPayload<{
  select: typeof listFields;
}>;

export type LlmLogDetailRow = Prisma.LlmLogGetPayload<{
  include: { media: { include: { media: true } } };
}>;

// 시작 시점에 기록하는 값. 마스킹은 이미 끝난 상태로 들어온다.
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
  // null은 컬럼의 JSON null을 뜻한다 (SQL NULL이 아니다) — 기존 저장 형태를
  // 그대로 유지한다.
  systemPromptJson: Prisma.InputJsonValue | null;
  userPromptJson: Prisma.InputJsonValue | null;
  requestJson: Prisma.InputJsonValue;
  metadataJson?: Prisma.InputJsonValue;
  redactedPaths: string[];
  inputMediaIds?: string[];
};

// 완료·실패 시 덮어쓰는 값.
export type LlmLogFinishInput = {
  status?: LlmLogStatus;
  responseJson?: Prisma.InputJsonValue | null;
  redactedPaths?: string[];
  providerRequestId?: string;
  httpStatus?: number;
  errorType?: string;
  errorMessage?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  completedAt?: Date;
};

export type LlmLogHandleRow = {
  id: bigint;
  redactedPaths: string[];
  createdAt: Date;
};

@Injectable()
export class LlmLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  // take는 서비스가 limit + 1로 넘긴다 — 다음 페이지 존재 판정을 위해서다.
  findManyForList(input: {
    filter: LlmLogListFilter;
    take: number;
    cursor?: bigint;
  }): Promise<LlmLogListRow[]> {
    const { filter } = input;
    const where: Prisma.LlmLogWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.provider ? { provider: filter.provider } : {}),
      ...(filter.model
        ? { model: { contains: filter.model, mode: "insensitive" } }
        : {}),
      ...(filter.requestId ? { requestId: filter.requestId } : {}),
      ...(filter.generationJobId
        ? { generationJobId: filter.generationJobId }
        : {}),
      ...(filter.from || filter.to
        ? {
            createdAt: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
    };
    return this.prisma.llmLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.take,
      ...(input.cursor !== undefined
        ? { cursor: { id: input.cursor }, skip: 1 }
        : {}),
      select: listFields,
    });
  }

  findByIdWithMedia(id: bigint): Promise<LlmLogDetailRow | null> {
    return this.prisma.llmLog.findUnique({
      where: { id },
      include: {
        media: {
          orderBy: [{ role: "asc" }, { sortOrder: "asc" }],
          include: { media: true },
        },
      },
    });
  }

  async create(input: LlmLogCreateInput): Promise<bigint> {
    const mediaIds = [...new Set(input.inputMediaIds ?? [])];
    const log = await this.prisma.llmLog.create({
      data: {
        type: input.type,
        provider: input.provider,
        model: input.model,
        endpoint: input.endpoint,
        isStreaming: input.isStreaming,
        requestId: input.requestId,
        userId: input.userId,
        characterId: input.characterId,
        generationJobId: input.generationJobId,
        systemPromptJson: input.systemPromptJson ?? Prisma.JsonNull,
        userPromptJson: input.userPromptJson ?? Prisma.JsonNull,
        requestJson: input.requestJson,
        ...(input.metadataJson === undefined
          ? {}
          : { metadataJson: input.metadataJson }),
        redactedPaths: input.redactedPaths,
        ...(mediaIds.length
          ? {
              media: {
                create: mediaIds.map((mediaId, sortOrder) => ({
                  mediaId,
                  role: "input" as const,
                  sortOrder,
                })),
              },
            }
          : {}),
      },
      select: { id: true },
    });
    return log.id;
  }

  // provider가 요청 id를 나중에 알려주는 경로에서 진행 중인 로그를 되찾는다.
  findRunning(input: {
    type: string;
    generationJobId: string;
    providerRequestId: string;
  }): Promise<LlmLogHandleRow | null> {
    return this.prisma.llmLog.findFirst({
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
  }

  async finish(id: bigint, input: LlmLogFinishInput): Promise<void> {
    // responseJson만 따로 다룬다 — null은 "지우기"가 아니라 JSON null 저장이다.
    const { responseJson, ...rest } = input;
    await this.prisma.llmLog.update({
      where: { id },
      data: {
        ...rest,
        ...(responseJson === undefined
          ? {}
          : { responseJson: responseJson ?? Prisma.JsonNull }),
      },
    });
  }
}
