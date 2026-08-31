import { Injectable } from "@nestjs/common";
import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { DatabaseService } from "../domain/database/database.service";
import {
  characterActionLogs,
  characters,
  hashtags,
  media,
  postComments,
  postHashtags,
  postMedia,
  postReactions,
  posts,
  stories,
} from "../domain/database/schema";

export type AdminMediaRecord = Pick<
  typeof media.$inferSelect,
  | "id"
  | "mediaType"
  | "url"
  | "contentType"
  | "byteSize"
  | "width"
  | "height"
  | "durationSeconds"
  | "uploadedAt"
  | "createdAt"
>;
export type AdminPostRecord = typeof posts.$inferSelect & {
  postMedia: Array<
    typeof postMedia.$inferSelect & { media: typeof media.$inferSelect }
  >;
  hashtags: Array<
    typeof postHashtags.$inferSelect & { hashtag: typeof hashtags.$inferSelect }
  >;
  _count: { comments: number; reactions: number };
};
export type AdminStoryRecord = typeof stories.$inferSelect & {
  media: typeof media.$inferSelect;
};
export type AdminPostCommentRecord = typeof postComments.$inferSelect;
export type AdminPostReactionRecord = typeof postReactions.$inferSelect;
type MediaInput =
  | {
      mediaType: "image" | "video";
      url: string;
      width?: number;
      height?: number;
      durationSeconds?: number;
    }
  | { mediaId: string };

const adminMediaFields = {
  id: media.id,
  mediaType: media.mediaType,
  url: media.url,
  contentType: media.contentType,
  byteSize: media.byteSize,
  width: media.width,
  height: media.height,
  durationSeconds: media.durationSeconds,
  uploadedAt: media.uploadedAt,
  createdAt: media.createdAt,
} as const;

@Injectable()
export class AdminContentRepository {
  constructor(private readonly database: DatabaseService) {}

  async hasMediaCursor(
    cursorId: string,
    filters: { mediaType?: "image" | "video"; uploaded?: boolean },
  ): Promise<boolean> {
    const rows = await this.database.client
      .select({ id: media.id })
      .from(media)
      .where(and(eq(media.id, cursorId), this.mediaCondition(filters)))
      .limit(1);
    return rows.length > 0;
  }

