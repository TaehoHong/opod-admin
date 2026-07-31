import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../domain/database/prisma.service";

export const adminMediaFields = {
  id: true,
  mediaType: true,
  url: true,
  contentType: true,
  byteSize: true,
  width: true,
  height: true,
  durationSeconds: true,
  uploadedAt: true,
  createdAt: true,
} as const;

export const adminPostWithMedia = {
  postMedia: {
    include: { media: true },
    orderBy: { sortOrder: "asc" },
  },
  hashtags: {
    include: { hashtag: true },
    orderBy: { hashtag: { name: "asc" } },
  },
  _count: { select: { comments: true, reactions: true } },
} as const;

export type AdminMediaRecord = Prisma.MediaGetPayload<{
  select: typeof adminMediaFields;
}>;
export type AdminPostRecord = Prisma.PostGetPayload<{
  include: typeof adminPostWithMedia;
}>;
export type AdminStoryRecord = Prisma.StoryGetPayload<{
  include: { media: true };
}>;
export type AdminPostCommentRecord =
  Prisma.PostCommentGetPayload<Prisma.PostCommentDefaultArgs>;
export type AdminPostReactionRecord =
  Prisma.PostReactionGetPayload<Prisma.PostReactionDefaultArgs>;

type MediaInput =
  | {
      mediaType: "image" | "video";
      url: string;
      width?: number;
      height?: number;
      durationSeconds?: number;
    }
  | { mediaId: string };

