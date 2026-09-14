import { Injectable } from "@nestjs/common";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { DatabaseService } from "../domain/database/database.service";
import {
  characterActionLogs,
  characterLocationReferences,
  characterLocations,
  characterMemories,
  characterPersonas,
  characterPostingPolicies,
  characterVisualProfileReferences,
  characterVisualProfiles,
  characters,
  generationJobOutputs,
  generationJobs,
  hashtags,
  media,
  postDrafts,
  postHashtags,
  postMedia,
  posts,
  serviceLogs,
} from "../domain/database/schema";
import {
  createPostPipelineV3Concept,
  POST_PIPELINE_V3,
  POST_PIPELINE_V4,
  PostPipelineV3ArtifactKey,
} from "./post-pipeline-v3";

type DraftStatus = (typeof postDrafts.$inferSelect)["status"];
export type AggregateDraft = Pick<
  typeof postDrafts.$inferSelect,
  "id" | "characterId" | "status" | "conceptJson"
> & {
  jobs: Array<Pick<typeof generationJobs.$inferSelect, "sortOrder" | "status">>;
};
type PlannedPost = Pick<typeof posts.$inferSelect, "content"> & {
  hashtags: Array<{ hashtag: { name: string } }>;
  sourceDrafts: Array<{ conceptJson: unknown }>;
};
type PlannedCharacter = Pick<
  typeof characters.$inferSelect,
  "displayName" | "bio" | "contentLanguage"
> & {
  interests: string[];
  personas: Array<
    Pick<typeof characterPersonas.$inferSelect, "title" | "content">
  >;
  memories: Array<
    Pick<typeof characterMemories.$inferSelect, "type" | "content">
  >;
  posts: PlannedPost[];
  visualProfile:
    | (Pick<
        typeof characterVisualProfiles.$inferSelect,
        "appearancePrompt" | "stylePrompt" | "negativePrompt"
      > & {
        referenceMedia: Array<
          Pick<
            typeof characterVisualProfileReferences.$inferSelect,
            "mediaId" | "description"
          > & { media: { uploadedAt: Date | null } }
        >;
      })
    | null;
};
export type PlannedDraft = typeof postDrafts.$inferSelect & {
  character: PlannedCharacter;
};
export type PublishDraft = Pick<
  typeof postDrafts.$inferSelect,
  | "id"
  | "characterId"
  | "contentType"
  | "caption"
  | "conceptJson"
  | "leaseExpiresAt"
> & { hashtags: string[] };
export type PromptBuildDraft = {
  id: string;
  characterId: string;
  conceptJson: unknown;
  location: {
    id: string;
    visualPrompt: string;
    negativePrompt: string;
    references: Array<{ mediaId: string; media: { uploadedAt: Date | null } }>;
  } | null;
  character: {
    visualProfile: {
      appearancePrompt: string;
      stylePrompt: string;
      referenceMedia: Array<{
        mediaId: string;
        media: { uploadedAt: Date | null };
      }>;
    } | null;
  };
};
export type AvailableLocation = {
  id: string;
  displayName: string;
  description: string;
  visualPrompt: string;
  negativePrompt: string;
  references: Array<{
    mediaId: string;
    description: string;
    media: { uploadedAt: Date | null };
  }>;
};
export type RecentVisualPlanDraft = {
  id: string;
  createdAt: Date;
  publishedPostId: string | null;
  conceptJson: unknown;
};
export type DraftImageJob = {
  id: string;
  sortOrder: number;
  status: string;
  paramsJson: unknown;
};
export type CaptionShot = {
  sortOrder: number;
  jobId: string;
  mediaId: string;
  media: { url: string; storageKey: string | null; contentType: string | null };
};
export type PublishJob = {
  sortOrder: number;
  status: string;
  outputMediaId: string | null;
  outputs: { mediaId: string; filterPreset: string | null }[];
};
export type PostingPolicy = {
  characterId: string;
  weeklyCadence: number;
  hourStartKst: number;
  hourEndKst: number;
};
export type FinishedPublishFile = {
  url: string;
  storageKey?: string;
  contentType: string;
  byteSize: number;
  width: number;
  height: number;
};

const notV3FamilyCondition = or(
  isNull(sql`${postDrafts.conceptJson}->>'pipelineVersion'`),
  notInArray(sql<string>`${postDrafts.conceptJson}->>'pipelineVersion'`, [
    POST_PIPELINE_V3,
    POST_PIPELINE_V4,
  ]),
);
const publishableCondition = or(
  eq(postDrafts.status, "approved"),
  and(
    eq(postDrafts.status, "planned"),
    eq(sql<string>`${postDrafts.conceptJson}#>>'{pipeline,stage}'`, "publish"),
    eq(sql<string>`${postDrafts.conceptJson}#>>'{pipeline,state}'`, "pending"),
  ),
);

@Injectable()
export class DraftWorkerRepository {
  constructor(private readonly database: DatabaseService) {}

