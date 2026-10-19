import { sql } from "drizzle-orm";
import { generationJobs, postDrafts } from "../core/database/schema";

// Reference jobs may run only after the draft CAS has accepted this exact build.
export const activeReferenceDraftJob = sql`exists (
  select 1 from ${postDrafts} where ${postDrafts.id} = ${generationJobs.draftId}
  and ${postDrafts.conceptJson}->>'postGenerationAgent' = 'reference-v1'
  and ${postDrafts.status} in ('generating', 'regenerating', 'failed')
  and ${postDrafts.leaseExpiresAt} is null
  and ${postDrafts.conceptJson}#>>'{pipeline,stage}' = 'generation'
  and coalesce(${postDrafts.conceptJson}->'generationBuild'->'jobIds', '[]'::jsonb) ? ${generationJobs.id}::text
  and ${postDrafts.conceptJson}->'generationBuild'->>'promptRevision' = ${generationJobs.paramsJson}->'_referenceAgent'->>'promptRevision'
)`;

// Run this as a separate statement inside the mutation transaction. The following
// statement must obtain a fresh READ COMMITTED snapshot after acquiring the lock.
export function referenceJobExecutionLock(jobId: string) {
  return sql`select coalesce(pg_try_advisory_xact_lock(hashtextextended('reference-execute:' || ${generationJobs.draftId}::text, 0)), false) as locked
    from ${generationJobs} where ${generationJobs.id} = ${jobId}
    and ${generationJobs.paramsJson}->'_referenceAgent' is not null`;
}
