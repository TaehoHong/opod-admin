-- CreateTable
CREATE TABLE "opod"."console_logs" (
    "id" BIGSERIAL NOT NULL,
    "admin_id" UUID,
    "admin_email" TEXT,
    "action_type" TEXT NOT NULL,
    "target" TEXT,
    "summary" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "console_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."service_logs" (
    "id" BIGSERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "event_type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context_json" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "console_logs_created_at_idx" ON "opod"."console_logs"("created_at");

-- CreateIndex
CREATE INDEX "console_logs_action_type_created_at_idx" ON "opod"."console_logs"("action_type", "created_at");

-- CreateIndex
CREATE INDEX "service_logs_created_at_idx" ON "opod"."service_logs"("created_at");

-- CreateIndex
CREATE INDEX "service_logs_event_type_created_at_idx" ON "opod"."service_logs"("event_type", "created_at");
