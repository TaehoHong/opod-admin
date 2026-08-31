-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "opod";

-- CreateEnum
CREATE TYPE "opod"."media_type" AS ENUM ('image', 'video');

-- CreateEnum
CREATE TYPE "opod"."post_content_type" AS ENUM ('feed', 'reel');

-- CreateEnum
CREATE TYPE "opod"."message_sender_type" AS ENUM ('user', 'character');

-- CreateEnum
CREATE TYPE "opod"."credit_entry_type" AS ENUM ('grant', 'debit');

-- CreateEnum
CREATE TYPE "opod"."credit_purchase_status" AS ENUM ('pending', 'paid', 'failed', 'canceled', 'refunded');

-- CreateEnum
CREATE TYPE "opod"."credit_reservation_status" AS ENUM ('reserved', 'captured', 'released');

-- CreateEnum
CREATE TYPE "opod"."generation_job_status" AS ENUM ('draft', 'queued', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "opod"."post_draft_status" AS ENUM ('planned', 'generating', 'needs_review', 'regenerating', 'approved', 'rejected', 'published', 'failed');

-- CreateEnum
CREATE TYPE "opod"."post_draft_type" AS ENUM ('post', 'story');

-- CreateEnum
CREATE TYPE "opod"."report_target_type" AS ENUM ('character', 'post', 'message');

-- CreateEnum
CREATE TYPE "opod"."report_status" AS ENUM ('submitted', 'reviewing', 'resolved', 'rejected');

-- CreateEnum
CREATE TYPE "opod"."character_status" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "opod"."inquiry_status" AS ENUM ('submitted', 'answered');

-- CreateTable
CREATE TABLE "opod"."users" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "password_hash" TEXT,
    "password_salt" TEXT,
    "display_name" TEXT NOT NULL,
    "bio" TEXT NOT NULL DEFAULT '',
    "profile_image_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."user_refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."user_withdrawals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason_category" TEXT,
    "reason_text" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."faqs" (
    "id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."notices" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."inquiries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "opod"."inquiry_status" NOT NULL DEFAULT 'submitted',
    "answer_body" TEXT,
    "answered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."admin_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "admin_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "opod"."admins" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."characters" (
    "id" UUID NOT NULL,
    "public_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "bio" TEXT NOT NULL,
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "opod"."character_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."user_character_follows" (
    "user_id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_character_follows_pkey" PRIMARY KEY ("user_id","character_id")
);

-- CreateTable
CREATE TABLE "opod"."media" (
    "id" UUID NOT NULL,
    "media_type" "opod"."media_type" NOT NULL,
    "url" TEXT NOT NULL,
    "storage_key" TEXT,
    "content_type" TEXT,
    "byte_size" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "duration_seconds" INTEGER,
    "is_ai_generated" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."posts" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "content_type" "opod"."post_content_type" NOT NULL DEFAULT 'feed',
    "content" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."hashtags" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "hashtags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."post_hashtags" (
    "post_id" UUID NOT NULL,
    "hashtag_id" UUID NOT NULL,

    CONSTRAINT "post_hashtags_pkey" PRIMARY KEY ("post_id","hashtag_id")
);

-- CreateTable
CREATE TABLE "opod"."post_media" (
    "post_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "post_media_pkey" PRIMARY KEY ("post_id","media_id")
);

-- CreateTable
CREATE TABLE "opod"."stories" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."post_comments" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "character_id" UUID,
    "user_id" UUID,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."post_reactions" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "character_id" UUID,
    "user_id" UUID,
    "reaction_type" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."user_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."user_hashtag_preferences" (
    "user_id" UUID NOT NULL,
    "hashtag_id" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_hashtag_preferences_pkey" PRIMARY KEY ("user_id","hashtag_id")
);

