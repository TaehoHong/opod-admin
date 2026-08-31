ALTER TABLE "opod"."llm_logs"
  ADD COLUMN "response_model" TEXT,
  ADD COLUMN "usage_json" JSONB,
  ADD COLUMN "finish_reason" TEXT,
  ADD COLUMN "time_to_first_token_ms" INTEGER,
  ADD COLUMN "cached_input_tokens" INTEGER,
  ADD COLUMN "cache_write_tokens" INTEGER,
  ADD COLUMN "reasoning_tokens" INTEGER,
  ADD COLUMN "cost" DECIMAL(20, 10),
  ADD COLUMN "upstream_cost" DECIMAL(20, 10);
