-- AlterTable
ALTER TABLE "opod"."characters" ADD COLUMN     "profile_image_crop_x" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
ADD COLUMN     "profile_image_crop_y" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
ADD COLUMN     "profile_image_crop_zoom" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN     "profile_image_id" UUID;

-- CreateIndex
CREATE INDEX "characters_profile_image_id_idx" ON "opod"."characters"("profile_image_id");

-- AddForeignKey
ALTER TABLE "opod"."characters" ADD CONSTRAINT "characters_profile_image_id_fkey" FOREIGN KEY ("profile_image_id") REFERENCES "opod"."media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
