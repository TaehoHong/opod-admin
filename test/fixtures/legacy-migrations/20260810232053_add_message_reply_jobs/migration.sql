-- CreateEnum
CREATE TYPE "opod"."message_reply_job_status" AS ENUM ('queued', 'running', 'completed', 'failed');

-- AlterTable
ALTER TABLE "opod"."credit_reservations" ALTER COLUMN "expires_at" DROP NOT NULL;

-- AlterTable
ALTER TABLE "opod"."messages" ADD COLUMN     "reply_job_id" UUID;

-- CreateTable
CREATE TABLE "opod"."message_reply_jobs" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "turn_id" UUID NOT NULL,
    "status" "opod"."message_reply_job_status" NOT NULL DEFAULT 'queued',
    "reservation_reference" TEXT,
    "ready_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "lease_expires_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "deadline_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "message_reply_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_reply_jobs_turn_id_key" ON "opod"."message_reply_jobs"("turn_id");

-- CreateIndex
CREATE INDEX "message_reply_jobs_status_ready_at_idx" ON "opod"."message_reply_jobs"("status", "ready_at");

-- CreateIndex
CREATE INDEX "message_reply_jobs_conversation_id_status_idx" ON "opod"."message_reply_jobs"("conversation_id", "status");

-- CreateIndex
CREATE INDEX "message_reply_jobs_status_lease_expires_at_idx" ON "opod"."message_reply_jobs"("status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "messages_reply_job_id_idx" ON "opod"."messages"("reply_job_id");

-- AddForeignKey
ALTER TABLE "opod"."messages" ADD CONSTRAINT "messages_reply_job_id_fkey" FOREIGN KEY ("reply_job_id") REFERENCES "opod"."message_reply_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."message_reply_jobs" ADD CONSTRAINT "message_reply_jobs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "opod"."message_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
