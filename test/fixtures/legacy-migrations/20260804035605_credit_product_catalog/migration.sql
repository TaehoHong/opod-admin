/*
  Warnings:

  - Added the required column `credit_product_id` to the `credit_purchases` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "opod"."credit_purchases" ADD COLUMN     "credit_product_id" UUID NOT NULL;

-- CreateTable
CREATE TABLE "opod"."credit_products" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credit_amount" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "credit_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."payment_product_mappings" (
    "id" UUID NOT NULL,
    "credit_product_id" UUID NOT NULL,
    "channel" "opod"."payment_channel" NOT NULL,
    "provider" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "provider_product_id" TEXT NOT NULL,
    "price_amount" INTEGER,
    "currency" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_product_mappings_pkey" PRIMARY KEY ("id")
);

-- Seed the initial catalog. Production provider mappings are registered through
-- opod-admin after their external product IDs are issued.
INSERT INTO "opod"."credit_products"
    ("id", "code", "name", "credit_amount", "display_order", "updated_at")
VALUES
    ('019fca00-0000-7000-8000-000000000501', 'credits_500', '500 크레딧', 500, 10, CURRENT_TIMESTAMP),
    ('019fca00-0000-7000-8000-000000001050', 'credits_1050', '1,050 크레딧', 1050, 20, CURRENT_TIMESTAMP),
    ('019fca00-0000-7000-8000-000000003300', 'credits_3300', '3,300 크레딧', 3300, 30, CURRENT_TIMESTAMP),
    ('019fca00-0000-7000-8000-000000005750', 'credits_5750', '5,750 크레딧', 5750, 40, CURRENT_TIMESTAMP);

INSERT INTO "opod"."payment_product_mappings"
    ("id", "credit_product_id", "channel", "provider", "environment", "provider_product_id", "price_amount", "currency", "updated_at")
VALUES
    ('019fca00-0000-7000-8001-000000000501', '019fca00-0000-7000-8000-000000000501', 'web', 'local', 'development', 'credits_500', 4900, 'KRW', CURRENT_TIMESTAMP),
    ('019fca00-0000-7000-8001-000000001050', '019fca00-0000-7000-8000-000000001050', 'web', 'local', 'development', 'credits_1050', 9900, 'KRW', CURRENT_TIMESTAMP),
    ('019fca00-0000-7000-8001-000000003300', '019fca00-0000-7000-8000-000000003300', 'web', 'local', 'development', 'credits_3300', 29000, 'KRW', CURRENT_TIMESTAMP),
    ('019fca00-0000-7000-8001-000000005750', '019fca00-0000-7000-8000-000000005750', 'web', 'local', 'development', 'credits_5750', 49000, 'KRW', CURRENT_TIMESTAMP);

-- CreateIndex
CREATE UNIQUE INDEX "credit_products_code_key" ON "opod"."credit_products"("code");

-- CreateIndex
CREATE INDEX "credit_products_is_active_display_order_idx" ON "opod"."credit_products"("is_active", "display_order");

-- CreateIndex
CREATE INDEX "payment_product_mappings_channel_provider_environment_is_ac_idx" ON "opod"."payment_product_mappings"("channel", "provider", "environment", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "payment_product_mappings_credit_product_id_channel_provider_key" ON "opod"."payment_product_mappings"("credit_product_id", "channel", "provider", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "payment_product_mappings_provider_environment_provider_prod_key" ON "opod"."payment_product_mappings"("provider", "environment", "provider_product_id");

-- CreateIndex
CREATE INDEX "credit_purchases_credit_product_id_created_at_idx" ON "opod"."credit_purchases"("credit_product_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_provider_provider_transaction_id_idx" ON "opod"."payments"("provider", "provider_transaction_id");

-- CreateIndex
CREATE INDEX "payments_provider_status_created_at_idx" ON "opod"."payments"("provider", "status", "created_at");

-- AddForeignKey
ALTER TABLE "opod"."payment_product_mappings" ADD CONSTRAINT "payment_product_mappings_credit_product_id_fkey" FOREIGN KEY ("credit_product_id") REFERENCES "opod"."credit_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."credit_purchases" ADD CONSTRAINT "credit_purchases_credit_product_id_fkey" FOREIGN KEY ("credit_product_id") REFERENCES "opod"."credit_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
