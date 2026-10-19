import { ConflictException, Injectable } from "@nestjs/common";
import { and, asc, eq, gt, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { DatabaseService } from "../core/database/database.service";
import { influencerMedia } from "../core/database/schema";
export type InfluencerMediaRow = typeof influencerMedia.$inferSelect;
export type MediaWrite = typeof influencerMedia.$inferInsert;
export type MediaFilter = {
  influencerId?: bigint;
  postId?: string;
  slideIndex?: number;
  after?: bigint;
  limit: number;
  work?: string;
  model?: string;
};
@Injectable()
export class InfluencerMediaRepository {
  constructor(private readonly db: DatabaseService) {}
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
          input.influencerId
            ? eq(influencerMedia.influencerId, input.influencerId)
            : undefined,
          input.postId ? eq(influencerMedia.postId, input.postId) : undefined,
          input.slideIndex
            ? eq(influencerMedia.slideIndex, input.slideIndex)
            : undefined,
          input.after ? gt(influencerMedia.id, input.after) : undefined,
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
      .orderBy(asc(influencerMedia.id))
      .limit(input.limit);
  }
}
