-- Promote the relationship identity out of payload_json so the agent worker
-- can serialize execution per (user, character) and withdrawal cleanup can
-- target a user's jobs. Backfill from the payload for any pre-existing rows.

-- AlterTable (nullable first; NOT NULL after backfill)
ALTER TABLE "opod"."agent_memory_jobs" ADD COLUMN "character_id" TEXT,
ADD COLUMN "user_id" TEXT;

-- Backfill from the job payload (ConsolidationRequest carries both ids).
UPDATE "opod"."agent_memory_jobs"
SET "user_id" = "payload_json"->>'userId',
    "character_id" = "payload_json"->>'characterId'
WHERE "user_id" IS NULL OR "character_id" IS NULL;

ALTER TABLE "opod"."agent_memory_jobs" ALTER COLUMN "user_id" SET NOT NULL,
ALTER COLUMN "character_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "agent_memory_jobs_user_id_character_id_status_idx" ON "opod"."agent_memory_jobs"("user_id", "character_id", "status");
