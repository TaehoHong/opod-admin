-- CreateEnum
CREATE TYPE "opod"."agent_memory_kind" AS ENUM ('observation', 'reflection');

-- CreateEnum
CREATE TYPE "opod"."agent_job_status" AS ENUM ('queued', 'running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "opod"."agent_archival_memories" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "kind" "opod"."agent_memory_kind" NOT NULL,
    "importance" DOUBLE PRECISION NOT NULL,
    "embedding" DOUBLE PRECISION[],
    "evidence" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "operation_key" TEXT,
    "ordinal" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_accessed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_archival_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."agent_core_memories" (
    "user_id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agent_core_memories_pkey" PRIMARY KEY ("user_id","character_id")
);

-- CreateTable
CREATE TABLE "opod"."agent_relationship_state" (
    "user_id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "importance_since_reflection" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agent_relationship_state_pkey" PRIMARY KEY ("user_id","character_id")
);

-- CreateTable
CREATE TABLE "opod"."agent_summaries" (
    "user_id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "turns_covered" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agent_summaries_pkey" PRIMARY KEY ("user_id","character_id","session_id")
);

-- CreateTable
CREATE TABLE "opod"."agent_memory_operations" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "operation_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_memory_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."agent_memory_jobs" (
    "id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "status" "opod"."agent_job_status" NOT NULL DEFAULT 'queued',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "lease_expires_at" TIMESTAMPTZ(6),
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agent_memory_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_archival_memories_user_id_character_id_last_accessed__idx" ON "opod"."agent_archival_memories"("user_id", "character_id", "last_accessed_at");

-- CreateIndex
CREATE INDEX "agent_archival_memories_user_id_character_id_kind_created_a_idx" ON "opod"."agent_archival_memories"("user_id", "character_id", "kind", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_archival_memories_user_id_character_id_operation_key__key" ON "opod"."agent_archival_memories"("user_id", "character_id", "operation_key", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "agent_memory_operations_user_id_character_id_operation_key_key" ON "opod"."agent_memory_operations"("user_id", "character_id", "operation_key");

-- CreateIndex
CREATE UNIQUE INDEX "agent_memory_jobs_idempotency_key_key" ON "opod"."agent_memory_jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "agent_memory_jobs_status_lease_expires_at_idx" ON "opod"."agent_memory_jobs"("status", "lease_expires_at");