@Injectable()
export class AdminContentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async hasMediaCursor(
    cursorId: string,
    filters: { mediaType?: "image" | "video"; uploaded?: boolean },
  ): Promise<boolean> {
    return (
      (await this.prisma.media.findFirst({
        where: { id: cursorId, ...this.mediaWhere(filters) },
        select: { id: true },
      })) !== null
    );
  }

  listMedia(input: {
    filters: { mediaType?: "image" | "video"; uploaded?: boolean };
    cursorId?: string;
    limit: number;
  }): Promise<AdminMediaRecord[]> {
    return this.prisma.media.findMany({
      where: this.mediaWhere(input.filters),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursorId ? { cursor: { id: input.cursorId }, skip: 1 } : {}),
      select: adminMediaFields,
    });
  }

  getMedia(mediaId: string): Promise<AdminMediaRecord | null> {
    return this.prisma.media.findUnique({
      where: { id: mediaId },
      select: adminMediaFields,
    });
  }

  getStoredMedia(mediaId: string) {
    return this.prisma.media.findUnique({
      where: { id: mediaId },
      select: { id: true, mediaType: true, uploadedAt: true },
    });
  }

  async hasPostCursor(
    cursorId: string,
    filters: { characterId?: string; contentType?: "feed" | "reel" },
  ): Promise<boolean> {
    return (
      (await this.prisma.post.findFirst({
        where: { id: cursorId, ...filters },
        select: { id: true },
      })) !== null
    );
  }

  listPosts(input: {
    filters: { characterId?: string; contentType?: "feed" | "reel" };
    cursorId?: string;
    limit: number;
  }): Promise<AdminPostRecord[]> {
    return this.prisma.post.findMany({
      where: input.filters,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursorId ? { cursor: { id: input.cursorId }, skip: 1 } : {}),
      include: adminPostWithMedia,
    });
  }

  getPost(postId: string): Promise<AdminPostRecord | null> {
    return this.prisma.post.findUnique({
      where: { id: postId },
      include: adminPostWithMedia,
    });
  }

  async hasPost(postId: string): Promise<boolean> {
    return (
      (await this.prisma.post.findUnique({
        where: { id: postId },
        select: { id: true },
      })) !== null
    );
  }

  async hasCharacter(characterId: string): Promise<boolean> {
    return (
      (await this.prisma.character.findUnique({
        where: { id: characterId },
        select: { id: true },
      })) !== null
    );
  }

  createPost(input: {
    characterId: string;
    contentType: "feed" | "reel";
    content: string;
    hashtags: string[];
    media: MediaInput[];
  }): Promise<AdminPostRecord> {
    return this.prisma.post.create({
      data: {
        characterId: input.characterId,
        contentType: input.contentType,
        content: input.content,
        hashtags: {
          create: input.hashtags.map((name) => ({
            hashtag: {
              connectOrCreate: { where: { name }, create: { name } },
            },
          })),
        },
        postMedia: {
          create: input.media.map((item, index) => ({
            sortOrder: index,
            media:
              "mediaId" in item
                ? { connect: { id: item.mediaId } }
                : { create: item },
          })),
        },
      },
      include: adminPostWithMedia,
    });
  }

  async hasStoryCursor(
    cursorId: string,
    characterId?: string,
  ): Promise<boolean> {
    return (
      (await this.prisma.story.findFirst({
        where: { id: cursorId, ...(characterId ? { characterId } : {}) },
        select: { id: true },
      })) !== null
    );
  }

  listStories(input: {
    characterId?: string;
    cursorId?: string;
    limit: number;
  }): Promise<AdminStoryRecord[]> {
    return this.prisma.story.findMany({
      where: input.characterId ? { characterId: input.characterId } : {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursorId ? { cursor: { id: input.cursorId }, skip: 1 } : {}),
      include: { media: true },
    });
  }

  getStory(storyId: string): Promise<AdminStoryRecord | null> {
    return this.prisma.story.findUnique({
      where: { id: storyId },
      include: { media: true },
    });
  }

  createStory(input: {
    characterId: string;
    caption: string;
    expiresAt: Date;
    media: MediaInput;
  }): Promise<AdminStoryRecord> {
    return this.prisma.story.create({
      data: {
        character: { connect: { id: input.characterId } },
        caption: input.caption,
        expiresAt: input.expiresAt,
        media:
          "mediaId" in input.media
            ? { connect: { id: input.media.mediaId } }
            : { create: input.media },
      },
      include: { media: true },
    });
  }

  async hasCommentCursor(
    cursorId: string,
    filters: { postId: string; characterId?: string },
  ): Promise<boolean> {
    return (
      (await this.prisma.postComment.findFirst({
        where: { id: cursorId, ...filters },
        select: { id: true },
      })) !== null
    );
  }

  listComments(input: {
    filters: { postId: string; characterId?: string };
    cursorId?: string;
    limit: number;
  }): Promise<AdminPostCommentRecord[]> {
    return this.prisma.postComment.findMany({
      where: input.filters,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursorId ? { cursor: { id: input.cursorId }, skip: 1 } : {}),
    });
  }

  createComment(input: {
    postId: string;
    characterId: string;
    body: string;
  }): Promise<AdminPostCommentRecord> {
    return this.prisma.postComment.create({
      data: {
        postId: input.postId,
        characterId: input.characterId,
        body: input.body,
      },
    });
  }

  async hasReactionCursor(
    cursorId: string,
    filters: {
      postId: string;
      characterId?: string;
      reactionType?: string;
    },
  ): Promise<boolean> {
    return (
      (await this.prisma.postReaction.findFirst({
        where: { id: cursorId, ...filters },
        select: { id: true },
      })) !== null
    );
  }

  listReactions(input: {
    filters: {
      postId: string;
      characterId?: string;
      reactionType?: string;
    };
    cursorId?: string;
    limit: number;
  }): Promise<AdminPostReactionRecord[]> {
    return this.prisma.postReaction.findMany({
      where: input.filters,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursorId ? { cursor: { id: input.cursorId }, skip: 1 } : {}),
    });
  }

  createReaction(input: {
    postId: string;
    characterId: string;
    reactionType: string;
  }): Promise<AdminPostReactionRecord> {
    return this.prisma.postReaction.create({ data: input });
  }

  recordCharacterAction(input: {
    characterId: string;
    actionType: string;
    targetTable: string;
    targetId: string;
    reason: string;
  }) {
    return this.prisma.characterActionLog.create({ data: input });
  }

  listCharacterActions(input: {
    characterId?: string;
    cursor?: bigint;
    limit: number;
  }) {
    return this.prisma.characterActionLog.findMany({
      where: input.characterId ? { characterId: input.characterId } : {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor !== undefined
        ? { cursor: { id: input.cursor }, skip: 1 }
        : {}),
    });
  }

  private mediaWhere(filters: {
    mediaType?: "image" | "video";
    uploaded?: boolean;
  }): Prisma.MediaWhereInput {
    return {
      ...(filters.mediaType ? { mediaType: filters.mediaType } : {}),
      ...(filters.uploaded === undefined
        ? {}
        : { uploadedAt: filters.uploaded ? { not: null } : null }),
    };
  }
}