-- CreateTable
CREATE TABLE "opod"."notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "target_type" TEXT,
    "target_id" UUID,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."message_conversations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_type" "opod"."message_sender_type" NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."credit_ledger_entries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "entry_type" "opod"."credit_entry_type" NOT NULL,
    "amount" INTEGER NOT NULL,
    "remaining_amount" INTEGER,
    "expires_at" TIMESTAMPTZ(6),
    "reason" TEXT NOT NULL,
    "external_reference" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."credit_purchases" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "opod"."credit_purchase_status" NOT NULL DEFAULT 'pending',
    "credit_amount" INTEGER NOT NULL,
    "paid_amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "credit_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."credit_reservations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "action_type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "opod"."credit_reservation_status" NOT NULL DEFAULT 'reserved',
    "reference" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "credit_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."credit_check_ins" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "check_in_date" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."generation_jobs" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "media_type" "opod"."media_type" NOT NULL,
    "prompt" TEXT NOT NULL,
    "input_prompt" TEXT,
    "candidate_count" INTEGER,
    "status" "opod"."generation_job_status" NOT NULL DEFAULT 'queued',
    "output_media_id" UUID,
    "provider" TEXT,
    "params_json" JSONB,
    "provider_request_id" TEXT,
    "lease_expires_at" TIMESTAMPTZ(6),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "origin_job_id" UUID,
    "error_message" TEXT,
    "cost_usd" DECIMAL(10,4),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "draft_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."post_drafts" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "draft_type" "opod"."post_draft_type" NOT NULL DEFAULT 'post',
    "content_type" "opod"."post_content_type" NOT NULL DEFAULT 'feed',
    "caption" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "concept_json" JSONB,
    "status" "opod"."post_draft_status" NOT NULL DEFAULT 'planned',
    "error_message" TEXT,
    "lease_expires_at" TIMESTAMPTZ(6),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "scheduled_at" TIMESTAMPTZ(6),
    "published_post_id" UUID,
    "published_story_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "post_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."character_posting_policies" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "weekly_cadence" INTEGER NOT NULL DEFAULT 3,
    "hour_start_kst" INTEGER NOT NULL DEFAULT 18,
    "hour_end_kst" INTEGER NOT NULL DEFAULT 22,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "character_posting_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."generation_job_outputs" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "candidate_index" INTEGER NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_job_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."character_visual_profiles" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "appearance_prompt" TEXT NOT NULL DEFAULT '',
    "style_prompt" TEXT NOT NULL DEFAULT '',
    "negative_prompt" TEXT NOT NULL DEFAULT '',
    "provider_config" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "character_visual_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."character_visual_profile_references" (
    "profile_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "character_visual_profile_references_pkey" PRIMARY KEY ("profile_id","media_id")
);