  async listMedia(input: {
    filters: { mediaType?: "image" | "video"; uploaded?: boolean };
    cursorId?: string;
    limit: number;
  }): Promise<AdminMediaRecord[]> {
    const [cursor] = input.cursorId
      ? await this.database.client
          .select({ id: media.id, createdAt: media.createdAt })
          .from(media)
          .where(eq(media.id, input.cursorId))
          .limit(1)
      : [];
    return this.database.client
      .select(adminMediaFields)
      .from(media)
      .where(
        and(
          this.mediaCondition(input.filters),
          cursor
            ? or(
                lt(media.createdAt, cursor.createdAt),
                and(
                  eq(media.createdAt, cursor.createdAt),
                  lt(media.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(media.createdAt), desc(media.id))
      .limit(input.limit + 1);
  }

  getMedia(mediaId: string): Promise<AdminMediaRecord | null> {
    return this.database.client
      .select(adminMediaFields)
      .from(media)
      .where(eq(media.id, mediaId))
      .limit(1)
      .then(([row]) => row ?? null);
  }

  getStoredMedia(mediaId: string) {
    return this.database.client
      .select({
        id: media.id,
        mediaType: media.mediaType,
        uploadedAt: media.uploadedAt,
      })
      .from(media)
      .where(eq(media.id, mediaId))
      .limit(1)
      .then(([row]) => row ?? null);
  }

  async hasPostCursor(
    cursorId: string,
    filters: { characterId?: string; contentType?: "feed" | "reel" },
  ): Promise<boolean> {
    const rows = await this.database.client
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.id, cursorId), this.postCondition(filters)))
      .limit(1);
    return rows.length > 0;
  }

  async listPosts(input: {
    filters: { characterId?: string; contentType?: "feed" | "reel" };
    cursorId?: string;
    limit: number;
  }): Promise<AdminPostRecord[]> {
    const [cursor] = input.cursorId
      ? await this.database.client
          .select({ id: posts.id, createdAt: posts.createdAt })
          .from(posts)
          .where(eq(posts.id, input.cursorId))
          .limit(1)
      : [];
    const rows = await this.database.client
      .select()
      .from(posts)
      .where(
        and(
          this.postCondition(input.filters),
          cursor
            ? or(
                lt(posts.createdAt, cursor.createdAt),
                and(
                  eq(posts.createdAt, cursor.createdAt),
                  lt(posts.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(input.limit + 1);
    return this.hydratePosts(rows);
  }

  async getPost(postId: string): Promise<AdminPostRecord | null> {
    const [row] = await this.database.client
      .select()
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);
    return row ? (await this.hydratePosts([row]))[0] : null;
  }

  async hasPost(postId: string): Promise<boolean> {
    const rows = await this.database.client
      .select({ id: posts.id })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);
    return rows.length > 0;
  }

  async hasCharacter(characterId: string): Promise<boolean> {
    const rows = await this.database.client
      .select({ id: characters.id })
      .from(characters)
      .where(eq(characters.id, characterId))
      .limit(1);
    return rows.length > 0;
  }

  async createPost(input: {
    characterId: string;
    contentType: "feed" | "reel";
    content: string;
    hashtags: string[];
    media: MediaInput[];
  }): Promise<AdminPostRecord> {
    const post = await this.database.client.transaction(async (tx) => {
      const [created] = await tx
        .insert(posts)
        .values({
          characterId: input.characterId,
          contentType: input.contentType,
          content: input.content,
        })
        .returning();
      for (const name of input.hashtags) {
        const [tag] = await tx
          .insert(hashtags)
          .values({ name })
          .onConflictDoUpdate({ target: hashtags.name, set: { name } })
          .returning({ id: hashtags.id });
        await tx
          .insert(postHashtags)
          .values({ postId: created.id, hashtagId: tag.id });
      }
      for (const [sortOrder, item] of input.media.entries()) {
        const mediaId =
          "mediaId" in item
            ? item.mediaId
            : (
                await tx.insert(media).values(item).returning({ id: media.id })
              )[0].id;
        await tx
          .insert(postMedia)
          .values({ postId: created.id, mediaId, sortOrder });
      }
      return created;
    });
    return (await this.hydratePosts([post]))[0];
  }

  async hasStoryCursor(
    cursorId: string,
    characterId?: string,
  ): Promise<boolean> {
    const rows = await this.database.client
      .select({ id: stories.id })
      .from(stories)
      .where(
        and(
          eq(stories.id, cursorId),
          characterId ? eq(stories.characterId, characterId) : undefined,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async listStories(input: {
    characterId?: string;
    cursorId?: string;
    limit: number;
  }): Promise<AdminStoryRecord[]> {
    const [cursor] = input.cursorId
      ? await this.database.client
          .select({ id: stories.id, createdAt: stories.createdAt })
          .from(stories)
          .where(eq(stories.id, input.cursorId))
          .limit(1)
      : [];
    return this.database.client
      .select({ story: stories, media })
      .from(stories)
      .innerJoin(media, eq(media.id, stories.mediaId))
      .where(
        and(
          input.characterId
            ? eq(stories.characterId, input.characterId)
            : undefined,
          cursor
            ? or(
                lt(stories.createdAt, cursor.createdAt),
                and(
                  eq(stories.createdAt, cursor.createdAt),
                  lt(stories.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(stories.createdAt), desc(stories.id))
      .limit(input.limit + 1)
      .then((rows) =>
        rows.map(({ story, media: mediaRow }) => ({
          ...story,
          media: mediaRow,
        })),
      );
  }

  getStory(storyId: string): Promise<AdminStoryRecord | null> {
    return this.database.client
      .select({ story: stories, media })
      .from(stories)
      .innerJoin(media, eq(media.id, stories.mediaId))
      .where(eq(stories.id, storyId))
      .limit(1)
      .then(([row]) => (row ? { ...row.story, media: row.media } : null));
  }

  async createStory(input: {
    characterId: string;
    caption: string;
    expiresAt: Date;
    media: MediaInput;
  }): Promise<AdminStoryRecord> {
    const story = await this.database.client.transaction(async (tx) => {
      const mediaId =
        "mediaId" in input.media
          ? input.media.mediaId
          : (
              await tx
                .insert(media)
                .values(input.media)
                .returning({ id: media.id })
            )[0].id;
      return (
        await tx
          .insert(stories)
          .values({
            characterId: input.characterId,
            caption: input.caption,
            expiresAt: input.expiresAt,
            mediaId,
          })
          .returning()
      )[0];
    });
    const mediaRow = (
      await this.database.client
        .select()
        .from(media)
        .where(eq(media.id, story.mediaId))
        .limit(1)
    )[0];
    return { ...story, media: mediaRow };
  }

  hasCommentCursor(
    cursorId: string,
    filters: { postId: string; characterId?: string },
  ): Promise<boolean> {
    return this.database.client
      .select({ id: postComments.id })
      .from(postComments)
      .where(and(eq(postComments.id, cursorId), this.commentCondition(filters)))
      .limit(1)
      .then((rows) => rows.length > 0);
  }

  async listComments(input: {
    filters: { postId: string; characterId?: string };
    cursorId?: string;
    limit: number;
  }): Promise<AdminPostCommentRecord[]> {
    const [cursor] = input.cursorId
      ? await this.database.client
          .select({ id: postComments.id, createdAt: postComments.createdAt })
          .from(postComments)
          .where(eq(postComments.id, input.cursorId))
          .limit(1)
      : [];
    return this.database.client
      .select()
      .from(postComments)
      .where(
        and(
          this.commentCondition(input.filters),
          cursor
            ? or(
                lt(postComments.createdAt, cursor.createdAt),
                and(
                  eq(postComments.createdAt, cursor.createdAt),
                  lt(postComments.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(postComments.createdAt), desc(postComments.id))
      .limit(input.limit + 1);
  }

  async createComment(input: {
    postId: string;
    characterId: string;
    body: string;
  }): Promise<AdminPostCommentRecord> {
    return (
      await this.database.client.insert(postComments).values(input).returning()
    )[0];
  }

  hasReactionCursor(
    cursorId: string,
    filters: { postId: string; characterId?: string; reactionType?: string },
  ): Promise<boolean> {
    return this.database.client
      .select({ id: postReactions.id })
      .from(postReactions)
      .where(
        and(eq(postReactions.id, cursorId), this.reactionCondition(filters)),
      )
      .limit(1)
      .then((rows) => rows.length > 0);
  }

  async listReactions(input: {
    filters: { postId: string; characterId?: string; reactionType?: string };
    cursorId?: string;
    limit: number;
  }): Promise<AdminPostReactionRecord[]> {
    const [cursor] = input.cursorId
      ? await this.database.client
          .select({ id: postReactions.id, createdAt: postReactions.createdAt })
          .from(postReactions)
          .where(eq(postReactions.id, input.cursorId))
          .limit(1)
      : [];
    return this.database.client
      .select()
      .from(postReactions)
      .where(
        and(
          this.reactionCondition(input.filters),
          cursor
            ? or(
                lt(postReactions.createdAt, cursor.createdAt),
                and(
                  eq(postReactions.createdAt, cursor.createdAt),
                  lt(postReactions.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(postReactions.createdAt), desc(postReactions.id))
      .limit(input.limit + 1);
  }

  async createReaction(input: {
    postId: string;
    characterId: string;
    reactionType: string;
  }): Promise<AdminPostReactionRecord> {
    return (
      await this.database.client.insert(postReactions).values(input).returning()
    )[0];
  }

  recordCharacterAction(input: typeof characterActionLogs.$inferInsert) {
    return this.database.client
      .insert(characterActionLogs)
      .values(input)
      .returning()
      .then(([row]) => row);
  }

  async listCharacterActions(input: {
    characterId?: string;
    cursor?: bigint;
    limit: number;
  }) {
    const [cursor] =
      input.cursor !== undefined
        ? await this.database.client
            .select({
              id: characterActionLogs.id,
              createdAt: characterActionLogs.createdAt,
            })
            .from(characterActionLogs)
            .where(eq(characterActionLogs.id, input.cursor))
            .limit(1)
        : [];
    return this.database.client
      .select()
      .from(characterActionLogs)
      .where(
        and(
          input.characterId
            ? eq(characterActionLogs.characterId, input.characterId)
            : undefined,
          cursor
            ? or(
                lt(characterActionLogs.createdAt, cursor.createdAt),
                and(
                  eq(characterActionLogs.createdAt, cursor.createdAt),
                  lt(characterActionLogs.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(
        desc(characterActionLogs.createdAt),
        desc(characterActionLogs.id),
      )
      .limit(input.limit + 1);
  }

  private async hydratePosts(
    rows: Array<typeof posts.$inferSelect>,
  ): Promise<AdminPostRecord[]> {
    return Promise.all(
      rows.map(async (post) => {
        const [mediaRows, hashtagRows, counts] = await Promise.all([
          this.database.client
            .select({
              postId: postMedia.postId,
              mediaId: postMedia.mediaId,
              sortOrder: postMedia.sortOrder,
              media,
            })
            .from(postMedia)
            .innerJoin(media, eq(media.id, postMedia.mediaId))
            .where(eq(postMedia.postId, post.id))
            .orderBy(asc(postMedia.sortOrder)),
          this.database.client
            .select({
              postId: postHashtags.postId,
              hashtagId: postHashtags.hashtagId,
              hashtag: hashtags,
            })
            .from(postHashtags)
            .innerJoin(hashtags, eq(hashtags.id, postHashtags.hashtagId))
            .where(eq(postHashtags.postId, post.id))
            .orderBy(asc(hashtags.name)),
          this.database.client.execute<{ comments: number; reactions: number }>(
            sql`select (select count(*)::int from ${postComments} where ${postComments.postId} = ${post.id}) as comments, (select count(*)::int from ${postReactions} where ${postReactions.postId} = ${post.id}) as reactions`,
          ),
        ]);
        return {
          ...post,
          postMedia: mediaRows,
          hashtags: hashtagRows,
          _count: counts.rows[0] ?? { comments: 0, reactions: 0 },
        };
      }),
    );
  }

  private mediaCondition(filters: {
    mediaType?: "image" | "video";
    uploaded?: boolean;
  }) {
    return and(
      filters.mediaType ? eq(media.mediaType, filters.mediaType) : undefined,
      filters.uploaded === undefined
        ? undefined
        : filters.uploaded
          ? isNotNull(media.uploadedAt)
          : isNull(media.uploadedAt),
    );
  }
  private postCondition(filters: {
    characterId?: string;
    contentType?: "feed" | "reel";
  }) {
    return and(
      filters.characterId
        ? eq(posts.characterId, filters.characterId)
        : undefined,
      filters.contentType
        ? eq(posts.contentType, filters.contentType)
        : undefined,
    );
  }
  private commentCondition(filters: { postId: string; characterId?: string }) {
    return and(
      eq(postComments.postId, filters.postId),
      filters.characterId
        ? eq(postComments.characterId, filters.characterId)
        : undefined,
    );
  }
  private reactionCondition(filters: {
    postId: string;
    characterId?: string;
    reactionType?: string;
  }) {
    return and(
      eq(postReactions.postId, filters.postId),
      filters.characterId
        ? eq(postReactions.characterId, filters.characterId)
        : undefined,
      filters.reactionType
        ? eq(postReactions.reactionType, filters.reactionType)
        : undefined,
    );
  }
}
