import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, isNotNull, lt, sql, sum } from "drizzle-orm";
import { DatabaseService } from "../domain/database/database.service";
import {
  characterActionLogs,
  characterLocationReferences,
  characterLocations,
  characterVisualProfileReferences,
  characterVisualProfiles,
  characters,
  generationJobOutputs,
  generationJobs,
  llmLogMedia,
  llmLogs,
  media,
  postDrafts,
} from "../domain/database/schema";
import { LLM_LOG_TYPE } from "../domain/llm-logs/llm-log.service";
import type { ImageGenerationProgress } from "./image-generation.provider";

type Reference = {
  mediaId: string;
  media: Pick<typeof media.$inferSelect, "url" | "storageKey" | "uploadedAt">;
};
export type GenerationJobWithProfile = typeof generationJobs.$inferSelect & {
  character: typeof characters.$inferSelect & {
    visualProfile:
      | (typeof characterVisualProfiles.$inferSelect & {
          referenceMedia: Reference[];
        })
      | null;
  };
  draft:
    | (typeof postDrafts.$inferSelect & {
        location:
          | (typeof characterLocations.$inferSelect & {
              references: Reference[];
            })
          | null;
      })
    | null;
};
export type ExpiredLeaseJob = {
  id: string;
  characterId: string;
  attemptCount: number;
};
export type GeneratedFile = {
  url: string;
  storageKey?: string | null;
  contentType: string;
  byteSize: number;
  image: { width?: number; height?: number };
};

@Injectable()
export class GenerationJobRepository {
  constructor(private readonly database: DatabaseService) {}

  async claimNextQueuedImageJob(
    leaseSeconds: number,
  ): Promise<string | undefined> {
    const result = await this.database.client.execute<{ id: string }>(sql`
      update opod.generation_jobs
      set status = 'running',
          lease_expires_at = now() + make_interval(secs => ${leaseSeconds}),
          attempt_count = attempt_count + 1,
          updated_at = now()
      where id = (
        select id from opod.generation_jobs
        where status = 'queued' and media_type = 'image'
        order by created_at, id
        limit 1 for update skip locked
      )
      returning id
    `);
    return result.rows[0]?.id;
  }