-- CreateTable
CREATE TABLE "opod"."character_action_logs" (
    "id" BIGSERIAL NOT NULL,
    "character_id" UUID NOT NULL,
    "action_type" TEXT NOT NULL,
    "target_table" TEXT,
    "target_id" UUID,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."reports" (
    "id" UUID NOT NULL,
    "reporter_user_id" UUID NOT NULL,
    "target_type" "opod"."report_target_type" NOT NULL,
    "target_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "resolution" TEXT,
    "status" "opod"."report_status" NOT NULL DEFAULT 'submitted',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."character_memories" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "character_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."character_personas" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "character_personas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "opod"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_refresh_tokens_token_hash_key" ON "opod"."user_refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "user_refresh_tokens_user_id_created_at_idx" ON "opod"."user_refresh_tokens"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "faqs_is_published_category_sort_order_idx" ON "opod"."faqs"("is_published", "category", "sort_order");

-- CreateIndex
CREATE INDEX "notices_is_pinned_published_at_idx" ON "opod"."notices"("is_pinned", "published_at");

-- CreateIndex
CREATE INDEX "inquiries_user_id_created_at_idx" ON "opod"."inquiries"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "inquiries_status_created_at_idx" ON "opod"."inquiries"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "opod"."admins"("email");

-- CreateIndex
CREATE INDEX "admins_is_enabled_is_deleted_idx" ON "opod"."admins"("is_enabled", "is_deleted");

-- CreateIndex
CREATE UNIQUE INDEX "characters_public_id_key" ON "opod"."characters"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_storage_key_key" ON "opod"."media"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "hashtags_name_key" ON "opod"."hashtags"("name");

-- CreateIndex
CREATE INDEX "post_hashtags_hashtag_id_idx" ON "opod"."post_hashtags"("hashtag_id");

-- CreateIndex
CREATE INDEX "stories_expires_at_created_at_idx" ON "opod"."stories"("expires_at", "created_at");

-- CreateIndex
CREATE INDEX "stories_character_id_expires_at_created_at_idx" ON "opod"."stories"("character_id", "expires_at", "created_at");

-- CreateIndex
CREATE INDEX "post_comments_post_id_created_at_idx" ON "opod"."post_comments"("post_id", "created_at");

-- CreateIndex
CREATE INDEX "post_comments_character_id_created_at_idx" ON "opod"."post_comments"("character_id", "created_at");

-- CreateIndex
CREATE INDEX "post_comments_user_id_created_at_idx" ON "opod"."post_comments"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "post_reactions_post_id_created_at_idx" ON "opod"."post_reactions"("post_id", "created_at");

-- CreateIndex
CREATE INDEX "post_reactions_character_id_created_at_idx" ON "opod"."post_reactions"("character_id", "created_at");

-- CreateIndex
CREATE INDEX "post_reactions_user_id_created_at_idx" ON "opod"."post_reactions"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "post_reactions_post_id_user_id_reaction_type_key" ON "opod"."post_reactions"("post_id", "user_id", "reaction_type");

-- CreateIndex
CREATE INDEX "user_events_user_id_created_at_idx" ON "opod"."user_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "user_events_target_type_target_id_idx" ON "opod"."user_events"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "user_hashtag_preferences_hashtag_id_idx" ON "opod"."user_hashtag_preferences"("hashtag_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "opod"."notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "opod"."notifications"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "message_conversations_user_id_character_id_key" ON "opod"."message_conversations"("user_id", "character_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "opod"."messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "credit_ledger_entries_user_id_created_at_idx" ON "opod"."credit_ledger_entries"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "credit_ledger_entries_user_id_entry_type_expires_at_idx" ON "opod"."credit_ledger_entries"("user_id", "entry_type", "expires_at");

-- CreateIndex
CREATE INDEX "credit_purchases_user_id_created_at_idx" ON "opod"."credit_purchases"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "credit_reservations_reference_key" ON "opod"."credit_reservations"("reference");

-- CreateIndex
CREATE INDEX "credit_reservations_user_id_status_expires_at_idx" ON "opod"."credit_reservations"("user_id", "status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "credit_check_ins_user_id_check_in_date_key" ON "opod"."credit_check_ins"("user_id", "check_in_date");

-- CreateIndex
CREATE INDEX "generation_jobs_status_created_at_idx" ON "opod"."generation_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "generation_jobs_status_lease_expires_at_idx" ON "opod"."generation_jobs"("status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "generation_jobs_draft_id_idx" ON "opod"."generation_jobs"("draft_id");

-- CreateIndex
CREATE INDEX "post_drafts_status_scheduled_at_idx" ON "opod"."post_drafts"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "post_drafts_status_lease_expires_at_idx" ON "opod"."post_drafts"("status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "post_drafts_character_id_created_at_idx" ON "opod"."post_drafts"("character_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "character_posting_policies_character_id_key" ON "opod"."character_posting_policies"("character_id");

-- CreateIndex
CREATE INDEX "generation_job_outputs_media_id_idx" ON "opod"."generation_job_outputs"("media_id");

-- CreateIndex
CREATE UNIQUE INDEX "generation_job_outputs_job_id_candidate_index_key" ON "opod"."generation_job_outputs"("job_id", "candidate_index");

-- CreateIndex
CREATE UNIQUE INDEX "character_visual_profiles_character_id_key" ON "opod"."character_visual_profiles"("character_id");

-- CreateIndex
CREATE INDEX "character_action_logs_character_id_created_at_idx" ON "opod"."character_action_logs"("character_id", "created_at");

-- CreateIndex
CREATE INDEX "reports_status_created_at_idx" ON "opod"."reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "reports_target_type_target_id_idx" ON "opod"."reports"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "character_memories_character_id_deleted_at_created_at_idx" ON "opod"."character_memories"("character_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "character_personas_character_id_deleted_at_sort_order_idx" ON "opod"."character_personas"("character_id", "deleted_at", "sort_order");

-- AddForeignKey
ALTER TABLE "opod"."user_refresh_tokens" ADD CONSTRAINT "user_refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."inquiries" ADD CONSTRAINT "inquiries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."user_character_follows" ADD CONSTRAINT "user_character_follows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."user_character_follows" ADD CONSTRAINT "user_character_follows_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."posts" ADD CONSTRAINT "posts_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."post_hashtags" ADD CONSTRAINT "post_hashtags_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "opod"."posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."post_hashtags" ADD CONSTRAINT "post_hashtags_hashtag_id_fkey" FOREIGN KEY ("hashtag_id") REFERENCES "opod"."hashtags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."post_media" ADD CONSTRAINT "post_media_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "opod"."posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."post_media" ADD CONSTRAINT "post_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "opod"."media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."stories" ADD CONSTRAINT "stories_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."stories" ADD CONSTRAINT "stories_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "opod"."media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."post_comments" ADD CONSTRAINT "post_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "opod"."posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."post_comments" ADD CONSTRAINT "post_comments_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."post_comments" ADD CONSTRAINT "post_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."post_reactions" ADD CONSTRAINT "post_reactions_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "opod"."posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."post_reactions" ADD CONSTRAINT "post_reactions_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."post_reactions" ADD CONSTRAINT "post_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."user_events" ADD CONSTRAINT "user_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."user_hashtag_preferences" ADD CONSTRAINT "user_hashtag_preferences_hashtag_id_fkey" FOREIGN KEY ("hashtag_id") REFERENCES "opod"."hashtags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."user_hashtag_preferences" ADD CONSTRAINT "user_hashtag_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."message_conversations" ADD CONSTRAINT "message_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."message_conversations" ADD CONSTRAINT "message_conversations_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "opod"."message_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."credit_purchases" ADD CONSTRAINT "credit_purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."credit_reservations" ADD CONSTRAINT "credit_reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."credit_check_ins" ADD CONSTRAINT "credit_check_ins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."generation_jobs" ADD CONSTRAINT "generation_jobs_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."generation_jobs" ADD CONSTRAINT "generation_jobs_output_media_id_fkey" FOREIGN KEY ("output_media_id") REFERENCES "opod"."media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."generation_jobs" ADD CONSTRAINT "generation_jobs_origin_job_id_fkey" FOREIGN KEY ("origin_job_id") REFERENCES "opod"."generation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."generation_jobs" ADD CONSTRAINT "generation_jobs_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "opod"."post_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."post_drafts" ADD CONSTRAINT "post_drafts_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."post_drafts" ADD CONSTRAINT "post_drafts_published_post_id_fkey" FOREIGN KEY ("published_post_id") REFERENCES "opod"."posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."post_drafts" ADD CONSTRAINT "post_drafts_published_story_id_fkey" FOREIGN KEY ("published_story_id") REFERENCES "opod"."stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."character_posting_policies" ADD CONSTRAINT "character_posting_policies_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."generation_job_outputs" ADD CONSTRAINT "generation_job_outputs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "opod"."generation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."generation_job_outputs" ADD CONSTRAINT "generation_job_outputs_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "opod"."media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."character_visual_profiles" ADD CONSTRAINT "character_visual_profiles_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."character_visual_profile_references" ADD CONSTRAINT "character_visual_profile_references_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "opod"."character_visual_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."character_visual_profile_references" ADD CONSTRAINT "character_visual_profile_references_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "opod"."media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."character_action_logs" ADD CONSTRAINT "character_action_logs_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."reports" ADD CONSTRAINT "reports_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "opod"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."character_memories" ADD CONSTRAINT "character_memories_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."character_personas" ADD CONSTRAINT "character_personas_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
