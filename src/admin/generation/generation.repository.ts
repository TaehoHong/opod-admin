import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { AssertableMedia } from "../media/media.service";
import { DatabaseService } from "../../domain/database/database.service";
import {
  characterActionLogs,
  characterMemories,
  characterPersonas,
  characterVisualProfileReferences,
  characterVisualProfiles,
  characters,
  generationJobOutputs,
  generationJobs,
  media,
  posts,
} from "../../domain/database/schema";

export type GenerationParams = unknown;
export type GenerationParamsObject = Record<string, unknown>;
export type GenerationParamsValue = unknown;
export type OutputSelectionResult = "missing" | "unchanged" | "selected";
type OutputMedia = typeof media.$inferSelect;
export type GenerationJobRow = typeof generationJobs.$inferSelect & {
  outputMedia: OutputMedia | null;
};
export type GenerationJobDetailRow = GenerationJobRow & {
  outputs: Array<
    typeof generationJobOutputs.$inferSelect & { media: { url: string } }
  >;
  character: {
    visualProfile: {
      negativePrompt: string;
      referenceMedia: Array<{ media: { uploadedAt: Date | null } }>;
    } | null;
  };
};
export type ImageDraftCharacterRow = Pick<
  typeof characters.$inferSelect,
  "id" | "displayName" | "bio"
