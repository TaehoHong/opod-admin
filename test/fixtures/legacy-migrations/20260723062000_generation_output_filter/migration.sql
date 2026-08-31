ALTER TABLE "opod"."generation_job_outputs"
ADD COLUMN "filter_preset" TEXT;

ALTER TABLE "opod"."generation_job_outputs"
ADD CONSTRAINT "generation_job_outputs_filter_preset_check"
CHECK ("filter_preset" IS NULL OR "filter_preset" IN ('none', 'film', 'mono-film'));
