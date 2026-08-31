-- CreateEnum
CREATE TYPE "opod"."llm_log_status" AS ENUM ('running', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "opod"."llm_log_media_role" AS ENUM ('input', 'output');

-- CreateTable
CREATE TABLE "opod"."llm_logs" (
    "id" BIGSERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "opod"."llm_log_status" NOT NULL DEFAULT 'running',
    "endpoint" TEXT,
    "is_streaming" BOOLEAN NOT NULL DEFAULT false,
    "request_id" TEXT,
    "provider_request_id" TEXT,
    "user_id" TEXT,
    "character_id" TEXT,
    "generation_job_id" UUID,
    "system_prompt_json" JSONB,
    "user_prompt_json" JSONB,
    "request_json" JSONB NOT NULL,
    "response_json" JSONB,
    "metadata_json" JSONB,
    "redacted_paths" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "http_status" INTEGER,
    "error_type" TEXT,
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "total_tokens" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "llm_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."llm_log_media" (
    "llm_log_id" BIGINT NOT NULL,
    "media_id" UUID NOT NULL,
    "role" "opod"."llm_log_media_role" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "llm_log_media_pkey" PRIMARY KEY ("llm_log_id", "role", "media_id")
);

-- CreateIndex
CREATE INDEX "llm_logs_created_at_idx" ON "opod"."llm_logs"("created_at");

-- CreateIndex
CREATE INDEX "llm_logs_status_created_at_idx" ON "opod"."llm_logs"("status", "created_at");

-- CreateIndex
CREATE INDEX "llm_logs_type_created_at_idx" ON "opod"."llm_logs"("type", "created_at");

-- CreateIndex
CREATE INDEX "llm_logs_request_id_idx" ON "opod"."llm_logs"("request_id");

-- CreateIndex
CREATE INDEX "llm_logs_provider_request_id_idx" ON "opod"."llm_logs"("provider_request_id");

-- CreateIndex
CREATE INDEX "llm_logs_generation_job_id_idx" ON "opod"."llm_logs"("generation_job_id");

-- CreateIndex
CREATE INDEX "llm_logs_user_id_created_at_idx" ON "opod"."llm_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "llm_logs_character_id_created_at_idx" ON "opod"."llm_logs"("character_id", "created_at");

-- CreateIndex
CREATE INDEX "llm_log_media_media_id_idx" ON "opod"."llm_log_media"("media_id");

-- AddForeignKey
ALTER TABLE "opod"."llm_logs" ADD CONSTRAINT "llm_logs_generation_job_id_fkey" FOREIGN KEY ("generation_job_id") REFERENCES "opod"."generation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."llm_log_media" ADD CONSTRAINT "llm_log_media_llm_log_id_fkey" FOREIGN KEY ("llm_log_id") REFERENCES "opod"."llm_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."llm_log_media" ADD CONSTRAINT "llm_log_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "opod"."media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
