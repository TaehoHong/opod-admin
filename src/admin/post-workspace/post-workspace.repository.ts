import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { DatabaseService } from "../../domain/database/database.service";
import {
  generationJobOutputs,
  generationJobs,
  media,
  postComments,
  postDrafts,
  postMedia,
  postReactions,
  posts,
} from "../../domain/database/schema";

type JobOutput = Pick<
  typeof generationJobOutputs.$inferSelect,
  "selected" | "mediaId"
> & { media: { url: string } };
type DraftJob = Pick<
  typeof generationJobs.$inferSelect,
  | "id"
  | "sortOrder"
  | "status"
  | "prompt"
  | "attemptCount"
  | "updatedAt"
  | "createdAt"
> & { outputs: JobOutput[] };
type PublishedPost = typeof posts.$inferSelect & {
  postMedia: Array<typeof postMedia.$inferSelect & { media: { url: string } }>;
};
export type PostWorkDraft = typeof postDrafts.$inferSelect & {
  publishedPost: PublishedPost | null;
  jobs: DraftJob[];
};
export type StandalonePost = typeof posts.$inferSelect & {
  postMedia: Array<typeof postMedia.$inferSelect & { media: { url: string } }>;
};
type PostDraftStatus = (typeof postDrafts.$inferSelect)["status"];
export type PostDraftFilter = {
  status?: PostDraftStatus | { in: PostDraftStatus[] };
};

@Injectable()
export class PostWorkspaceRepository {
  constructor(private readonly database: DatabaseService) {}

  async findDrafts(input: {
    where: PostDraftFilter;
    before?: Date;
    take: number;
  }): Promise<PostWorkDraft[]> {
    const status = input.where.status;
    const rows = await this.database.client
      .select()
      .from(postDrafts)
      .where(
        and(
          typeof status === "string"
            ? eq(postDrafts.status, status)
            : status
              ? inArray(postDrafts.status, status.in)
              : undefined,
          input.before ? lte(postDrafts.updatedAt, input.before) : undefined,
        ),
      )
      .orderBy(desc(postDrafts.updatedAt), desc(postDrafts.id))
      .limit(input.take);
    return this.hydrateDrafts(rows);
  }

  async findStandalonePosts(input: {
    onlyStandalone: true;
    before?: Date;
    take: number;
  }): Promise<StandalonePost[]> {
    const rows = await this.database.client
      .select({ post: posts })
      .from(posts)
      .leftJoin(postDrafts, eq(postDrafts.publishedPostId, posts.id))
      .where(
        and(
          isNull(postDrafts.id),
          input.before ? lte(posts.createdAt, input.before) : undefined,
        ),
      )
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(input.take);
    return this.hydratePosts(rows.map(({ post }) => post));
  }

  async findDraft(id: string): Promise<PostWorkDraft | null> {
    const [row] = await this.database.client
      .select()
      .from(postDrafts)
      .where(eq(postDrafts.id, id))
      .limit(1);
    return row ? (await this.hydrateDrafts([row]))[0] : null;
  }

  async findStandalonePost(id: string): Promise<StandalonePost | null> {
    const [row] = await this.database.client
      .select({ post: posts })
      .from(posts)
      .leftJoin(postDrafts, eq(postDrafts.publishedPostId, posts.id))
      .where(and(eq(posts.id, id), isNull(postDrafts.id)))
      .limit(1);
    return row ? (await this.hydratePosts([row.post]))[0] : null;
  }

  private async hydrateDrafts(
    rows: Array<typeof postDrafts.$inferSelect>,
  ): Promise<PostWorkDraft[]> {
    return Promise.all(
      rows.map(async (draft) => {
        const [publishedPost, jobs] = await Promise.all([
          draft.publishedPostId
            ? this.findPostWithMedia(draft.publishedPostId)
            : null,
          this.database.client
            .select({
              id: generationJobs.id,
              sortOrder: generationJobs.sortOrder,
              status: generationJobs.status,
              prompt: generationJobs.prompt,
              attemptCount: generationJobs.attemptCount,
              updatedAt: generationJobs.updatedAt,
              createdAt: generationJobs.createdAt,
            })
            .from(generationJobs)
            .where(eq(generationJobs.draftId, draft.id))
            .orderBy(desc(generationJobs.createdAt), desc(generationJobs.id)),
        ]);
        const hydratedJobs = await Promise.all(
          jobs.map(async (job) => ({
            ...job,
            outputs: await this.database.client
              .select({
                selected: generationJobOutputs.selected,
                mediaId: generationJobOutputs.mediaId,
                media: { url: media.url },
              })
              .from(generationJobOutputs)
              .innerJoin(media, eq(media.id, generationJobOutputs.mediaId))
              .where(eq(generationJobOutputs.jobId, job.id))
              .orderBy(asc(generationJobOutputs.candidateIndex)),
          })),
        );
        return { ...draft, publishedPost, jobs: hydratedJobs };
      }),
    );
  }

  private hydratePosts(
    rows: Array<typeof posts.$inferSelect>,
  ): Promise<StandalonePost[]> {
    return Promise.all(
      rows.map(async (post) => ({
        ...post,
        postMedia: await this.listPostMedia(post.id),
      })),
    );
  }

  private async findPostWithMedia(
    postId: string,
  ): Promise<PublishedPost | null> {
    const [post] = await this.database.client
      .select()
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);
    return post
      ? { ...post, postMedia: await this.listPostMedia(post.id) }
      : null;
  }

  private listPostMedia(postId: string) {
    return this.database.client
      .select({
        postId: postMedia.postId,
        mediaId: postMedia.mediaId,
        sortOrder: postMedia.sortOrder,
        media: { url: media.url },
      })
      .from(postMedia)
      .innerJoin(media, eq(media.id, postMedia.mediaId))
      .where(eq(postMedia.postId, postId))
      .orderBy(asc(postMedia.sortOrder));
  }

  async countPostInteractions(
    postId: string,
  ): Promise<{ commentCount: number; reactionCount: number }> {
    const result = await this.database.client.execute<{
      commentCount: number;
      reactionCount: number;
    }>(sql`
      select
        (select count(*)::int from ${postComments} where ${postComments.postId} = ${postId}) as "commentCount",
        (select count(*)::int from ${postReactions} where ${postReactions.postId} = ${postId}) as "reactionCount"
    `);
    return result.rows[0] ?? { commentCount: 0, reactionCount: 0 };
  }
}
