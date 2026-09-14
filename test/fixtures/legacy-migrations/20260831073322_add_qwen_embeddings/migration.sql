CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

ALTER TABLE "opod"."character_location_references"
  ADD COLUMN "embedding" vector(1024),
  ADD COLUMN "embedding_model" text,
  ADD COLUMN "embedded_at" timestamp(6) with time zone;

ALTER TABLE "opod"."character_memories"
  ADD COLUMN "embedding" vector(1024),
  ADD COLUMN "embedding_model" text,
  ADD COLUMN "embedded_at" timestamp(6) with time zone;

ALTER TABLE "opod"."character_visual_profile_references"
  ADD COLUMN "embedding" vector(1024),
  ADD COLUMN "embedding_model" text,
  ADD COLUMN "embedded_at" timestamp(6) with time zone;