  async claimQueuedImageJob(
    jobId: string,
    leaseSeconds: number,
  ): Promise<string | undefined> {
    const rows = await this.database.client
      .update(generationJobs)
      .set({
        status: "running",
        leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1000),
        attemptCount: sql`${generationJobs.attemptCount} + 1`,
      })
      .where(
        and(
          eq(generationJobs.id, jobId),
          eq(generationJobs.status, "queued"),
          eq(generationJobs.mediaType, "image"),
        ),
      )
      .returning({ id: generationJobs.id });
    return rows[0]?.id;
  }

  async requeueExpiredLeases(now: Date, maxAttempts: number): Promise<number> {
    const rows = await this.database.client
      .update(generationJobs)
      .set({ status: "queued", leaseExpiresAt: null })
      .where(
        and(
          eq(generationJobs.status, "running"),
          lt(generationJobs.leaseExpiresAt, now),
          lt(generationJobs.attemptCount, maxAttempts),
        ),
      )
      .returning({ id: generationJobs.id });
    return rows.length;
  }

  findExhaustedLeases(
    now: Date,
    maxAttempts: number,
  ): Promise<ExpiredLeaseJob[]> {
    return this.database.client
      .select({
        id: generationJobs.id,
        characterId: generationJobs.characterId,
        attemptCount: generationJobs.attemptCount,
      })
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.status, "running"),
          lt(generationJobs.leaseExpiresAt, now),
          gte(generationJobs.attemptCount, maxAttempts),
        ),
      );
  }

  async markFailed(jobId: string, message: string): Promise<boolean> {
    const rows = await this.database.client
      .update(generationJobs)
      .set({ status: "failed", errorMessage: message, leaseExpiresAt: null })
      .where(
        and(eq(generationJobs.id, jobId), eq(generationJobs.status, "running")),
      )
      .returning({ id: generationJobs.id });
    return rows.length > 0;
  }

  async requeueForRetry(input: {
    jobId: string;
    message: string;
    clearProviderRequestId: boolean;
  }): Promise<void> {
    await this.database.client
      .update(generationJobs)
      .set({
        status: "queued",
        leaseExpiresAt: null,
        errorMessage: input.message,
        ...(input.clearProviderRequestId ? { providerRequestId: null } : {}),
      })
      .where(
        and(
          eq(generationJobs.id, input.jobId),
          eq(generationJobs.status, "running"),
        ),
      );
  }

  async sumCostSince(since: Date): Promise<number> {
    const [row] = await this.database.client
      .select({ value: sum(generationJobs.costUsd) })
      .from(generationJobs)
      .where(
        and(
          gte(generationJobs.updatedAt, since),
          isNotNull(generationJobs.costUsd),
        ),
      );
    return Number(row?.value ?? 0);
  }

  async findForProcessing(
    jobId: string,
  ): Promise<GenerationJobWithProfile | null> {
    const [job] = await this.database.client
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.id, jobId))
      .limit(1);
    if (!job) return null;
    const [character] = await this.database.client
      .select()
      .from(characters)
      .where(eq(characters.id, job.characterId))
      .limit(1);
    const [profile, draft] = await Promise.all([
      this.database.client
        .select()
        .from(characterVisualProfiles)
        .where(eq(characterVisualProfiles.characterId, job.characterId))
        .limit(1)
        .then(([row]) => row ?? null),
      job.draftId
        ? this.database.client
            .select()
            .from(postDrafts)
            .where(eq(postDrafts.id, job.draftId))
            .limit(1)
            .then(([row]) => row ?? null)
        : null,
    ]);
    const referenceMedia = profile
      ? await this.database.client
          .select({
            mediaId: characterVisualProfileReferences.mediaId,
            media: {
              url: media.url,
              storageKey: media.storageKey,
              uploadedAt: media.uploadedAt,
            },
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
    const location = draft?.locationId
      ? await this.database.client
          .select()
          .from(characterLocations)
          .where(eq(characterLocations.id, draft.locationId))
          .limit(1)
          .then(([row]) => row ?? null)
      : null;
    const references = location
      ? await this.database.client
          .select({
            mediaId: characterLocationReferences.mediaId,
            media: {
              url: media.url,
              storageKey: media.storageKey,
              uploadedAt: media.uploadedAt,
            },
          })
          .from(characterLocationReferences)
          .innerJoin(media, eq(media.id, characterLocationReferences.mediaId))
          .where(eq(characterLocationReferences.locationId, location.id))
          .orderBy(asc(characterLocationReferences.sortOrder))
      : [];
    return {
      ...job,
      character: {
        ...character,
        visualProfile: profile ? { ...profile, referenceMedia } : null,
      },
      draft: draft
        ? { ...draft, location: location ? { ...location, references } : null }
        : null,
    };
  }

  async recordProviderSubmission(input: {
    jobId: string;
    providerRequestId: string;
    provider: string;
    paramsJson: unknown;
    sentPrompt?: string;
  }): Promise<void> {
    await this.database.client
      .update(generationJobs)
      .set({
        providerRequestId: input.providerRequestId,
        provider: input.provider,
        paramsJson: input.paramsJson,
        ...(input.sentPrompt?.trim() ? { prompt: input.sentPrompt } : {}),
      })
      .where(
        and(
          eq(generationJobs.id, input.jobId),
          eq(generationJobs.status, "running"),
        ),
      );
  }

  async recordProviderProgress(input: {
    jobId: string;
    progress: ImageGenerationProgress;
  }): Promise<void> {
    await this.database.client.execute(sql`
      update opod.generation_jobs
      set params_json = jsonb_set(coalesce(params_json, '{}'::jsonb), '{_providerProgress}', ${JSON.stringify(input.progress)}::jsonb, true),
          updated_at = now()
      where id = ${input.jobId}::uuid and status = 'running'
    `);
  }

  async extendLease(jobId: string, leaseSeconds: number): Promise<void> {
    await this.database.client
      .update(generationJobs)
      .set({ leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1000) })
      .where(
        and(eq(generationJobs.id, jobId), eq(generationJobs.status, "running")),
      );
  }

  async persistSuccess(input: {
    jobId: string;
    characterId: string;
    files: GeneratedFile[];
    costUsd: number;
    providerName: string;
  }): Promise<void> {
    await this.database.client.transaction(async (tx) => {
      const mediaRows = [] as Array<{ id: string }>;
      for (const file of input.files) {
        mediaRows.push(
          (
            await tx
              .insert(media)
              .values({
                mediaType: "image",
                url: file.url,
                storageKey: file.storageKey,
                contentType: file.contentType,
                byteSize: file.byteSize,
                width: file.image.width,
                height: file.image.height,
                isAiGenerated: true,
                uploadedAt: new Date(),
              })
              .returning({ id: media.id })
          )[0],
        );
      }
      const mediaIds = mediaRows.map((row) => row.id);
      const soleMediaId = mediaIds.length === 1 ? mediaIds[0] : null;
      const transitioned = await tx
        .update(generationJobs)
        .set({
          status: "completed",
          outputMediaId: soleMediaId,
          costUsd: input.costUsd.toString(),
          leaseExpiresAt: null,
          errorMessage: null,
        })
        .where(
          and(
            eq(generationJobs.id, input.jobId),
            eq(generationJobs.status, "running"),
          ),
        )
        .returning({ id: generationJobs.id });
      if (transitioned.length === 0)
        throw new Error("job left the running state during persistence");
      if (mediaIds.length > 0) {
        await tx.insert(generationJobOutputs).values(
          mediaIds.map((mediaId, candidateIndex) => ({
            jobId: input.jobId,
            mediaId,
            candidateIndex,
            selected: mediaId === soleMediaId,
          })),
        );
      }
      const [log] = await tx
        .select({ id: llmLogs.id })
        .from(llmLogs)
        .where(
          and(
            eq(llmLogs.type, LLM_LOG_TYPE.imageGenerate),
            eq(llmLogs.generationJobId, input.jobId),
          ),
        )
        .orderBy(desc(llmLogs.id))
        .limit(1);
      if (log && mediaIds.length > 0) {
        await tx
          .insert(llmLogMedia)
          .values(
            mediaIds.map((mediaId, sortOrder) => ({
              llmLogId: log.id,
              mediaId,
              role: "output" as const,
              sortOrder,
            })),
          )
          .onConflictDoNothing();
      }
      await tx.insert(characterActionLogs).values({
        characterId: input.characterId,
        actionType: "GENERATION_JOB_COMPLETED",
        targetTable: "generation_jobs",
        targetId: input.jobId,
        reason: `generation worker completed job via ${input.providerName}`,
      });
    });
  }

  async recordActionLog(input: {
    characterId: string;
    jobId: string;
    actionType: string;
    reason: string;
  }): Promise<void> {
    await this.database.client.insert(characterActionLogs).values({
      characterId: input.characterId,
      actionType: input.actionType,
      targetTable: "generation_jobs",
      targetId: input.jobId,
      reason: input.reason,
    });
  }
}
