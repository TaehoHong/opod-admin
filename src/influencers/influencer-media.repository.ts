import { ConflictException, Injectable } from "@nestjs/common";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  lt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { DatabaseService } from "../core/database/database.service";
import { influencerMedia } from "../core/database/schema";
export type InfluencerMediaRow = typeof influencerMedia.$inferSelect;
export type MediaWrite = typeof influencerMedia.$inferInsert;
export type MediaFilter = {
  influencerIds?: bigint[];
  influencerId?: bigint;
  postId?: string;
  slideIndex?: number;
  after?: bigint;
  limit: number;
  work?: string;
  model?: string;
  assetType?: string;
  analysisStatus?: string;
  search?: string;
  order?: string;
};
export type ReferenceMediaSearch = {
  influencerIds: bigint[];
  embedding: number[];
  model: string;
  excludedMediaIds?: bigint[];
  excludedSha256s?: string[];
  limit?: number;
};
export type InfluencerReferenceCandidate = {
  mediaId: string;
  influencerId: string;
  postId: string;
  slideIndex: number;
  mediaKey: string;
  sha256: string;
  sourceCaption: string | null;
  analysis: Record<string, string | number | null>;
  score: number;
};
@Injectable()
export class InfluencerMediaRepository {
  constructor(private readonly db: DatabaseService) {}
  async searchReferences(
    input: ReferenceMediaSearch,
  ): Promise<InfluencerReferenceCandidate[]> {
    if (!input.influencerIds.length) return [];
    const distance = sql<number>`${influencerMedia.embedding} OPERATOR(public.<=>) ${JSON.stringify(input.embedding)}::public.vector(1024)`;
    const rows = await this.db.client
      .select({ media: influencerMedia, score: sql<number>`1 - (${distance})` })
      .from(influencerMedia)
      .where(
        and(
          inArray(influencerMedia.influencerId, input.influencerIds),
          eq(influencerMedia.embeddingModel, input.model),
          isNotNull(influencerMedia.embedding),
          sql`public.vector_norm(${influencerMedia.embedding}) > 0`,
          isNotNull(influencerMedia.analysis),
          sql`jsonb_typeof(${influencerMedia.analysis}) = 'object'`,
          sql`jsonb_typeof(${influencerMedia.analysis}->'description') = 'string' AND btrim(${influencerMedia.analysis}->>'description') <> ''`,
          sql`btrim(${influencerMedia.mediaKey}) <> ''`,
          input.excludedMediaIds?.length
            ? notInArray(influencerMedia.id, input.excludedMediaIds)
            : undefined,
          input.excludedSha256s?.length
            ? notInArray(influencerMedia.sha256, input.excludedSha256s)
            : undefined,
        ),
      )
      .orderBy(asc(distance), asc(influencerMedia.id))
      .limit(Math.min(12, Math.max(1, input.limit ?? 12)));
    return rows.map(({ media, score }) => ({
      mediaId: String(media.id),
      influencerId: String(media.influencerId),
      postId: media.postId,
      slideIndex: media.slideIndex,
      mediaKey: media.mediaKey,
      sha256: media.sha256,
      sourceCaption: media.sourceCaption,
      analysis: media.analysis!,
      score: Number(score),
    }));
  }
  findReadSources(influencerIds: bigint[], mediaIds: bigint[]) {
    if (!influencerIds.length || !mediaIds.length) return Promise.resolve([]);
    return this.db.client
      .select()
      .from(influencerMedia)
      .where(
        and(
          inArray(influencerMedia.influencerId, influencerIds),
          inArray(influencerMedia.id, mediaIds),
        ),
      );
  }
  private identity(value: {
    influencerId: bigint;
    postId: string;
    slideIndex: number;
  }) {
    return and(
      eq(influencerMedia.influencerId, value.influencerId),
      eq(influencerMedia.postId, value.postId),
      eq(influencerMedia.slideIndex, value.slideIndex),
    );
  }
  async find(value: {
    influencerId: bigint;
    postId: string;
    slideIndex: number;
  }) {
    const [row] = await this.db.client
      .select()
      .from(influencerMedia)
      .where(this.identity(value));
    return row;
  }
  async register(value: MediaWrite) {
    return this.db.client.transaction(async (tx) => {
      // Serialize every slide of a post, including the first insert with no row to lock.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([String(value.influencerId), value.postId])}, 0))`,
      );
      const post = and(
        eq(influencerMedia.influencerId, value.influencerId),
        eq(influencerMedia.postId, value.postId),
      );
      let sourceCaption = value.sourceCaption;
      if (sourceCaption === undefined || sourceCaption === null) {
        const [known] = await tx
          .select({ sourceCaption: influencerMedia.sourceCaption })
          .from(influencerMedia)
          .where(and(post, isNotNull(influencerMedia.sourceCaption)))
          .limit(1);
        sourceCaption = known?.sourceCaption ?? null;
      }
      const inserted = await tx
        .insert(influencerMedia)
        .values({ ...value, sourceCaption })
        .onConflictDoNothing()
        .returning();
      if (inserted.length) {
        if (value.sourceCaption !== undefined && value.sourceCaption !== null)
          await tx.update(influencerMedia).set({ sourceCaption }).where(post);
        return { row: inserted[0], created: true };
      }
      let [row] = await tx
        .select()
        .from(influencerMedia)
        .where(this.identity(value))
        .for("update");
      if (row.sha256 !== value.sha256 || row.assetType !== value.assetType)
        throw new ConflictException("media_identity_conflict");
      if (value.sourceCaption !== undefined && value.sourceCaption !== null) {
        await tx.update(influencerMedia).set({ sourceCaption }).where(post);
        row = { ...row, sourceCaption };
      }
      if (
        value.analysis &&
        (!isDeepStrictEqual(row.analysis, value.analysis) ||
          row.analysisModel !== value.analysisModel ||
          row.analysisVersion !== value.analysisVersion)
      ) {
        const [updated] = await tx
          .update(influencerMedia)
          .set({
            analysis: value.analysis,
            analysisModel: value.analysisModel,
            analysisVersion: value.analysisVersion,
            embedding: null,
            embeddingModel: null,
          })
          .where(eq(influencerMedia.id, row.id))
          .returning();
        return { row: updated, created: false };
      }
      return { row, created: false };
    });
  }
  private analysisSnapshot(row: InfluencerMediaRow) {
    return and(
      eq(influencerMedia.id, row.id),
      sql`${influencerMedia.analysis} = ${JSON.stringify(row.analysis)}::jsonb`,
      eq(influencerMedia.analysisModel, row.analysisModel!),
      eq(influencerMedia.analysisVersion, row.analysisVersion!),
    );
  }
  async prepareEmbedding(row: InfluencerMediaRow, model: string) {
    const [current] = await this.db.client
      .update(influencerMedia)
      .set({ embedding: null, embeddingModel: model })
      .where(
        and(
          this.analysisSnapshot(row),
          or(
            isNull(influencerMedia.embedding),
            isNull(influencerMedia.embeddingModel),
            ne(influencerMedia.embeddingModel, model),
          ),
        ),
      )
      .returning();
    if (current) return current;
    const [existing] = await this.db.client
      .select()
      .from(influencerMedia)
      .where(this.analysisSnapshot(row));
    return existing;
  }
  async saveEmbedding(
    row: InfluencerMediaRow,
    model: string,
    vector: number[],
  ) {
    const updated = await this.db.client
      .update(influencerMedia)
      .set({ embedding: vector })
      .where(
        and(
          this.analysisSnapshot(row),
          eq(influencerMedia.embeddingModel, model),
        ),
      )
      .returning({ id: influencerMedia.id });
    return updated.length > 0;
  }
  list(input: MediaFilter) {
    return this.db.client
      .select()
      .from(influencerMedia)
      .where(
        and(
          input.influencerIds
            ? inArray(influencerMedia.influencerId, input.influencerIds)
            : undefined,
          input.influencerId
            ? eq(influencerMedia.influencerId, input.influencerId)
            : undefined,
          input.postId ? eq(influencerMedia.postId, input.postId) : undefined,
          input.slideIndex
            ? eq(influencerMedia.slideIndex, input.slideIndex)
            : undefined,
          input.after
            ? (input.order === "newest" ? lt : gt)(
                influencerMedia.id,
                input.after,
              )
            : undefined,
          input.assetType
            ? eq(influencerMedia.assetType, input.assetType)
            : undefined,
          input.analysisStatus === "ready"
            ? isNotNull(influencerMedia.analysis)
            : undefined,
          input.analysisStatus === "missing"
            ? isNull(influencerMedia.analysis)
            : undefined,
          input.search
            ? or(
                ilike(influencerMedia.postId, `%${input.search}%`),
                ilike(
                  sql<string>`${influencerMedia.analysis}->>'description'`,
                  `%${input.search}%`,
                ),
              )
            : undefined,
          input.work === "analysis"
            ? isNull(influencerMedia.analysis)
            : undefined,
          input.work === "embedding"
            ? and(
                isNotNull(influencerMedia.analysis),
                or(
                  isNull(influencerMedia.embedding),
                  isNull(influencerMedia.embeddingModel),
                  ne(influencerMedia.embeddingModel, input.model ?? ""),
                ),
              )
            : undefined,
        ),
      )
      .orderBy((input.order === "newest" ? desc : asc)(influencerMedia.id))
      .limit(input.limit);
  }
}
