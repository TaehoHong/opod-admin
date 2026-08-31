-- AlterTable
ALTER TABLE "opod"."message_conversations" ADD COLUMN     "last_message_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
