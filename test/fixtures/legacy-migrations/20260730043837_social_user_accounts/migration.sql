-- CreateTable
CREATE TABLE "opod"."user_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "email" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_accounts_user_id_idx" ON "opod"."user_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_accounts_provider_provider_account_id_key" ON "opod"."user_accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_accounts_user_id_provider_key" ON "opod"."user_accounts"("user_id", "provider");

-- AddForeignKey
ALTER TABLE "opod"."user_accounts" ADD CONSTRAINT "user_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
