-- CreateTable
CREATE TABLE "opod"."character_locations" (
    "id" UUID NOT NULL,
    "character_id" UUID,
    "location_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "visual_prompt" TEXT NOT NULL,
    "negative_prompt" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "character_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."character_location_references" (
    "location_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "character_location_references_pkey" PRIMARY KEY ("location_id", "media_id")
);

-- AlterTable
ALTER TABLE "opod"."post_drafts" ADD COLUMN "location_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "character_locations_character_id_location_key_key"
ON "opod"."character_locations"("character_id", "location_key");

-- PostgreSQL considers NULL values distinct in a regular unique index, so a
-- partial index separately protects the global-location namespace.
CREATE UNIQUE INDEX "character_locations_global_location_key_key"
ON "opod"."character_locations"("location_key")
WHERE "character_id" IS NULL;

-- CreateIndex
CREATE INDEX "character_locations_character_id_deleted_at_created_at_idx"
ON "opod"."character_locations"("character_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "character_location_references_location_id_sort_order_idx"
ON "opod"."character_location_references"("location_id", "sort_order");

-- CreateIndex
CREATE INDEX "post_drafts_location_id_created_at_idx"
ON "opod"."post_drafts"("location_id", "created_at");

-- AddForeignKey
ALTER TABLE "opod"."character_locations"
ADD CONSTRAINT "character_locations_character_id_fkey"
FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."character_location_references"
ADD CONSTRAINT "character_location_references_location_id_fkey"
FOREIGN KEY ("location_id") REFERENCES "opod"."character_locations"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."character_location_references"
ADD CONSTRAINT "character_location_references_media_id_fkey"
FOREIGN KEY ("media_id") REFERENCES "opod"."media"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."post_drafts"
ADD CONSTRAINT "post_drafts_location_id_fkey"
FOREIGN KEY ("location_id") REFERENCES "opod"."character_locations"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
