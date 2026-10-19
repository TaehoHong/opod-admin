import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { DatabaseService } from "../core/database/database.service";
import {
  characterActionLogs,
  characters,
  generationJobOutputs,
  generationJobs,
  media,
  postDrafts,
} from "../core/database/schema";

export type PostDraftStatus = (typeof postDrafts.$inferSelect)["status"];
export type DraftRow = typeof postDrafts.$inferSelect;
export type DraftJobRow = Pick<
  typeof generationJobs.$inferSelect,
  | "id"
  | "sortOrder"
  | "status"
  | "prompt"
  | "paramsJson"
  | "candidateCount"
  | "provider"
  | "costUsd"
  | "errorMessage"
  | "attemptCount"
  | "createdAt"
  | "updatedAt"
> & {
  outputs: Array<
    Pick<
      typeof generationJobOutputs.$inferSelect,
      "mediaId" | "candidateIndex" | "selected" | "filterPreset"
    > & { media: { url: string } }
  >;
};
export type RegenerationSource = Pick<
  typeof generationJobs.$inferSelect,
  | "id"
  | "characterId"
  | "sortOrder"
  | "status"
  | "inputPrompt"
  | "prompt"
  | "candidateCount"
  | "paramsJson"
>;
export type RegenerationResult =
  | { outcome: "regenerated"; jobId: string }
  | { outcome: "stale-job" }
  | { outcome: "draft-not-found" }
  | { outcome: "invalid-draft-status" };
export type PlanEditDraft = Pick<
  typeof postDrafts.$inferSelect,
  "id" | "characterId" | "status" | "leaseExpiresAt" | "conceptJson"
> & {
  jobs: Array<
    Pick<typeof generationJobs.$inferSelect, "id" | "sortOrder" | "paramsJson">
  >;
};

export function v4PausedAt(stages: ("caption" | "publish")[]): SQL {
  return and(
    eq(postDrafts.status, "planned"),
    inArray(
      sql<string>`${postDrafts.conceptJson}#>>'{pipeline,stage}'`,
      stages,
    ),
    or(
      eq(
        sql<string>`${postDrafts.conceptJson}#>>'{pipeline,state}'`,
        "pending",
      ),
      and(
        eq(
          sql<string>`${postDrafts.conceptJson}->>'postGenerationAgent'`,
          "natural-v1",
        ),
        eq(
          sql<string>`${postDrafts.conceptJson}#>>'{pipeline,state}'`,
          "needs_input",
        ),
        eq(
          sql<string>`${postDrafts.conceptJson}#>>'{pipeline,failure,code}'`,
          "photo_quality_rejected",
        ),
        eq(
          sql<string>`${postDrafts.conceptJson}#>>'{pipeline,stage}'`,
          "caption",
        ),
      ),
    ),
  )!;
}

@Injectable()
export class DraftsRepository {
  constructor(private readonly database: DatabaseService) {}

  async cursorMatchesFilter(
    cursorId: string,
    filter: { status?: PostDraftStatus; characterId?: string },
  ): Promise<boolean> {
    const rows = await this.database.client
      .select({ id: postDrafts.id })
      .from(postDrafts)
      .where(and(eq(postDrafts.id, cursorId), this.draftFilter(filter)))
      .limit(1);
    return rows.length > 0;
  }

