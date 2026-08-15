import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../domain/database/prisma.service";

const draftWorkItemInclude = {
  publishedPost: {
    include: {
      postMedia: {
        orderBy: { sortOrder: "asc" as const },
        include: { media: { select: { url: true } } },
      },
    },
  },
  jobs: {
    // 컷별 "최신 잡" 판정은 생산자(집계·게시·캡션·평가)와 같은 정렬이어야
    // 한다 — 다르면 stale 판정이 화면에서만 어긋난다.
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    select: {
      id: true,
      sortOrder: true,
      status: true,
      prompt: true,
      updatedAt: true,
      outputs: {
        orderBy: { candidateIndex: "asc" as const },
        select: {
          selected: true,
          mediaId: true,
          media: { select: { url: true } },
        },
      },
    },
  },
  evaluations: {
    orderBy: [{ attempt: "desc" as const }, { createdAt: "desc" as const }],
    select: {
      kind: true,
      status: true,
      overallScore: true,
      createdAt: true,
      completedAt: true,
    },
  },
} satisfies Prisma.PostDraftInclude;

const standalonePostInclude = {
  postMedia: {
    orderBy: { sortOrder: "asc" as const },
    include: { media: { select: { url: true } } },
  },
} satisfies Prisma.PostInclude;

export type PostWorkDraft = Prisma.PostDraftGetPayload<{
  include: typeof draftWorkItemInclude;
}>;

export type StandalonePost = Prisma.PostGetPayload<{
  include: typeof standalonePostInclude;
}>;

@Injectable()
export class PostWorkspaceRepository {
  constructor(private readonly prisma: PrismaService) {}

  findDrafts(input: {
    where: Prisma.PostDraftWhereInput;
    before?: Date;
    take: number;
  }): Promise<PostWorkDraft[]> {
    return this.prisma.postDraft.findMany({
      where: {
        ...input.where,
        ...(input.before ? { updatedAt: { lte: input.before } } : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: input.take,
      include: draftWorkItemInclude,
    });
  }

  findStandalonePosts(input: {
    onlyStandalone: true;
    before?: Date;
    take: number;
  }): Promise<StandalonePost[]> {
    return this.prisma.post.findMany({
      where: {
        sourceDrafts: { none: {} },
        ...(input.before ? { createdAt: { lte: input.before } } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.take,
      include: standalonePostInclude,
    });
  }

  findDraft(id: string): Promise<PostWorkDraft | null> {
    return this.prisma.postDraft.findUnique({
      where: { id },
      include: draftWorkItemInclude,
    });
  }

  findStandalonePost(id: string): Promise<StandalonePost | null> {
    return this.prisma.post.findFirst({
      where: { id, sourceDrafts: { none: {} } },
      include: standalonePostInclude,
    });
  }
}