> & {
  interests: string[];
  personas: Array<
    Pick<typeof characterPersonas.$inferSelect, "title" | "content">
  >;
  memories: Array<Pick<typeof characterMemories.$inferSelect, "content">>;
  posts: Array<Pick<typeof posts.$inferSelect, "content">>;
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

function paramsWithoutProviderProgress(value: unknown): unknown {
  if (value == null || typeof value !== "object" || Array.isArray(value))
    return value;
  const params = { ...(value as Record<string, unknown>) };
  delete params._providerProgress;
  return params;
}

@Injectable()
export class GenerationRepository {
  constructor(private readonly database: DatabaseService) {}

  async findCharacterForImageDraft(
    characterId: string,
  ): Promise<ImageDraftCharacterRow | null> {
    const [character] = await this.database.client
      .select({
        id: characters.id,
        displayName: characters.displayName,
        bio: characters.bio,
        interests: sql<
          string[]
        >`coalesce(${characters.interests}, ARRAY[]::text[])`,
      })
      .from(characters)
      .where(eq(characters.id, characterId))
      .limit(1);
    if (!character) return null;
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
        .select({ content: characterMemories.content })
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
        .select({ content: posts.content })
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
      posts: recentPosts,
      visualProfile: profile ? { ...profile, referenceMedia } : null,
    };
  }

  async createImageDraft(input: {
    characterId: string;
    inputPrompt: string;
    prompt: string;
    candidateCount: number;
    paramsJson: GenerationParamsObject;
  }): Promise<GenerationJobRow> {
    const [job] = await this.database.client
      .insert(generationJobs)
      .values({
        characterId: input.characterId,
        mediaType: "image",
        status: "draft",
        inputPrompt: input.inputPrompt,
        prompt: input.prompt,
        candidateCount: input.candidateCount,
        ...(Object.keys(input.paramsJson).length > 0
          ? { paramsJson: input.paramsJson }
          : {}),
      })
      .returning();
    return { ...job, outputMedia: null };
  }

  async updateImageDraft(
    jobId: string,
    input: { prompt: string; candidateCount: number },
  ): Promise<boolean> {
    return (
      (
        await this.database.client
          .update(generationJobs)
          .set(input)
          .where(
            and(
              eq(generationJobs.id, jobId),
              eq(generationJobs.status, "draft"),
            ),
          )
          .returning({ id: generationJobs.id })
      ).length > 0
    );
  }

  confirmImageDraft(jobId: string): Promise<boolean> {
    return this.database.client.transaction(async (tx) => {
      const [confirmed] = await tx
        .update(generationJobs)
        .set({ status: "queued" })
        .where(
          and(eq(generationJobs.id, jobId), eq(generationJobs.status, "draft")),
        )
        .returning({ characterId: generationJobs.characterId });
      if (!confirmed) return false;
      await tx.insert(characterActionLogs).values({
        characterId: confirmed.characterId,
        actionType: "GENERATION_DRAFT_CONFIRMED",
        targetTable: "generation_jobs",
        targetId: jobId,
        reason: "generation draft confirmed",
      });
      return true;
    });
  }

  selectOutput(jobId: string, mediaId: string): Promise<OutputSelectionResult> {
    return this.database.client.transaction(async (tx) => {
      await tx.execute(
        sql`select id from opod.generation_jobs where id = ${jobId}::uuid for update`,
      );
      const [output] = await tx
        .select({
          selected: generationJobOutputs.selected,
          characterId: generationJobs.characterId,
          outputMediaId: generationJobs.outputMediaId,
        })
        .from(generationJobOutputs)
        .innerJoin(
          generationJobs,
          eq(generationJobs.id, generationJobOutputs.jobId),
        )
        .where(
          and(
            eq(generationJobOutputs.jobId, jobId),
            eq(generationJobOutputs.mediaId, mediaId),
            eq(generationJobs.status, "completed"),
          ),
        )
        .limit(1);
      if (!output) return "missing";
      if (output.selected && output.outputMediaId === mediaId)
        return "unchanged";
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
      await tx.insert(characterActionLogs).values({
        characterId: output.characterId,
        actionType: "GENERATION_OUTPUT_SELECTED",
        targetTable: "generation_jobs",
        targetId: jobId,
        reason: `selected generation output ${mediaId}`,
      });
      return "selected";
    });
  }

  findJob(jobId: string): Promise<GenerationJobRow | null> {
    return this.findJobWithOutput(jobId);
  }

  async createRegeneratedImageJob(
    source: GenerationJobRow,
  ): Promise<GenerationJobRow> {
    const [job] = await this.database.client
      .insert(generationJobs)
      .values({
        characterId: source.characterId,
        mediaType: "image",
        status: "draft",
        inputPrompt: source.inputPrompt ?? source.prompt,
        prompt: source.prompt,
        candidateCount: source.candidateCount,
        ...(source.paramsJson != null
          ? { paramsJson: paramsWithoutProviderProgress(source.paramsJson) }
          : {}),
        originJobId: source.id,
      })
      .returning();
    return { ...job, outputMedia: null };
  }

  async cursorMatchesFilter(
    cursorId: string,
    filter: {
      characterId?: string;
      status?: (typeof generationJobs.$inferSelect)["status"];
      mediaType?: "image" | "video";
      draftId?: null;
    },
  ): Promise<boolean> {
    const rows = await this.database.client
      .select({ id: generationJobs.id })
      .from(generationJobs)
      .where(and(eq(generationJobs.id, cursorId), this.filterCondition(filter)))
      .limit(1);
    return rows.length > 0;
  }

  async findManyForList(input: {
    characterId?: string;
    status?: (typeof generationJobs.$inferSelect)["status"];
    mediaType?: "image" | "video";
    draftId?: null;
    take: number;
    cursor?: string;
  }): Promise<GenerationJobRow[]> {
    const [cursor] = input.cursor
      ? await this.database.client
          .select({
            id: generationJobs.id,
            createdAt: generationJobs.createdAt,
          })
          .from(generationJobs)
          .where(eq(generationJobs.id, input.cursor))
          .limit(1)
      : [];
    const jobs = await this.database.client
      .select()
      .from(generationJobs)
      .where(
        and(
          this.filterCondition(input),
          cursor
            ? or(
                lt(generationJobs.createdAt, cursor.createdAt),
                and(
                  eq(generationJobs.createdAt, cursor.createdAt),
                  lt(generationJobs.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(generationJobs.createdAt), desc(generationJobs.id))
      .limit(input.take);
    return Promise.all(jobs.map((job) => this.attachOutput(job)));
  }

  async enqueueJob(input: {
    characterId: string;
    mediaType: "image" | "video";
    prompt: string;
    provider?: string;
    paramsJson?: GenerationParams;
    originJobId?: string;
  }): Promise<GenerationJobRow> {
    const [job] = await this.database.client
      .insert(generationJobs)
      .values(input)
      .returning();
    return { ...job, outputMedia: null };
  }

  async startJob(jobId: string, leaseExpiresAt: Date): Promise<boolean> {
    const rows = await this.database.client
      .update(generationJobs)
      .set({
        status: "running",
        leaseExpiresAt,
        attemptCount: sql`${generationJobs.attemptCount} + 1`,
      })
      .where(
        and(eq(generationJobs.id, jobId), eq(generationJobs.status, "queued")),
      )
      .returning({ id: generationJobs.id });
    return rows.length > 0;
  }

  retryJob(
    source: GenerationJobRow,
    reason: string,
  ): Promise<GenerationJobRow> {
    return this.database.client.transaction(async (tx) => {
      const [created] = await tx
        .insert(generationJobs)
        .values({
          characterId: source.characterId,
          mediaType: source.mediaType,
          inputPrompt: source.inputPrompt,
          prompt: source.prompt,
          candidateCount: source.candidateCount,
          ...(source.paramsJson != null
            ? { paramsJson: paramsWithoutProviderProgress(source.paramsJson) }
            : {}),
          sortOrder: source.sortOrder,
          originJobId: source.id,
        })
        .returning();
      await tx.insert(characterActionLogs).values({
        characterId: source.characterId,
        actionType: "GENERATION_JOB_RETRIED",
        targetTable: "generation_jobs",
        targetId: created.id,
        reason,
      });
      return { ...created, outputMedia: null };
    });
  }

  async failJob(jobId: string, errorMessage: string): Promise<boolean> {
    const rows = await this.database.client
      .update(generationJobs)
      .set({ status: "failed", errorMessage, leaseExpiresAt: null })
      .where(
        and(
          eq(generationJobs.id, jobId),
          inArray(generationJobs.status, ["queued", "running"]),
        ),
      )
      .returning({ id: generationJobs.id });
    return rows.length > 0;
  }

  findUploadedMedia(mediaId: string): Promise<AssertableMedia | null> {
    return this.database.client
      .select({
        id: media.id,
        mediaType: media.mediaType,
        url: media.url,
        width: media.width,
        height: media.height,
        durationSeconds: media.durationSeconds,
        uploadedAt: media.uploadedAt,
      })
      .from(media)
      .where(eq(media.id, mediaId))
      .limit(1)
      .then(([row]) => row ?? null);
  }

  async completeJobWithMediaId(
    jobId: string,
    mediaId: string,
  ): Promise<boolean> {
    return (
      (
        await this.database.client
          .update(generationJobs)
          .set({
            status: "completed",
            outputMediaId: mediaId,
            leaseExpiresAt: null,
          })
          .where(
            and(
              eq(generationJobs.id, jobId),
              eq(generationJobs.status, "running"),
            ),
          )
          .returning({ id: generationJobs.id })
      ).length > 0
    );
  }

  completeJobWithUrl(input: {
    jobId: string;
    mediaType: "image" | "video";
    url: string;
    width?: number;
    height?: number;
    durationSeconds?: number;
  }): Promise<boolean> {
    return this.database.client.transaction(async (tx) => {
      const [createdMedia] = await tx
        .insert(media)
        .values({
          mediaType: input.mediaType,
          url: input.url,
          width: input.width,
          height: input.height,
          durationSeconds: input.durationSeconds,
        })
        .returning({ id: media.id });
      const rows = await tx
        .update(generationJobs)
        .set({
          status: "completed",
          outputMediaId: createdMedia.id,
          leaseExpiresAt: null,
        })
        .where(
          and(
            eq(generationJobs.id, input.jobId),
            eq(generationJobs.status, "running"),
          ),
        )
        .returning({ id: generationJobs.id });
      return rows.length > 0;
    });
  }

  async findJobDetail(jobId: string): Promise<GenerationJobDetailRow | null> {
    const job = await this.findJobWithOutput(jobId);
    if (!job) return null;
    const outputs = await this.database.client
      .select({
        id: generationJobOutputs.id,
        jobId: generationJobOutputs.jobId,
        mediaId: generationJobOutputs.mediaId,
        candidateIndex: generationJobOutputs.candidateIndex,
        selected: generationJobOutputs.selected,
        createdAt: generationJobOutputs.createdAt,
        filterPreset: generationJobOutputs.filterPreset,
        media: { url: media.url },
      })
      .from(generationJobOutputs)
      .innerJoin(media, eq(media.id, generationJobOutputs.mediaId))
      .where(eq(generationJobOutputs.jobId, jobId))
      .orderBy(asc(generationJobOutputs.candidateIndex));
    const [profile] = await this.database.client
      .select({
        id: characterVisualProfiles.id,
        negativePrompt: characterVisualProfiles.negativePrompt,
      })
      .from(characterVisualProfiles)
      .where(eq(characterVisualProfiles.characterId, job.characterId))
      .limit(1);
    const referenceMedia = profile
      ? await this.database.client
          .select({ media: { uploadedAt: media.uploadedAt } })
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
      : [];
    return {
      ...job,
      outputs,
      character: {
        visualProfile: profile
          ? { negativePrompt: profile.negativePrompt, referenceMedia }
          : null,
      },
    };
  }

  private async findJobWithOutput(
    jobId: string,
  ): Promise<GenerationJobRow | null> {
    const [job] = await this.database.client
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.id, jobId))
      .limit(1);
    return job ? this.attachOutput(job) : null;
  }
  private async attachOutput(
    job: typeof generationJobs.$inferSelect,
  ): Promise<GenerationJobRow> {
    const outputMedia = job.outputMediaId
      ? await this.database.client
          .select()
          .from(media)
          .where(eq(media.id, job.outputMediaId))
          .limit(1)
          .then(([row]) => row ?? null)
      : null;
    return { ...job, outputMedia };
  }
  private filterCondition(input: {
    characterId?: string;
    status?: (typeof generationJobs.$inferSelect)["status"];
    mediaType?: "image" | "video";
    draftId?: null;
  }) {
    return and(
      input.characterId
        ? eq(generationJobs.characterId, input.characterId)
        : undefined,
      input.status ? eq(generationJobs.status, input.status) : undefined,
      input.mediaType
        ? eq(generationJobs.mediaType, input.mediaType)
        : undefined,
      input.draftId === null ? isNull(generationJobs.draftId) : undefined,
    );
  }
}
