-- CreateEnum
CREATE TYPE "opod"."draft_evaluation_kind" AS ENUM ('plan', 'prompt');

-- CreateEnum
CREATE TYPE "opod"."draft_evaluation_status" AS ENUM ('pending', 'completed', 'failed');

-- AlterTable
ALTER TABLE "opod"."characters" ADD COLUMN     "content_language" TEXT NOT NULL DEFAULT 'ko';

-- CreateTable
CREATE TABLE "opod"."draft_evaluations" (
    "id" UUID NOT NULL,
    "draft_id" UUID NOT NULL,
    "kind" "opod"."draft_evaluation_kind" NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" "opod"."draft_evaluation_status" NOT NULL DEFAULT 'pending',
    "lease_expires_at" TIMESTAMPTZ(6),
    "evaluator_name" TEXT,
    "rubric_version" TEXT NOT NULL,
    "content_language" TEXT NOT NULL DEFAULT 'ko',
    "overall_score" DOUBLE PRECISION,
    "scores_json" JSONB,
    "issues_json" JSONB,
    "suggestions_json" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "draft_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."evaluation_reports" (
    "id" UUID NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "rubric_version" TEXT NOT NULL,
    "summary_json" JSONB NOT NULL,
    "failure_patterns_json" JSONB,
    "prompt_suggestions_json" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "draft_evaluations_status_lease_expires_at_idx" ON "opod"."draft_evaluations"("status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "draft_evaluations_kind_created_at_idx" ON "opod"."draft_evaluations"("kind", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "draft_evaluations_draft_id_kind_attempt_key" ON "opod"."draft_evaluations"("draft_id", "kind", "attempt");

-- CreateIndex
CREATE INDEX "evaluation_reports_created_at_idx" ON "opod"."evaluation_reports"("created_at");

-- AddForeignKey
ALTER TABLE "opod"."draft_evaluations" ADD CONSTRAINT "draft_evaluations_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "opod"."post_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