  async claimDraftNow(draftId: string, leaseSeconds: number): Promise<boolean> {
    const rows = await this.database.client
      .update(postDrafts)
      .set({
        status: "generating",
        leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1000),
        attemptCount: sql`${postDrafts.attemptCount} + 1`,
      })
      .where(
        and(
          eq(postDrafts.id, draftId),
          eq(postDrafts.status, "planned"),
          eq(postDrafts.draftType, "post"),
          sql`exists (select 1 from ${characters} where ${characters.id} = ${postDrafts.characterId} and ${characters.status} = 'active')`,
          notV3FamilyCondition,
        ),
      )
      .returning({ id: postDrafts.id });
    return rows.length > 0;
  }

  async findApprovedDraft(
    draftId: string,
    leaseSeconds = 120,
  ): Promise<PublishDraft | null> {
    const result = await this.database.client.execute<PublishDraft>(sql`
      update opod.post_drafts d
      set lease_expires_at = now() + make_interval(secs => ${leaseSeconds})
      where d.id = ${draftId}::uuid and d.draft_type = 'post'
        and (d.status = 'approved' or (d.status = 'planned' and d.concept_json#>>'{pipeline,stage}' = 'publish' and d.concept_json#>>'{pipeline,state}' = 'pending'))
        and (d.lease_expires_at is null or d.lease_expires_at < now())
        and exists (select 1 from opod.characters c where c.id = d.character_id and c.status = 'active')
      returning d.id, d.character_id as "characterId", d.content_type as "contentType", d.caption,
                coalesce(d.hashtags, ARRAY[]::text[]) as hashtags, d.concept_json as "conceptJson", d.lease_expires_at as "leaseExpiresAt"
    `);
    return result.rows[0] ?? null;
  }

  async recordPublishError(
    draftId: string,
    message: string,
    leaseExpiresAt?: Date | null,
  ): Promise<void> {
    await this.database.client
      .update(postDrafts)
      .set({ errorMessage: message, leaseExpiresAt: null })
      .where(
        and(
          eq(postDrafts.id, draftId),
          publishableCondition,
          leaseExpiresAt
            ? eq(postDrafts.leaseExpiresAt, leaseExpiresAt)
            : undefined,
        ),
      );
  }

  async findAggregateDraft(draftId: string): Promise<AggregateDraft | null> {
    const [draft] = await this.database.client
      .select({
        id: postDrafts.id,
        characterId: postDrafts.characterId,
        status: postDrafts.status,
        conceptJson: postDrafts.conceptJson,
      })
      .from(postDrafts)
      .where(
        and(
          eq(postDrafts.id, draftId),
          inArray(postDrafts.status, ["generating", "regenerating"]),
          isNull(postDrafts.leaseExpiresAt),
        ),
      )
      .limit(1);
    return draft
      ? { ...draft, jobs: await this.aggregateJobs(draft.id) }
      : null;
  }

  async findPromptBuildDraft(
    draftId: string,
  ): Promise<PromptBuildDraft | null> {
    const [draft] = await this.database.client
      .select({
        id: postDrafts.id,
        characterId: postDrafts.characterId,
        conceptJson: postDrafts.conceptJson,
        locationId: postDrafts.locationId,
      })
      .from(postDrafts)
      .where(and(eq(postDrafts.id, draftId), eq(postDrafts.draftType, "post")))
      .limit(1);
    if (!draft) return null;
    const [profile, location] = await Promise.all([
      this.database.client
        .select({
          id: characterVisualProfiles.id,
          appearancePrompt: characterVisualProfiles.appearancePrompt,
          stylePrompt: characterVisualProfiles.stylePrompt,
        })
        .from(characterVisualProfiles)
        .where(eq(characterVisualProfiles.characterId, draft.characterId))
        .limit(1)
        .then(([row]) => row ?? null),
      draft.locationId
        ? this.database.client
            .select({
              id: characterLocations.id,
              visualPrompt: characterLocations.visualPrompt,
              negativePrompt: characterLocations.negativePrompt,
            })
            .from(characterLocations)
            .where(eq(characterLocations.id, draft.locationId))
            .limit(1)
            .then(([row]) => row ?? null)
        : null,
    ]);
    const [profileReferences, locationReferences] = await Promise.all([
      profile
        ? this.database.client
            .select({
              mediaId: characterVisualProfileReferences.mediaId,
              media: { uploadedAt: media.uploadedAt },
            })
            .from(characterVisualProfileReferences)
            .innerJoin(
              media,
              eq(media.id, characterVisualProfileReferences.mediaId),
            )
            .where(
              and(
                eq(characterVisualProfileReferences.profileId, profile.id),
                eq(characterVisualProfileReferences.isActive, true),
              ),
            )
            .orderBy(asc(characterVisualProfileReferences.sortOrder))
        : [],
      location
        ? this.database.client
            .select({
              mediaId: characterLocationReferences.mediaId,
              media: { uploadedAt: media.uploadedAt },
            })
            .from(characterLocationReferences)
            .innerJoin(media, eq(media.id, characterLocationReferences.mediaId))
            .where(eq(characterLocationReferences.locationId, location.id))
            .orderBy(asc(characterLocationReferences.sortOrder))
        : [],
    ]);
    return {
      id: draft.id,
      characterId: draft.characterId,
      conceptJson: draft.conceptJson,
      location: location
        ? { ...location, references: locationReferences }
        : null,
      character: {
        visualProfile: profile
          ? { ...profile, referenceMedia: profileReferences }
          : null,
      },
    };
  }

  async findAvailableLocations(
    characterId: string,
  ): Promise<AvailableLocation[]> {
    const rows = await this.database.client
      .select({
        id: characterLocations.id,
        displayName: characterLocations.displayName,
        description: characterLocations.description,
        visualPrompt: characterLocations.visualPrompt,
        negativePrompt: characterLocations.negativePrompt,
      })
      .from(characterLocations)
      .where(
        and(
          isNull(characterLocations.deletedAt),
          or(
            isNull(characterLocations.characterId),
            eq(characterLocations.characterId, characterId),
          ),
        ),
      )
      .orderBy(
        desc(characterLocations.characterId),
        asc(characterLocations.createdAt),
      );
    return Promise.all(
      rows.map(async (location) => ({
        ...location,
        references: await this.database.client
          .select({
            mediaId: characterLocationReferences.mediaId,
            description: characterLocationReferences.description,
            media: { uploadedAt: media.uploadedAt },
          })
          .from(characterLocationReferences)
          .innerJoin(media, eq(media.id, characterLocationReferences.mediaId))
          .where(eq(characterLocationReferences.locationId, location.id))
          .orderBy(asc(characterLocationReferences.sortOrder)),
      })),
    );
  }

  findRecentVisualPlanDrafts(
    characterId: string,
    excludeDraftId: string,
    take: number,
  ): Promise<RecentVisualPlanDraft[]> {
    return this.database.client
      .select({
        id: postDrafts.id,
        createdAt: postDrafts.createdAt,
        publishedPostId: postDrafts.publishedPostId,
        conceptJson: postDrafts.conceptJson,
      })
      .from(postDrafts)
      .where(
        and(
          eq(postDrafts.characterId, characterId),
          ne(postDrafts.id, excludeDraftId),
          eq(postDrafts.draftType, "post"),
          notInArray(postDrafts.status, ["failed", "rejected"]),
        ),
      )
      .orderBy(desc(postDrafts.createdAt), desc(postDrafts.id))
      .limit(take);
  }

  findDraftImageJobs(draftId: string): Promise<DraftImageJob[]> {
    return this.database.client
      .select({
        id: generationJobs.id,
        sortOrder: generationJobs.sortOrder,
        status: generationJobs.status,
        paramsJson: generationJobs.paramsJson,
      })
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.draftId, draftId),
          eq(generationJobs.mediaType, "image"),
        ),
      )
      .orderBy(desc(generationJobs.createdAt), desc(generationJobs.id));
  }

  async persistBuiltPrompts(input: {
    draftId: string;
    characterId: string;
    builderName: string;
    conceptJson: unknown;
    jobs: {
      id: string;
      sortOrder: number;
      prompt: string;
      paramsJson: unknown;
    }[];
  }): Promise<void> {
    await this.database.client.transaction(async (tx) => {
      for (const job of input.jobs) {
        const updated = await tx
          .update(generationJobs)
          .set({ prompt: job.prompt, paramsJson: job.paramsJson })
          .where(
            and(
              eq(generationJobs.id, job.id),
              eq(generationJobs.status, "draft"),
            ),
          )
          .returning({ id: generationJobs.id });
        if (updated.length !== 1)
          throw new Error(
            `shot ${job.sortOrder} left draft state during prompt build`,
          );
      }
      await tx
        .update(postDrafts)
        .set({ conceptJson: input.conceptJson })
        .where(eq(postDrafts.id, input.draftId));
      await tx.insert(characterActionLogs).values({
        characterId: input.characterId,
        actionType: "DRAFT_PROMPTS_BUILT",
        targetTable: "post_drafts",
        targetId: input.draftId,
        reason: `shot prompts built via ${input.builderName} (${input.jobs.length} shot(s))`,
      });
    });
  }

  persistV3Artifact(input: {
    draftId: string;
    characterId: string;
    expected: {
      stage: string;
      state: string;
      artifactKey: PostPipelineV3ArtifactKey;
      revision: number | null;
    };
    conceptJson: unknown;
    columns?: { caption: string; hashtags: string[] };
    actionType: string;
    reason: string;
  }): Promise<boolean> {
    return this.database.client.transaction(async (tx) => {
      const updated = await tx
        .update(postDrafts)
        .set({
          conceptJson: input.conceptJson,
          ...(input.columns ?? {}),
          status: "planned",
          leaseExpiresAt: null,
          attemptCount: 0,
          errorMessage: null,
        })
        .where(
          and(
            eq(postDrafts.id, input.draftId),
            eq(postDrafts.status, "generating"),
            eq(
              sql<string>`${postDrafts.conceptJson}#>>'{pipeline,stage}'`,
              input.expected.stage,
            ),
            eq(
              sql<string>`${postDrafts.conceptJson}#>>'{pipeline,state}'`,
              input.expected.state,
            ),
            input.expected.revision === null
              ? undefined
              : eq(
                  sql<string>`${postDrafts.conceptJson}->${input.expected.artifactKey}->>'revision'`,
                  String(input.expected.revision),
                ),
          ),
        )
        .returning({ id: postDrafts.id });
      if (updated.length !== 1) return false;
      await tx.insert(characterActionLogs).values({
        characterId: input.characterId,
        actionType: input.actionType,
        targetTable: "post_drafts",
        targetId: input.draftId,
        reason: input.reason,
      });
      return true;
    });
  }

  async sweepExpiredPlanLeases(
    now: Date,
    maxAttempts: number,
  ): Promise<number> {
    const requeued = await this.database.client
      .update(postDrafts)
      .set({ status: "planned", leaseExpiresAt: null })
      .where(
        and(
          eq(postDrafts.status, "generating"),
          lt(postDrafts.leaseExpiresAt, now),
          lt(postDrafts.attemptCount, maxAttempts),
          notV3FamilyCondition,
        ),
      )
      .returning({ id: postDrafts.id });
    await this.database.client
      .update(postDrafts)
      .set({
        status: "failed",
        errorMessage: "planning lease expired",
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(postDrafts.status, "generating"),
          lt(postDrafts.leaseExpiresAt, now),
          gte(postDrafts.attemptCount, maxAttempts),
          notV3FamilyCondition,
        ),
      );
    return requeued.length;
  }

  async sweepExpiredV3Leases(
    maxAttempts: number,
  ): Promise<{ requeued: number; failed: number }> {
    const requeued = await this.database.client.execute<{ id: string }>(sql`
      update opod.post_drafts set status = 'planned', lease_expires_at = null,
        concept_json = jsonb_set(concept_json, '{pipeline,state}', '"pending"'::jsonb), updated_at = now()
      where status = 'generating' and lease_expires_at < now() and attempt_count < ${maxAttempts}
        and concept_json->>'pipelineVersion' in (${POST_PIPELINE_V3}, ${POST_PIPELINE_V4}) returning id
    `);
    const failed = await this.database.client.execute<{ id: string }>(sql`
      update opod.post_drafts set status = 'failed', lease_expires_at = null, error_message = 'V3 stage lease expired',
        concept_json = jsonb_set(jsonb_set(concept_json, '{pipeline,state}', '"failed"'::jsonb), '{pipeline,reasonCodes}', '["lease_expired"]'::jsonb), updated_at = now()
      where status = 'generating' and lease_expires_at < now() and attempt_count >= ${maxAttempts}
        and concept_json->>'pipelineVersion' in (${POST_PIPELINE_V3}, ${POST_PIPELINE_V4}) returning id
    `);
    return { requeued: requeued.rows.length, failed: failed.rows.length };
  }

  async claimPlannedDraft(leaseSeconds: number): Promise<string | undefined> {
    const result = await this.database.client.execute<{ id: string }>(sql`
      update opod.post_drafts set status = 'generating', lease_expires_at = now() + make_interval(secs => ${leaseSeconds}), attempt_count = attempt_count + 1, updated_at = now()
      where id = (select d.id from opod.post_drafts d join opod.characters c on c.id = d.character_id and c.status = 'active'
        where d.status = 'planned' and d.draft_type = 'post' and (d.concept_json->>'mode') is distinct from 'manual'
          and (d.concept_json->>'pipelineVersion' is null or d.concept_json->>'pipelineVersion' not in (${POST_PIPELINE_V3}, ${POST_PIPELINE_V4}))
        order by d.created_at, d.id limit 1 for update of d skip locked) returning id
    `);
    return result.rows[0]?.id;
  }

  async claimV3Draft(leaseSeconds: number): Promise<string | undefined> {
    const result = await this.database.client.execute<{ id: string }>(sql`
      update opod.post_drafts set status = 'generating', lease_expires_at = now() + make_interval(secs => ${leaseSeconds}), attempt_count = attempt_count + 1,
        concept_json = jsonb_set(concept_json #- '{pipeline,failure}', '{pipeline,state}', '"running"'::jsonb), updated_at = now()
      where id = (select d.id from opod.post_drafts d join opod.characters c on c.id = d.character_id and c.status = 'active'
        where d.status = 'planned' and d.draft_type = 'post' and d.concept_json->>'pipelineVersion' in (${POST_PIPELINE_V3}, ${POST_PIPELINE_V4})
          and d.concept_json#>>'{pipeline,state}' = 'pending' and d.concept_json#>>'{pipeline,stage}' in ('post_plan','image_plan','image_prompt','caption')
          and (d.concept_json->>'mode') is distinct from 'manual'
        order by d.created_at, d.id limit 1 for update of d skip locked) returning id
    `);
    return result.rows[0]?.id;
  }

  async claimV3DraftNow(
    draftId: string,
    leaseSeconds: number,
  ): Promise<boolean> {
    const result = await this.database.client.execute<{ id: string }>(sql`
      update opod.post_drafts set status = 'generating', lease_expires_at = now() + make_interval(secs => ${leaseSeconds}),
        attempt_count = case when status = 'failed' then 1 else attempt_count + 1 end, error_message = null,
        concept_json = jsonb_set(jsonb_set(concept_json #- '{pipeline,failure}', '{pipeline,stage}',
          case when concept_json#>>'{pipeline,stage}' = 'publish' then '"caption"'::jsonb else concept_json#>'{pipeline,stage}' end), '{pipeline,state}', '"running"'::jsonb), updated_at = now()
      where id = ${draftId}::uuid and status in ('planned','failed') and draft_type = 'post'
        and concept_json->>'pipelineVersion' in (${POST_PIPELINE_V3}, ${POST_PIPELINE_V4}) and concept_json#>>'{pipeline,state}' <> 'running'
        and (concept_json#>>'{pipeline,stage}' in ('post_plan','image_plan','image_prompt','caption') or (concept_json#>>'{pipeline,stage}' = 'publish' and concept_json->'captionBuild' is not null))
      returning id
    `);
    return result.rows.length === 1;
  }

  persistV3Paused(input: {
    draftId: string;
    characterId: string;
    expectedStage: string;
    conceptJson: unknown;
    reason: string;
  }): Promise<boolean> {
    return this.database.client.transaction(async (tx) => {
      const updated = await tx
        .update(postDrafts)
        .set({
          conceptJson: input.conceptJson,
          status: "planned",
          leaseExpiresAt: null,
          attemptCount: 0,
          errorMessage: null,
        })
        .where(
          and(
            eq(postDrafts.id, input.draftId),
            eq(postDrafts.status, "generating"),
            eq(
              sql<string>`${postDrafts.conceptJson}#>>'{pipeline,stage}'`,
              input.expectedStage,
            ),
            eq(
              sql<string>`${postDrafts.conceptJson}#>>'{pipeline,state}'`,
              "running",
            ),
          ),
        )
        .returning({ id: postDrafts.id });
      if (updated.length !== 1) return false;
      await tx.insert(characterActionLogs).values({
        characterId: input.characterId,
        actionType: "DRAFT_V3_PAUSED",
        targetTable: "post_drafts",
        targetId: input.draftId,
        reason: input.reason,
      });
      return true;
    });
  }

  persistV3PromptJobs(input: {
    draftId: string;
    characterId: string;
    columns?: { caption: string; hashtags: string[] };
    locationId: string | null;
    conceptJson: unknown;
    manual: boolean;
    candidateCount?: number;
    jobs: { prompt: string; sortOrder: number; paramsJson: unknown }[];
  }): Promise<boolean> {
    return this.database.client.transaction(async (tx) => {
      const updated = await tx
        .update(postDrafts)
        .set({
          ...(input.columns ?? {}),
          locationId: input.locationId,
          conceptJson: input.conceptJson,
          leaseExpiresAt: null,
          attemptCount: 0,
          errorMessage: null,
        })
        .where(
          and(
            eq(postDrafts.id, input.draftId),
            eq(postDrafts.status, "generating"),
            eq(
              sql<string>`${postDrafts.conceptJson}#>>'{pipeline,stage}'`,
              "image_prompt",
            ),
            eq(
              sql<string>`${postDrafts.conceptJson}#>>'{pipeline,state}'`,
              "running",
            ),
          ),
        )
        .returning({ id: postDrafts.id });
      if (updated.length !== 1) return false;
      if (input.jobs.length > 0)
        await tx.insert(generationJobs).values(
          input.jobs.map((job) => ({
            characterId: input.characterId,
            mediaType: "image" as const,
            prompt: job.prompt,
            draftId: input.draftId,
            sortOrder: job.sortOrder,
            ...(input.manual ? { status: "draft" as const } : {}),
            ...(input.candidateCount !== undefined
              ? { candidateCount: input.candidateCount }
              : {}),
            paramsJson: job.paramsJson,
          })),
        );
      await tx.insert(characterActionLogs).values({
        characterId: input.characterId,
        actionType: "DRAFT_V3_PROMPTS_READY",
        targetTable: "post_drafts",
        targetId: input.draftId,
        reason: `${input.jobs.length} V3 prompt job(s) stored`,
      });
      return true;
    });
  }

  async requeueOrFailV3(input: {
    draftId: string;
    conceptJson: unknown;
    message: string;
    terminal: boolean;
  }): Promise<void> {
    await this.database.client
      .update(postDrafts)
      .set({
        status: input.terminal ? "failed" : "planned",
        conceptJson: input.conceptJson,
        errorMessage: input.message,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(postDrafts.id, input.draftId),
          eq(postDrafts.status, "generating"),
        ),
      );
  }

  async findPlannedDraft(draftId: string): Promise<PlannedDraft | null> {
    const [draft] = await this.database.client
      .select()
      .from(postDrafts)
      .where(eq(postDrafts.id, draftId))
      .limit(1);
    if (!draft) return null;
    return {
      ...draft,
      character: await this.hydratePlannedCharacter(draft.characterId),
    };
  }

  async extendPlanLease(draftId: string, leaseSeconds: number): Promise<void> {
    await this.database.client
      .update(postDrafts)
      .set({ leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1000) })
      .where(
        and(eq(postDrafts.id, draftId), eq(postDrafts.status, "generating")),
      );
  }

  async persistPlan(input: {
    draftId: string;
    characterId: string;
    caption: string;
    hashtags: string[];
    locationId?: string;
    conceptJson: unknown;
    plannerName: string;
    builderName?: string;
    jobs: {
      prompt: string;
      sortOrder: number;
      status?: "draft";
      paramsJson: unknown;
    }[];
  }): Promise<void> {
    await this.database.client.transaction(async (tx) => {
      const transitioned = await tx
        .update(postDrafts)
        .set({
          caption: input.caption,
          hashtags: input.hashtags,
          locationId: input.locationId ?? null,
          conceptJson: input.conceptJson,
          leaseExpiresAt: null,
          errorMessage: null,
        })
        .where(
          and(
            eq(postDrafts.id, input.draftId),
            eq(postDrafts.status, "generating"),
          ),
        )
        .returning({ id: postDrafts.id });
      if (transitioned.length === 0)
        throw new Error("draft left the generating state during planning");
      if (input.jobs.length > 0)
        await tx.insert(generationJobs).values(
          input.jobs.map((job) => ({
            characterId: input.characterId,
            mediaType: "image" as const,
            prompt: job.prompt,
            draftId: input.draftId,
            sortOrder: job.sortOrder,
            ...(job.status ? { status: job.status } : {}),
            paramsJson: job.paramsJson,
          })),
        );
      await tx.insert(characterActionLogs).values({
        characterId: input.characterId,
        actionType: "DRAFT_PLANNED",
        targetTable: "post_drafts",
        targetId: input.draftId,
        reason: `draft planned via ${input.plannerName}${input.builderName ? `, prompts via ${input.builderName}` : ""} (${input.jobs.length} shot(s))`,
      });
    });
  }

  failPlanning(draftId: string, message: string): Promise<boolean> {
    return this.transition(draftId, "generating", {
      status: "failed",
      errorMessage: message,
      leaseExpiresAt: null,
    });
  }
  async requeuePlanning(draftId: string, message: string): Promise<void> {
    await this.transition(draftId, "generating", {
      status: "planned",
      errorMessage: message,
      leaseExpiresAt: null,
    });
  }

  async findGeneratingDrafts(take: number): Promise<AggregateDraft[]> {
    const result = await this.database.client.execute<{ id: string }>(
      sql`select d.id from opod.post_drafts d where d.status in ('generating','regenerating') and d.lease_expires_at is null and (d.concept_json->>'mode') is distinct from 'manual' order by d.updated_at, d.id limit ${take}`,
    );
    return Promise.all(
      result.rows.map(async ({ id }) => (await this.findAggregateDraft(id))!),
    );
  }

  async requeueDraftWithoutJobs(
    draftId: string,
    currentStatus: string,
  ): Promise<void> {
    await this.transition(draftId, currentStatus as DraftStatus, {
      status: "planned",
    });
  }
  failGeneratedDraft(
    draftId: string,
    currentStatus: string,
    message: string,
  ): Promise<boolean> {
    return this.transition(draftId, currentStatus as DraftStatus, {
      status: "failed",
      errorMessage: message,
    });
  }
  markDraftNeedsReview(
    draftId: string,
    currentStatus: string,
  ): Promise<boolean> {
    return this.transition(draftId, currentStatus as DraftStatus, {
      status: "needs_review",
      errorMessage: null,
    });
  }
  markDraftCaptionPending(
    draftId: string,
    currentStatus: string,
    conceptJson: unknown,
  ): Promise<boolean> {
    return this.transition(draftId, currentStatus as DraftStatus, {
      status: "planned",
      conceptJson,
      attemptCount: 0,
      errorMessage: null,
    });
  }

  async findDueDrafts(
    now: Date,
    take: number,
    leaseSeconds: number,
    retryBefore: Date,
  ): Promise<PublishDraft[]> {
    const result = await this.database.client.execute<PublishDraft>(sql`
      with candidates as (
        select d.id from opod.post_drafts d join opod.characters c on c.id = d.character_id and c.status = 'active'
        where d.draft_type = 'post' and (d.status = 'approved' or (d.status = 'planned' and d.concept_json#>>'{pipeline,stage}' = 'publish' and d.concept_json#>>'{pipeline,state}' = 'pending'))
          and (d.scheduled_at is null or d.scheduled_at <= ${now}) and (d.concept_json->>'mode') is distinct from 'manual'
          and (d.lease_expires_at is null or d.lease_expires_at < now()) and (d.error_message is null or d.updated_at <= ${retryBefore})
        order by (d.error_message is not null), d.scheduled_at asc nulls first, d.id limit ${take} for update of d skip locked)
      update opod.post_drafts d set lease_expires_at = now() + make_interval(secs => ${leaseSeconds}) from candidates where d.id = candidates.id
      returning d.id, d.character_id as "characterId", d.content_type as "contentType", d.caption, coalesce(d.hashtags, ARRAY[]::text[]) as hashtags, d.concept_json as "conceptJson", d.lease_expires_at as "leaseExpiresAt"
    `);
    return result.rows;
  }

  async recordPublishFailure(input: {
    draftId: string;
    characterId: string;
    message: string;
    leaseExpiresAt?: Date | null;
  }): Promise<void> {
    await this.recordPublishError(
      input.draftId,
      input.message,
      input.leaseExpiresAt,
    );
    try {
      await this.database.client.insert(serviceLogs).values({
        source: "admin-worker",
        level: "error",
        eventType: "DRAFT_PUBLISH_FAILED",
        message: input.message,
        contextJson: {
          draftId: input.draftId,
          characterId: input.characterId,
        },
      });
    } catch {}
  }

  async findCaptionShots(draftId: string): Promise<CaptionShot[]> {
    const jobs = await this.database.client
      .select({
        id: generationJobs.id,
        sortOrder: generationJobs.sortOrder,
        status: generationJobs.status,
        outputMediaId: generationJobs.outputMediaId,
        media: {
          id: media.id,
          url: media.url,
          storageKey: media.storageKey,
          contentType: media.contentType,
        },
      })
      .from(generationJobs)
      .leftJoin(media, eq(media.id, generationJobs.outputMediaId))
      .where(eq(generationJobs.draftId, draftId))
      .orderBy(desc(generationJobs.createdAt), desc(generationJobs.id));
    const latest = new Map<number, (typeof jobs)[number]>();
    for (const job of jobs)
      if (!latest.has(job.sortOrder)) latest.set(job.sortOrder, job);
    return [...latest.values()]
      .filter((job) => job.status === "completed" && job.media?.id)
      .map((job) => ({
        sortOrder: job.sortOrder,
        jobId: job.id,
        mediaId: job.media!.id,
        media: {
          url: job.media!.url,
          storageKey: job.media!.storageKey,
          contentType: job.media!.contentType,
        },
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async findPublishJobs(draftId: string): Promise<PublishJob[]> {
    const jobs = await this.database.client
      .select({
        id: generationJobs.id,
        sortOrder: generationJobs.sortOrder,
        status: generationJobs.status,
        outputMediaId: generationJobs.outputMediaId,
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
            filterPreset: generationJobOutputs.filterPreset,
          })
          .from(generationJobOutputs)
          .where(eq(generationJobOutputs.jobId, job.id)),
      })),
    );
  }

  async persistPublishedPost(input: {
    draftId: string;
    characterId: string;
    contentType: string;
    caption: string;
    hashtags: string[];
    leaseExpiresAt?: Date | null;
    memoryContent?: string;
    memories?: { type: string; content: string; reason: string }[];
    media: {
      originalMediaId: string;
      finishedFile: FinishedPublishFile | null;
    }[];
  }): Promise<void> {
    await this.database.client.transaction(async (tx) => {
      const transitioned = await tx
        .update(postDrafts)
        .set({ status: "published", errorMessage: null, leaseExpiresAt: null })
        .where(
          and(
            eq(postDrafts.id, input.draftId),
            publishableCondition,
            input.leaseExpiresAt
              ? eq(postDrafts.leaseExpiresAt, input.leaseExpiresAt)
              : undefined,
          ),
        )
        .returning({ id: postDrafts.id });
      if (transitioned.length === 0)
        throw new Error("draft left the publishable state before publish");
      const publishMediaIds: string[] = [];
      for (const item of input.media) {
        if (!item.finishedFile) {
          publishMediaIds.push(item.originalMediaId);
          continue;
        }
        const [created] = await tx
          .insert(media)
          .values({
            mediaType: "image",
            url: item.finishedFile.url,
            storageKey: item.finishedFile.storageKey,
            contentType: item.finishedFile.contentType,
            byteSize: item.finishedFile.byteSize,
            width: item.finishedFile.width,
            height: item.finishedFile.height,
            isAiGenerated: true,
            uploadedAt: new Date(),
          })
          .returning({ id: media.id });
        publishMediaIds.push(created.id);
      }
      const contentType = input.contentType === "reel" ? "reel" : "feed";
      const [post] = await tx
        .insert(posts)
        .values({
          characterId: input.characterId,
          contentType,
          content: input.caption,
        })
        .returning({ id: posts.id });
      for (const name of input.hashtags) {
        const [tag] = await tx
          .insert(hashtags)
          .values({ name })
          .onConflictDoUpdate({ target: hashtags.name, set: { name } })
          .returning({ id: hashtags.id });
        await tx
          .insert(postHashtags)
          .values({ postId: post.id, hashtagId: tag.id });
      }
      if (publishMediaIds.length > 0)
        await tx.insert(postMedia).values(
          publishMediaIds.map((mediaId, sortOrder) => ({
            postId: post.id,
            mediaId,
            sortOrder,
          })),
        );
      await tx
        .update(postDrafts)
        .set({ publishedPostId: post.id })
        .where(eq(postDrafts.id, input.draftId));
      await tx.insert(characterActionLogs).values({
        characterId: input.characterId,
        actionType: "POST_CREATED",
        targetTable: "posts",
        targetId: post.id,
        reason: `auto-published from draft ${input.draftId}`,
      });
      const memories =
        input.memories ??
        (input.memoryContent
          ? [
              {
                type: "fact",
                content: input.memoryContent,
                reason: "auto: post published from draft",
              },
            ]
          : []);
      for (const memory of memories) {
        const exists =
          (
            await tx
              .select({ id: characterMemories.id })
              .from(characterMemories)
              .where(
                and(
                  eq(characterMemories.characterId, input.characterId),
                  eq(characterMemories.type, memory.type),
                  eq(characterMemories.content, memory.content),
                  isNull(characterMemories.deletedAt),
                ),
              )
              .limit(1)
          ).length > 0;
        if (!exists)
          await tx
            .insert(characterMemories)
            .values({ characterId: input.characterId, ...memory });
      }
    });
  }

  findMediaForFinish(mediaId: string) {
    return this.database.client
      .select({
        mediaType: media.mediaType,
        url: media.url,
        storageKey: media.storageKey,
      })
      .from(media)
      .where(eq(media.id, mediaId))
      .limit(1)
      .then(([row]) => row ?? null);
  }
  findEnabledPostingPolicies(): Promise<PostingPolicy[]> {
    return this.database.client
      .select({
        characterId: characterPostingPolicies.characterId,
        weeklyCadence: characterPostingPolicies.weeklyCadence,
        hourStartKst: characterPostingPolicies.hourStartKst,
        hourEndKst: characterPostingPolicies.hourEndKst,
      })
      .from(characterPostingPolicies)
      .innerJoin(
        characters,
        eq(characters.id, characterPostingPolicies.characterId),
      )
      .where(
        and(
          eq(characterPostingPolicies.enabled, true),
          eq(characters.status, "active"),
        ),
      );
  }
  findPendingDraft(characterId: string): Promise<{ id: string } | null> {
    return this.database.client
      .select({ id: postDrafts.id })
      .from(postDrafts)
      .where(
        and(
          eq(postDrafts.characterId, characterId),
          inArray(postDrafts.status, [
            "planned",
            "generating",
            "regenerating",
            "needs_review",
            "approved",
          ]),
        ),
      )
      .limit(1)
      .then(([row]) => row ?? null);
  }
  findLastDraft(characterId: string) {
    return this.database.client
      .select({
        scheduledAt: postDrafts.scheduledAt,
        createdAt: postDrafts.createdAt,
      })
      .from(postDrafts)
      .where(eq(postDrafts.characterId, characterId))
      .orderBy(desc(postDrafts.createdAt))
      .limit(1)
      .then(([row]) => row ?? null);
  }
  findLastPost(characterId: string) {
    return this.database.client
      .select({ createdAt: posts.createdAt })
      .from(posts)
      .where(eq(posts.characterId, characterId))
      .orderBy(desc(posts.createdAt))
      .limit(1)
      .then(([row]) => row ?? null);
  }

  createScheduledDraft(
    characterId: string,
    scheduledAt: Date,
    pipelineV3Enabled = false,
  ): Promise<boolean> {
    return this.database.client.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${characterId}, 0))`,
      );
      const pending = await tx
        .select({ id: postDrafts.id })
        .from(postDrafts)
        .where(
          and(
            eq(postDrafts.characterId, characterId),
            inArray(postDrafts.status, [
              "planned",
              "generating",
              "regenerating",
              "needs_review",
              "approved",
            ]),
          ),
        )
        .limit(1);
      if (pending.length > 0) return false;
      await tx.insert(postDrafts).values({
        characterId,
        conceptJson: pipelineV3Enabled
          ? createPostPipelineV3Concept({ source: "scheduler", mode: "auto" })
          : { source: "scheduler" },
        scheduledAt,
      });
      return true;
    });
  }

  async recordActionLog(input: {
    characterId: string;
    targetId: string;
    actionType: string;
    reason: string;
  }): Promise<void> {
    await this.database.client.insert(characterActionLogs).values({
      characterId: input.characterId,
      actionType: input.actionType,
      targetTable: "post_drafts",
      targetId: input.targetId,
      reason: input.reason,
    });
  }

  private aggregateJobs(draftId: string) {
    return this.database.client
      .select({
        sortOrder: generationJobs.sortOrder,
        status: generationJobs.status,
      })
      .from(generationJobs)
      .where(eq(generationJobs.draftId, draftId))
      .orderBy(desc(generationJobs.createdAt), desc(generationJobs.id));
  }
  private async transition(
    draftId: string,
    currentStatus: DraftStatus,
    set: Partial<typeof postDrafts.$inferInsert>,
  ): Promise<boolean> {
    return (
      (
        await this.database.client
          .update(postDrafts)
          .set(set)
          .where(
            and(
              eq(postDrafts.id, draftId),
              eq(postDrafts.status, currentStatus),
            ),
          )
          .returning({ id: postDrafts.id })
      ).length > 0
    );
  }

  private async hydratePlannedCharacter(
    characterId: string,
  ): Promise<PlannedCharacter> {
    const [character] = await this.database.client
      .select({
        displayName: characters.displayName,
        bio: characters.bio,
        interests: sql<
          string[]
        >`coalesce(${characters.interests}, ARRAY[]::text[])`,
        contentLanguage: characters.contentLanguage,
      })
      .from(characters)
      .where(eq(characters.id, characterId))
      .limit(1);
    const [personas, memories, recentPosts, profile] = await Promise.all([
      this.database.client
        .select({
          title: characterPersonas.title,
          content: characterPersonas.content,
        })
        .from(characterPersonas)
        .where(
          and(
            eq(characterPersonas.characterId, characterId),
            isNull(characterPersonas.deletedAt),
          ),
        )
        .orderBy(asc(characterPersonas.sortOrder)),
      this.database.client
        .select({
          type: characterMemories.type,
          content: characterMemories.content,
        })
        .from(characterMemories)
        .where(
          and(
            eq(characterMemories.characterId, characterId),
            isNull(characterMemories.deletedAt),
          ),
        )
        .orderBy(desc(characterMemories.createdAt))
        .limit(20),
      this.database.client
        .select({ id: posts.id, content: posts.content })
        .from(posts)
        .where(eq(posts.characterId, characterId))
        .orderBy(desc(posts.createdAt))
        .limit(20),
      this.database.client
        .select({
          id: characterVisualProfiles.id,
          appearancePrompt: characterVisualProfiles.appearancePrompt,
          stylePrompt: characterVisualProfiles.stylePrompt,
          negativePrompt: characterVisualProfiles.negativePrompt,
        })
        .from(characterVisualProfiles)
        .where(eq(characterVisualProfiles.characterId, characterId))
        .limit(1)
        .then(([row]) => row ?? null),
    ]);
    const hydratedPosts = await Promise.all(
      recentPosts.map(async (post) => ({
        content: post.content,
        hashtags: await this.database.client
          .select({ hashtag: { name: hashtags.name } })
          .from(postHashtags)
          .innerJoin(hashtags, eq(hashtags.id, postHashtags.hashtagId))
          .where(eq(postHashtags.postId, post.id)),
        sourceDrafts: await this.database.client
          .select({ conceptJson: postDrafts.conceptJson })
          .from(postDrafts)
          .where(eq(postDrafts.publishedPostId, post.id))
          .orderBy(desc(postDrafts.createdAt))
          .limit(1),
      })),
    );
    const referenceMedia = profile
      ? await this.database.client
          .select({
            mediaId: characterVisualProfileReferences.mediaId,
            description: characterVisualProfileReferences.description,
            media: { uploadedAt: media.uploadedAt },
          })
          .from(characterVisualProfileReferences)
          .innerJoin(
            media,
            eq(media.id, characterVisualProfileReferences.mediaId),
          )
          .where(
            and(
              eq(characterVisualProfileReferences.profileId, profile.id),
              eq(characterVisualProfileReferences.isActive, true),
            ),
          )
          .orderBy(asc(characterVisualProfileReferences.sortOrder))
      : [];
    return {
      ...character,
      personas,
      memories,
      posts: hydratedPosts,
      visualProfile: profile ? { ...profile, referenceMedia } : null,
    };
  }
}