  async findMany(input: {
    status?: PostDraftStatus;
    characterId?: string;
    take: number;
    cursorId?: string;
  }): Promise<DraftRow[]> {
    const [cursor] = input.cursorId
      ? await this.database.client
          .select({ id: postDrafts.id, createdAt: postDrafts.createdAt })
          .from(postDrafts)
          .where(eq(postDrafts.id, input.cursorId))
          .limit(1)
      : [];
    return this.database.client
      .select()
      .from(postDrafts)
      .where(
        and(
          this.draftFilter(input),
          cursor
            ? or(
                lt(postDrafts.createdAt, cursor.createdAt),
                and(
                  eq(postDrafts.createdAt, cursor.createdAt),
                  lt(postDrafts.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(postDrafts.createdAt), desc(postDrafts.id))
      .limit(input.take);
  }

  findDraft(draftId: string): Promise<DraftRow | null> {
    return this.database.client
      .select()
      .from(postDrafts)
      .where(eq(postDrafts.id, draftId))
      .limit(1)
      .then(([row]) => row ?? null);
  }

  async findPublishedReferenceSources(characterId: string) {
    const rows = await this.database.client
      .select({ conceptJson: postDrafts.conceptJson })
      .from(postDrafts)
      .where(
        and(
          eq(postDrafts.characterId, characterId),
          eq(postDrafts.status, "published"),
        ),
      );
    const mediaIds = new Set<string>();
    const sha256s = new Set<string>();
    for (const row of rows) {
      const concept = row.conceptJson as {
        referenceSelection?: {
          shots?: { mediaId?: unknown; sha256?: unknown }[];
        };
      } | null;
      for (const shot of concept?.referenceSelection?.shots ?? []) {
        if (typeof shot.mediaId === "string") mediaIds.add(shot.mediaId);
        if (typeof shot.sha256 === "string") sha256s.add(shot.sha256);
      }
    }
    return { mediaIds: [...mediaIds], sha256s: [...sha256s] };
  }

  async saveReferenceStage(input: {
    draftId: string;
    expectedConceptJson: unknown;
    conceptJson: unknown;
    status?: "generating" | "needs_review" | "failed";
    caption?: string;
    hashtags?: string[];
    expectedOutputs?: { jobId: string; mediaId: string }[];
  }): Promise<boolean> {
    const concept = input.conceptJson as Record<string, unknown>;
    const pipeline = concept.pipeline as Record<string, unknown>;
    const nextState = pipeline?.state;
    const status =
      input.status ??
      (nextState === "ready" || nextState === "pending"
        ? "planned"
        : nextState === "needs_input" || nextState === "failed"
          ? "failed"
          : "generating");
    const conceptJson =
      nextState === "ready"
        ? { ...concept, pipeline: { ...pipeline, state: "pending" } }
        : concept;
    const rows = await this.database.client
      .update(postDrafts)
      .set({
        conceptJson,
        status,
        leaseExpiresAt: null,
        updatedAt: new Date(),
        ...(input.caption !== undefined ? { caption: input.caption } : {}),
        ...(input.hashtags !== undefined ? { hashtags: input.hashtags } : {}),
      })
      .where(
        and(
          eq(postDrafts.id, input.draftId),
          inArray(postDrafts.status, ["generating", "regenerating"]),
          sql`${postDrafts.conceptJson}->>'postGenerationAgent' = 'reference-v1'`,
          sql`${postDrafts.conceptJson} = ${JSON.stringify(input.expectedConceptJson)}::jsonb`,
          ...(input.expectedOutputs ?? []).map(
            (output) => sql`exists (
            select 1 from ${generationJobs} j
            inner join ${generationJobOutputs} o on o.job_id = j.id
            where j.id = ${output.jobId} and j.draft_id = ${input.draftId}
            and j.status = 'completed' and o.media_id = ${output.mediaId} and o.selected = true
          )`,
          ),
        ),
      )
      .returning({ id: postDrafts.id });
    return rows.length > 0;
  }

  async restartReferenceDraft(input: {
    draftId: string;
    expectedRevision: string;
    expectedConceptJson: unknown;
    conceptJson: unknown;
  }): Promise<boolean> {
    return this.database.client.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`reference-execute:${input.draftId.toLowerCase()}`}, 0))`,
      );
      const [draft] = await tx
        .select({ id: postDrafts.id })
        .from(postDrafts)
        .where(eq(postDrafts.id, input.draftId))
        .for("update");
      if (!draft) return false;
      const [updated] = await tx
        .update(postDrafts)
        .set({
          status: "planned",
          conceptJson: input.conceptJson,
          caption: "",
          hashtags: [],
          errorMessage: null,
          leaseExpiresAt: null,
          attemptCount: 0,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(postDrafts.id, input.draftId),
            sql`${postDrafts.status} not in ('published', 'rejected')`,
            sql`${postDrafts.conceptJson}->>'postGenerationAgent' = 'reference-v1'`,
            sql`(${postDrafts.leaseExpiresAt} is null or ${postDrafts.leaseExpiresAt} < clock_timestamp())`,
            sql`date_trunc('milliseconds', ${postDrafts.updatedAt}) = ${input.expectedRevision}::timestamptz`,
            sql`${postDrafts.conceptJson} = ${JSON.stringify(input.expectedConceptJson)}::jsonb`,
            sql`not exists (select 1 from ${generationJobs} j where j.draft_id = ${input.draftId} and j.status in ('queued', 'running') and coalesce(${postDrafts.conceptJson}#>'{generationBuild,jobIds}', '[]'::jsonb) ? j.id::text)`,
          ),
        )
        .returning({ id: postDrafts.id });
      return !!updated;
    });
  }

  listReferencePublicationsDue(now: Date, limit: number, retryBefore?: Date) {
    return this.database.client
      .select({ id: postDrafts.id })
      .from(postDrafts)
      .where(
        and(
          eq(postDrafts.status, "approved"),
          eq(postDrafts.draftType, "post"),
          sql`${postDrafts.conceptJson}->>'postGenerationAgent' = 'reference-v1'`,
          sql`(${postDrafts.conceptJson}->>'mode') is distinct from 'manual'`,
          sql`(${postDrafts.scheduledAt} is null or ${postDrafts.scheduledAt} <= ${now})`,
          sql`(${postDrafts.leaseExpiresAt} is null or ${postDrafts.leaseExpiresAt} < clock_timestamp())`,
          retryBefore
            ? or(
                isNull(postDrafts.errorMessage),
                sql`${postDrafts.updatedAt} <= ${retryBefore}`,
              )
            : undefined,
        ),
      )
      .orderBy(postDrafts.scheduledAt, postDrafts.id)
      .limit(limit);
  }

  async releaseReferencePublication(
    draftId: string,
    leaseExpiresAt: Date,
    message: string,
  ): Promise<void> {
    await this.database.client
      .update(postDrafts)
      .set({
        leaseExpiresAt: null,
        errorMessage: message.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(postDrafts.id, draftId),
          eq(postDrafts.status, "approved"),
          sql`${postDrafts.conceptJson}->>'postGenerationAgent' = 'reference-v1'`,
          eq(postDrafts.leaseExpiresAt, leaseExpiresAt),
        ),
      );
  }

  async pauseReferencePublicationConflict(input: {
    draftId: string;
    expectedConceptJson: unknown;
    message: string;
  }): Promise<boolean> {
    const rows = await this.database.client
      .update(postDrafts)
      .set({
        status: "needs_review",
        errorMessage: input.message,
        leaseExpiresAt: null,
        updatedAt: new Date(),
        conceptJson: sql`jsonb_set(jsonb_set(${postDrafts.conceptJson}, '{pipeline,state}', '"needs_input"'::jsonb), '{pipeline,blockers}', '["reference_source_conflict"]'::jsonb)`,
      })
      .where(
        and(
          eq(postDrafts.id, input.draftId),
          eq(postDrafts.status, "approved"),
          sql`${postDrafts.conceptJson}->>'postGenerationAgent' = 'reference-v1'`,
          sql`${postDrafts.conceptJson} = ${JSON.stringify(input.expectedConceptJson)}::jsonb`,
          sql`(${postDrafts.leaseExpiresAt} is null or ${postDrafts.leaseExpiresAt} < clock_timestamp())`,
        ),
      )
      .returning({ id: postDrafts.id });
    return rows.length > 0;
  }

  async claimReferencePublication(input: {
    draftId: string;
    leaseSeconds: number;
    expectedConceptJson: unknown;
    expectedOutputs: { jobId: string; mediaId: string }[];
  }): Promise<DraftRow | null> {
    if (!Number.isFinite(input.leaseSeconds) || input.leaseSeconds <= 0)
      throw new Error("Invalid publication lease");
    return this.database.client.transaction(async (tx) => {
      const [owner] = await tx
        .select({ characterId: postDrafts.characterId })
        .from(postDrafts)
        .where(eq(postDrafts.id, input.draftId));
      if (!owner) return null;
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`reference-publish:${owner.characterId}`}, 0))`,
      );
      const [draft] = await tx
        .select()
        .from(postDrafts)
        .where(eq(postDrafts.id, input.draftId))
        .for("update");
      if (
        !draft ||
        draft.status !== "approved" ||
        draft.characterId !== owner.characterId
      )
        return null;
      const concept = draft.conceptJson as {
        postGenerationAgent?: string;
        referenceSelection?: { shots?: { mediaId: string; sha256: string }[] };
      } | null;
      const sources = concept?.referenceSelection?.shots;
      if (concept?.postGenerationAgent !== "reference-v1" || !sources?.length)
        return null;
      const reservations = await tx
        .select({ id: postDrafts.id, conceptJson: postDrafts.conceptJson })
        .from(postDrafts)
        .where(
          and(
            eq(postDrafts.characterId, draft.characterId),
            sql`${postDrafts.id} <> ${input.draftId}`,
            or(
              eq(postDrafts.status, "published"),
              and(
                eq(postDrafts.status, "approved"),
                sql`${postDrafts.conceptJson}->>'postGenerationAgent' = 'reference-v1'`,
                sql`${postDrafts.leaseExpiresAt} > clock_timestamp()`,
              ),
            ),
          ),
        );
      const usedIds = new Set<string>();
      const usedHashes = new Set<string>();
      for (const row of reservations) {
        const prior = row.conceptJson as typeof concept;
        for (const source of prior?.referenceSelection?.shots ?? []) {
          usedIds.add(source.mediaId);
          usedHashes.add(source.sha256);
        }
      }
      if (
        sources.some(
          (source) =>
            usedIds.has(source.mediaId) || usedHashes.has(source.sha256),
        )
      )
        throw new Error("reference_source_already_published_or_reserved");
      const [claimed] = await tx
        .update(postDrafts)
        .set({
          leaseExpiresAt: sql`date_trunc('milliseconds', clock_timestamp()) + make_interval(secs => ${input.leaseSeconds})`,
        })
        .where(
          and(
            eq(postDrafts.id, input.draftId),
            eq(postDrafts.status, "approved"),
            sql`(${postDrafts.leaseExpiresAt} is null or ${postDrafts.leaseExpiresAt} < clock_timestamp())`,
            sql`${postDrafts.conceptJson} = ${JSON.stringify(input.expectedConceptJson)}::jsonb`,
            ...input.expectedOutputs.map(
              (output) =>
                sql`exists (select 1 from ${generationJobs} j inner join ${generationJobOutputs} o on o.job_id = j.id where j.id = ${output.jobId} and j.draft_id = ${input.draftId} and j.status = 'completed' and j.output_media_id = ${output.mediaId} and o.media_id = ${output.mediaId} and o.selected = true)`,
            ),
          ),
        )
        .returning();
      return claimed ?? null;
    });
  }

  async claimReferenceDraft(input: {
    leaseSeconds: number;
    draftId?: string;
    expectedStage?: string;
    expectedRevision?: string;
    expectedPromptRevision?: number;
  }): Promise<string | undefined> {
    return this.database.client.transaction(async (tx) => {
      const [draft] = await tx
        .select({ id: postDrafts.id, conceptJson: postDrafts.conceptJson })
        .from(postDrafts)
        .where(
          and(
            input.draftId
              ? inArray(postDrafts.status, ["planned", "failed"])
              : eq(postDrafts.status, "planned"),
            eq(postDrafts.draftType, "post"),
            sql`${postDrafts.conceptJson}->>'postGenerationAgent' = 'reference-v1'`,
            input.draftId
              ? sql`${postDrafts.conceptJson}#>>'{pipeline,state}' in ('pending','failed','needs_input')`
              : sql`${postDrafts.conceptJson}#>>'{pipeline,state}' = 'pending'`,
            sql`${postDrafts.conceptJson}#>>'{pipeline,stage}' in ('reference_select','image_prompt','generation','caption')`,
            input.draftId
              ? eq(postDrafts.id, input.draftId)
              : sql`(${postDrafts.conceptJson}->>'mode') is distinct from 'manual'`,
            input.expectedStage !== undefined
              ? sql`${postDrafts.conceptJson}#>>'{pipeline,stage}' = ${input.expectedStage}`
              : undefined,
            input.expectedRevision !== undefined
              ? sql`date_trunc('milliseconds', ${postDrafts.updatedAt}) = ${input.expectedRevision}::timestamptz`
              : undefined,
            input.expectedPromptRevision !== undefined
              ? sql`${postDrafts.conceptJson}#>>'{promptBuild,revision}' = ${String(input.expectedPromptRevision)}`
              : undefined,
          ),
        )
        .orderBy(postDrafts.createdAt, postDrafts.id)
        .limit(1)
        .for("update", { of: postDrafts, skipLocked: true });
      if (!draft) return undefined;
      const concept = draft.conceptJson as Record<string, unknown>;
      const pipeline = concept.pipeline as Record<string, unknown>;
      await tx
        .update(postDrafts)
        .set({
          status: "generating",
          leaseExpiresAt: new Date(Date.now() + input.leaseSeconds * 1000),
          updatedAt: new Date(),
          conceptJson: {
            ...concept,
            pipeline: { ...pipeline, state: "running" },
          },
          errorMessage: null,
        })
        .where(eq(postDrafts.id, draft.id));
      return draft.id;
    });
  }

  async recoverExpiredReferenceLeases(): Promise<number> {
    const rows = await this.database.client
      .update(postDrafts)
      .set({
        status: "failed",
        leaseExpiresAt: null,
        errorMessage:
          "Reference stage lease expired; inspect execution logs before retrying",
        updatedAt: new Date(),
        conceptJson: sql`jsonb_set(jsonb_set(${postDrafts.conceptJson}, '{pipeline,state}', '"failed"'::jsonb), '{pipeline,blockers}', '["reference_lease_expired"]'::jsonb)`,
      })
      .where(
        and(
          eq(postDrafts.status, "generating"),
          lt(postDrafts.leaseExpiresAt, new Date()),
          sql`${postDrafts.conceptJson}->>'postGenerationAgent' = 'reference-v1'`,
        ),
      )
      .returning({ id: postDrafts.id });
    return rows.length;
  }

  async restoreReferenceGeneration(
    draftId: string,
    expectedConceptJson: unknown,
  ): Promise<boolean> {
    const rows = await this.database.client
      .update(postDrafts)
      .set({
        status: "generating",
        errorMessage: null,
        updatedAt: new Date(),
        conceptJson: sql`jsonb_set(jsonb_set(${postDrafts.conceptJson}, '{pipeline,state}', '"running"'::jsonb), '{pipeline,blockers}', '[]'::jsonb)`,
      })
      .where(
        and(
          eq(postDrafts.id, draftId),
          eq(postDrafts.status, "failed"),
          isNull(postDrafts.leaseExpiresAt),
          sql`${postDrafts.conceptJson}->>'postGenerationAgent' = 'reference-v1'`,
          sql`${postDrafts.conceptJson}#>>'{pipeline,stage}' = 'generation'`,
          sql`jsonb_array_length(coalesce(${postDrafts.conceptJson}->'generationBuild'->'jobIds', '[]'::jsonb)) > 0`,
          sql`${postDrafts.conceptJson}#>>'{generationBuild,promptRevision}' = ${postDrafts.conceptJson}#>>'{promptBuild,revision}'`,
          sql`${postDrafts.conceptJson} = ${JSON.stringify(expectedConceptJson)}::jsonb`,
          sql`not exists (select 1 from ${generationJobs} j where j.draft_id = ${postDrafts.id}
        and coalesce(${postDrafts.conceptJson}->'generationBuild'->'jobIds', '[]'::jsonb) ? j.id::text and j.status = 'failed')`,
        ),
      )
      .returning({ id: postDrafts.id });
    return rows.length > 0;
  }

  async listReferenceGenerationWaiting(limit: number, draftId?: string) {
    return this.database.client
      .select({ id: postDrafts.id })
      .from(postDrafts)
      .where(
        and(
          inArray(postDrafts.status, ["generating", "regenerating", "failed"]),
          isNull(postDrafts.leaseExpiresAt),
          sql`${postDrafts.conceptJson}->>'postGenerationAgent' = 'reference-v1'`,
          sql`${postDrafts.conceptJson}#>>'{pipeline,stage}' = 'generation'`,
          sql`${postDrafts.conceptJson}#>>'{pipeline,state}' in ('running', 'failed')`,
          sql`jsonb_array_length(coalesce(${postDrafts.conceptJson}->'generationBuild'->'jobIds', '[]'::jsonb)) > 0`,
          sql`(${postDrafts.status} <> 'failed' or not exists (select 1 from ${generationJobs} j
            where j.draft_id = ${postDrafts.id} and j.status = 'failed'
            and coalesce(${postDrafts.conceptJson}->'generationBuild'->'jobIds', '[]'::jsonb) ? j.id::text))`,
          draftId ? eq(postDrafts.id, draftId) : undefined,
        ),
      )
      .orderBy(postDrafts.updatedAt, postDrafts.id)
      .limit(limit);
  }

  async failReferenceStage(draftId: string, message: string): Promise<void> {
    await this.database.client
      .update(postDrafts)
      .set({
        status: "failed",
        leaseExpiresAt: null,
        errorMessage: message.slice(0, 500),
        updatedAt: new Date(),
        conceptJson: sql`jsonb_set(${postDrafts.conceptJson}, '{pipeline,state}', '"failed"'::jsonb)`,
      })
      .where(
        and(
          eq(postDrafts.id, draftId),
          eq(postDrafts.status, "generating"),
          sql`${postDrafts.conceptJson}->>'postGenerationAgent' = 'reference-v1'`,
        ),
      );
  }

  async findDraftJobs(draftId: string): Promise<DraftJobRow[]> {
    const jobs = await this.database.client
      .select({
        id: generationJobs.id,
        sortOrder: generationJobs.sortOrder,
        status: generationJobs.status,
        prompt: generationJobs.prompt,
        paramsJson: generationJobs.paramsJson,
        candidateCount: generationJobs.candidateCount,
        provider: generationJobs.provider,
        costUsd: generationJobs.costUsd,
        errorMessage: generationJobs.errorMessage,
        attemptCount: generationJobs.attemptCount,
        createdAt: generationJobs.createdAt,
        updatedAt: generationJobs.updatedAt,
      })
      .from(generationJobs)
      .where(eq(generationJobs.draftId, draftId))
      .orderBy(desc(generationJobs.createdAt), desc(generationJobs.id));
    return Promise.all(
      jobs.map(async (job) => ({
        ...job,
        outputs: await this.database.client
          .select({
            mediaId: generationJobOutputs.mediaId,
            candidateIndex: generationJobOutputs.candidateIndex,
            selected: generationJobOutputs.selected,
            filterPreset: generationJobOutputs.filterPreset,
            media: { url: media.url },
          })
          .from(generationJobOutputs)
          .innerJoin(media, eq(media.id, generationJobOutputs.mediaId))
          .where(eq(generationJobOutputs.jobId, job.id))
          .orderBy(generationJobOutputs.candidateIndex),
      })),
    );
  }

  findMediaUrls(ids: string[]): Promise<{ id: string; url: string }[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.database.client
      .select({ id: media.id, url: media.url })
      .from(media)
      .where(inArray(media.id, ids));
  }

  async characterExists(characterId: string): Promise<boolean> {
    return (
      (
        await this.database.client
          .select({ id: characters.id })
          .from(characters)
          .where(eq(characters.id, characterId))
          .limit(1)
      ).length > 0
    );
  }

  async createDraft(data: {
    characterId: string;
    contentType: "feed" | "reel";
    conceptJson: unknown;
    scheduledAt?: Date;
  }): Promise<DraftRow> {
    return (
      await this.database.client.insert(postDrafts).values(data).returning()
    )[0];
  }

  async findPlanEditDraft(draftId: string): Promise<PlanEditDraft | null> {
    const [draft] = await this.database.client
      .select({
        id: postDrafts.id,
        characterId: postDrafts.characterId,
        status: postDrafts.status,
        leaseExpiresAt: postDrafts.leaseExpiresAt,
        conceptJson: postDrafts.conceptJson,
      })
      .from(postDrafts)
      .where(eq(postDrafts.id, draftId))
      .limit(1);
    if (!draft) return null;
    const jobs = await this.database.client
      .select({
        id: generationJobs.id,
        sortOrder: generationJobs.sortOrder,
        paramsJson: generationJobs.paramsJson,
      })
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.draftId, draftId),
          eq(generationJobs.status, "draft"),
        ),
      )
      .orderBy(desc(generationJobs.createdAt), desc(generationJobs.id));
    return { ...draft, jobs };
  }

  updatePlan(input: {
    draftId: string;
    caption: string;
    hashtags: string[];
    conceptJson: unknown;
    shots: { jobId: string; paramsJson: unknown }[];
  }): Promise<boolean> {
    return this.database.client.transaction(async (tx) => {
      const draft = await tx
        .update(postDrafts)
        .set({
          caption: input.caption,
          hashtags: input.hashtags,
          conceptJson: input.conceptJson,
        })
        .where(
          and(
            eq(postDrafts.id, input.draftId),
            eq(postDrafts.status, "generating"),
            isNull(postDrafts.leaseExpiresAt),
          ),
        )
        .returning({ id: postDrafts.id });
      if (draft.length === 0) return false;
      for (const shot of input.shots) {
        const updated = await tx
          .update(generationJobs)
          .set({ paramsJson: shot.paramsJson })
          .where(
            and(
              eq(generationJobs.id, shot.jobId),
              eq(generationJobs.draftId, input.draftId),
              eq(generationJobs.status, "draft"),
            ),
          )
          .returning({ id: generationJobs.id });
        if (updated.length === 0)
          throw new Error("draft shot left editable state");
      }
      return true;
    });
  }

  updatePrompts(input: {
    draftId: string;
    items: { jobId: string; prompt: string }[];
  }): Promise<boolean> {
    return this.database.client.transaction(async (tx) => {
      for (const item of input.items) {
        const updated = await tx
          .update(generationJobs)
          .set({ prompt: item.prompt })
          .where(
            and(
              eq(generationJobs.id, item.jobId),
              eq(generationJobs.draftId, input.draftId),
              eq(generationJobs.status, "draft"),
            ),
          )
          .returning({ id: generationJobs.id });
        if (updated.length === 0) return false;
      }
      const touched = await tx
        .update(postDrafts)
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(postDrafts.id, input.draftId),
            eq(postDrafts.status, "generating"),
          ),
        )
        .returning({ id: postDrafts.id });
      return touched.length > 0;
    });
  }

  async setAutomation(draftId: string, enabled: boolean): Promise<boolean> {
    const rows = await this.database.client
      .update(postDrafts)
      .set({
        conceptJson: sql`jsonb_set(coalesce(${postDrafts.conceptJson}, '{}'::jsonb), '{mode}', ${JSON.stringify(enabled ? "auto" : "manual")}::jsonb)`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(postDrafts.id, draftId),
          eq(postDrafts.draftType, "post"),
          inArray(postDrafts.status, [
            "planned",
            "generating",
            "regenerating",
            "needs_review",
            "approved",
            "failed",
          ]),
          ...(enabled
            ? [
                sql`${postDrafts.status} <> 'failed'`,
                or(
                  isNull(sql`${postDrafts.conceptJson}#>>'{pipeline,state}'`),
                  inArray(
                    sql<string>`${postDrafts.conceptJson}#>>'{pipeline,state}'`,
                    ["pending", "ready"],
                  ),
                ),
              ]
            : []),
          isNull(postDrafts.leaseExpiresAt),
          sql`${postDrafts.conceptJson}#>>'{pipeline,state}' is distinct from 'running'`,
        ),
      )
      .returning({ id: postDrafts.id });
    return rows.length > 0;
  }

  async markManual(draftId: string): Promise<void> {
    const [draft] = await this.database.client
      .select({
        status: postDrafts.status,
        conceptJson: postDrafts.conceptJson,
      })
      .from(postDrafts)
      .where(eq(postDrafts.id, draftId))
      .limit(1);
    if (!draft || draft.status === "published" || draft.status === "rejected")
      return;
    const concept =
      draft.conceptJson &&
      typeof draft.conceptJson === "object" &&
      !Array.isArray(draft.conceptJson)
        ? { ...(draft.conceptJson as Record<string, unknown>) }
        : {};
    if (concept.mode === "manual") return;
    await this.database.client
      .update(postDrafts)
      .set({ conceptJson: { ...concept, mode: "manual" } })
      .where(
        and(
          eq(postDrafts.id, draftId),
          sql`${postDrafts.status} not in ('published', 'rejected')`,
          sql`(${postDrafts.conceptJson}->>'postGenerationAgent' is distinct from 'reference-v1' or ${postDrafts.leaseExpiresAt} is null)`,
          ...(concept.postGenerationAgent === "reference-v1"
            ? [
                sql`${postDrafts.conceptJson} = ${JSON.stringify(draft.conceptJson)}::jsonb`,
              ]
            : []),
        ),
      );
  }

  findDraftConcept(draftId: string): Promise<{ conceptJson: unknown } | null> {
    return this.database.client
      .select({ conceptJson: postDrafts.conceptJson })
      .from(postDrafts)
      .where(eq(postDrafts.id, draftId))
      .limit(1)
      .then(([row]) => row ?? null);
  }

  async updateEditableDraft(
    draftId: string,
    statuses: PostDraftStatus[],
    data: Record<string, unknown>,
    v4Stages: ("caption" | "publish")[] = [],
  ): Promise<boolean> {
    const rows = await this.database.client
      .update(postDrafts)
      .set(data as Partial<typeof postDrafts.$inferInsert>)
      .where(
        and(
          eq(postDrafts.id, draftId),
          or(
            sql`${postDrafts.conceptJson}->>'postGenerationAgent' is distinct from 'reference-v1'`,
            isNull(postDrafts.leaseExpiresAt),
          ),
          or(
            statuses.length ? inArray(postDrafts.status, statuses) : undefined,
            v4Stages.length ? v4PausedAt(v4Stages) : undefined,
          ),
        ),
      )
      .returning({ id: postDrafts.id });
    return rows.length > 0;
  }

  approveDraft(draftId: string): Promise<boolean> {
    return this.transitionDraft(draftId, "needs_review", {
      status: "approved",
      errorMessage: null,
    });
  }
  rejectDraft(draftId: string): Promise<boolean> {
    return this.transitionDraft(draftId, "needs_review", {
      status: "rejected",
    });
  }
  async draftExists(draftId: string): Promise<boolean> {
    return (
      (
        await this.database.client
          .select({ id: postDrafts.id })
          .from(postDrafts)
          .where(eq(postDrafts.id, draftId))
          .limit(1)
      ).length > 0
    );
  }

  findDraftShotPrompt(
    draftId: string,
    jobId: string,
  ): Promise<{ prompt: string } | null> {
    return this.database.client
      .select({ prompt: generationJobs.prompt })
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.id, jobId),
          eq(generationJobs.draftId, draftId),
          eq(generationJobs.status, "draft"),
        ),
      )
      .limit(1)
      .then(([row]) => row ?? null);
  }

  async queueDraftShot(input: {
    draftId: string;
    jobId: string;
    prompt?: string;
    candidateCount?: number;
  }): Promise<boolean> {
    const rows = await this.database.client
      .update(generationJobs)
      .set({
        status: "queued",
        ...(input.prompt ? { prompt: input.prompt } : {}),
        ...(input.candidateCount != null
          ? { candidateCount: input.candidateCount }
          : {}),
      })
      .where(
        and(
          eq(generationJobs.id, input.jobId),
          eq(generationJobs.draftId, input.draftId),
          eq(generationJobs.status, "draft"),
        ),
      )
      .returning({ id: generationJobs.id });
    return rows.length > 0;
  }

  findShotIdentity(
    jobId: string,
  ): Promise<{ characterId: string; sortOrder: number } | null> {
    return this.database.client
      .select({
        characterId: generationJobs.characterId,
        sortOrder: generationJobs.sortOrder,
      })
      .from(generationJobs)
      .where(eq(generationJobs.id, jobId))
      .limit(1)
      .then(([row]) => row ?? null);
  }
  async shotBelongsToDraft(draftId: string, jobId: string): Promise<boolean> {
    return (
      (
        await this.database.client
          .select({ id: generationJobs.id })
          .from(generationJobs)
          .where(
            and(
              eq(generationJobs.id, jobId),
              eq(generationJobs.draftId, draftId),
            ),
          )
          .limit(1)
      ).length > 0
    );
  }
  findRegenerationSource(
    draftId: string,
    jobId: string,
  ): Promise<RegenerationSource | null> {
    return this.database.client
      .select({
        id: generationJobs.id,
        characterId: generationJobs.characterId,
        sortOrder: generationJobs.sortOrder,
        status: generationJobs.status,
        inputPrompt: generationJobs.inputPrompt,
        prompt: generationJobs.prompt,
        candidateCount: generationJobs.candidateCount,
        paramsJson: generationJobs.paramsJson,
      })
      .from(generationJobs)
      .where(
        and(eq(generationJobs.id, jobId), eq(generationJobs.draftId, draftId)),
      )
      .limit(1)
      .then(([row]) => row ?? null);
  }

  regenerateShot(input: {
    draftId: string;
    source: RegenerationSource;
    prompt: string;
  }): Promise<RegenerationResult> {
    return this.database.client.transaction(async (tx) => {
      const [latest] = await tx
        .select({ id: generationJobs.id })
        .from(generationJobs)
        .where(
          and(
            eq(generationJobs.draftId, input.draftId),
            eq(generationJobs.sortOrder, input.source.sortOrder),
          ),
        )
        .orderBy(desc(generationJobs.createdAt), desc(generationJobs.id))
        .limit(1);
      if (latest?.id !== input.source.id) return { outcome: "stale-job" };
      const transitioned = await tx
        .update(postDrafts)
        .set({ status: "regenerating", errorMessage: null })
        .where(
          and(
            eq(postDrafts.id, input.draftId),
            or(
              sql`${postDrafts.conceptJson}->>'postGenerationAgent' is distinct from 'natural-v1'`,
              and(
                isNull(postDrafts.leaseExpiresAt),
                sql`${postDrafts.conceptJson}#>>'{pipeline,state}' is distinct from 'running'`,
              ),
            ),
            or(
              inArray(postDrafts.status, [
                "needs_review",
                "failed",
                "generating",
                "regenerating",
              ]),
              v4PausedAt(["caption", "publish"]),
            ),
          ),
        )
        .returning({ id: postDrafts.id });
      if (transitioned.length === 0) {
        const exists =
          (
            await tx
              .select({ id: postDrafts.id })
              .from(postDrafts)
              .where(eq(postDrafts.id, input.draftId))
              .limit(1)
          ).length > 0;
        return exists
          ? { outcome: "invalid-draft-status" }
          : { outcome: "draft-not-found" };
      }
      const [created] = await tx
        .insert(generationJobs)
        .values({
          characterId: input.source.characterId,
          mediaType: "image",
          inputPrompt: input.source.inputPrompt,
          prompt: input.prompt,
          candidateCount: input.source.candidateCount,
          paramsJson: input.source.paramsJson,
          draftId: input.draftId,
          sortOrder: input.source.sortOrder,
          originJobId: input.source.id,
        })
        .returning({ id: generationJobs.id });
      await tx.insert(characterActionLogs).values({
        characterId: input.source.characterId,
        actionType: "DRAFT_SHOT_REGENERATED",
        targetTable: "post_drafts",
        targetId: input.draftId,
        reason: `shot ${input.source.sortOrder} regeneration queued`,
      });
      return { outcome: "regenerated", jobId: created.id };
    });
  }

  async findCompletedShotCandidates(
    draftId: string,
    jobId: string,
  ): Promise<{ id: string; outputs: { mediaId: string }[] } | null> {
    const [job] = await this.database.client
      .select({ id: generationJobs.id })
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.id, jobId),
          eq(generationJobs.draftId, draftId),
          eq(generationJobs.status, "completed"),
        ),
      )
      .limit(1);
    if (!job) return null;
    return {
      id: job.id,
      outputs: await this.database.client
        .select({ mediaId: generationJobOutputs.mediaId })
        .from(generationJobOutputs)
        .where(eq(generationJobOutputs.jobId, jobId)),
    };
  }

  async selectShotOutput(jobId: string, mediaId: string): Promise<void> {
    await this.database.client.transaction(async (tx) => {
      const [owner] = await tx
        .select({ draftId: generationJobs.draftId })
        .from(generationJobs)
        .where(eq(generationJobs.id, jobId));
      if (owner?.draftId) {
        const locked = await tx
          .update(postDrafts)
          .set({ updatedAt: new Date() })
          .where(
            and(
              eq(postDrafts.id, owner.draftId),
              or(
                sql`${postDrafts.conceptJson}->>'postGenerationAgent' is distinct from 'reference-v1'`,
                and(
                  isNull(postDrafts.leaseExpiresAt),
                  inArray(postDrafts.status, [
                    "generating",
                    "needs_review",
                    "approved",
                    "failed",
                  ]),
                ),
              ),
            ),
          )
          .returning({ id: postDrafts.id });
        if (!locked.length)
          throw new Error("Draft output is locked for publication");
      }
      await tx
        .update(generationJobOutputs)
        .set({ selected: false })
        .where(eq(generationJobOutputs.jobId, jobId));
      await tx
        .update(generationJobOutputs)
        .set({ selected: true })
        .where(
          and(
            eq(generationJobOutputs.jobId, jobId),
            eq(generationJobOutputs.mediaId, mediaId),
          ),
        );
      await tx
        .update(generationJobs)
        .set({ outputMediaId: mediaId })
        .where(eq(generationJobs.id, jobId));
    });
  }

  findEditableOutput(input: {
    draftId: string;
    jobId: string;
    mediaId: string;
    draftStatuses: PostDraftStatus[];
  }): Promise<{ id: string } | null> {
    return this.database.client
      .select({ id: generationJobOutputs.id })
      .from(generationJobOutputs)
      .innerJoin(
        generationJobs,
        eq(generationJobs.id, generationJobOutputs.jobId),
      )
      .innerJoin(postDrafts, eq(postDrafts.id, generationJobs.draftId))
      .where(
        and(
          eq(generationJobOutputs.jobId, input.jobId),
          eq(generationJobOutputs.mediaId, input.mediaId),
          eq(generationJobs.draftId, input.draftId),
          eq(generationJobs.status, "completed"),
          inArray(postDrafts.status, input.draftStatuses),
        ),
      )
      .limit(1)
      .then(([row]) => row ?? null);
  }
  async updateOutputFilter(
    outputId: string,
    filterPreset: string,
  ): Promise<void> {
    await this.database.client.transaction(async (tx) => {
      const [owner] = await tx
        .select({ draftId: generationJobs.draftId })
        .from(generationJobs)
        .innerJoin(
          generationJobOutputs,
          eq(generationJobOutputs.jobId, generationJobs.id),
        )
        .where(eq(generationJobOutputs.id, outputId));
      if (owner?.draftId) {
        const locked = await tx
          .update(postDrafts)
          .set({ updatedAt: new Date() })
          .where(
            and(
              eq(postDrafts.id, owner.draftId),
              or(
                sql`${postDrafts.conceptJson}->>'postGenerationAgent' is distinct from 'reference-v1'`,
                and(
                  isNull(postDrafts.leaseExpiresAt),
                  inArray(postDrafts.status, [
                    "generating",
                    "needs_review",
                    "approved",
                    "failed",
                  ]),
                ),
              ),
            ),
          )
          .returning({ id: postDrafts.id });
        if (!locked.length)
          throw new Error("Draft output is locked for publication");
      }
      await tx
        .update(generationJobOutputs)
        .set({ filterPreset })
        .where(eq(generationJobOutputs.id, outputId));
    });
  }
  async recordActionLog(input: {
    characterId: string;
    draftId: string;
    actionType: string;
    reason: string;
  }): Promise<void> {
    await this.database.client.insert(characterActionLogs).values({
      characterId: input.characterId,
      actionType: input.actionType,
      targetTable: "post_drafts",
      targetId: input.draftId,
      reason: input.reason,
    });
  }

  private draftFilter(input: {
    status?: PostDraftStatus;
    characterId?: string;
  }) {
    return and(
      input.status ? eq(postDrafts.status, input.status) : undefined,
      input.characterId
        ? eq(postDrafts.characterId, input.characterId)
        : undefined,
    );
  }
  private async transitionDraft(
    draftId: string,
    from: PostDraftStatus,
    set: Partial<typeof postDrafts.$inferInsert>,
  ): Promise<boolean> {
    return (
      (
        await this.database.client
          .update(postDrafts)
          .set(set)
          .where(and(eq(postDrafts.id, draftId), eq(postDrafts.status, from)))
          .returning({ id: postDrafts.id })
      ).length > 0
    );
  }
}
