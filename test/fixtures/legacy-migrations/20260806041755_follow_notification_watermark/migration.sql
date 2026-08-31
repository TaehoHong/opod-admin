-- AlterTable
ALTER TABLE "opod"."user_character_follows" ADD COLUMN     "notified_up_to_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
