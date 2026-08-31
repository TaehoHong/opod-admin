/*
  Warnings:

  - The values [paid] on the enum `credit_purchase_status` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `currency` on the `credit_purchases` table. All the data in the column will be lost.
  - You are about to drop the column `paid_amount` on the `credit_purchases` table. All the data in the column will be lost.
  - You are about to drop the column `provider` on the `credit_purchases` table. All the data in the column will be lost.
  - You are about to drop the `credit_accounts` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `credit_ledger_entries` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `credit_reconciliation_actions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `credit_refund_allocations` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `credit_refunds` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[user_id,idempotency_key]` on the table `credit_purchases` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `idempotency_key` to the `credit_purchases` table without a default value. This is not possible if the table is not empty.
  - Added the required column `product_id` to the `credit_purchases` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "opod"."credit_ledger_type" AS ENUM ('grant', 'usage', 'refund_recovery', 'adjustment');

-- CreateEnum
CREATE TYPE "opod"."credit_refund_state" AS ENUM ('reserved', 'payment_processing', 'payment_succeeded', 'completed', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "opod"."payment_channel" AS ENUM ('web', 'apple', 'google');

-- CreateEnum
CREATE TYPE "opod"."payment_status" AS ENUM ('pending', 'verified', 'processing', 'paid', 'failed', 'canceled', 'partially_refunded', 'refunded', 'reversed');

-- CreateEnum
CREATE TYPE "opod"."payment_ledger_type" AS ENUM ('capture', 'refund', 'chargeback', 'adjustment');

-- CreateEnum
CREATE TYPE "opod"."payment_direction" AS ENUM ('inflow', 'outflow');

-- CreateEnum
CREATE TYPE "opod"."payment_provider_event_status" AS ENUM ('processing', 'processed', 'failed');

-- AlterEnum
BEGIN;
CREATE TYPE "opod"."credit_purchase_status_new" AS ENUM ('pending', 'payment_processing', 'completed', 'failed', 'canceled', 'refunded', 'reversed');
ALTER TABLE "opod"."credit_purchases" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "opod"."credit_purchases" ALTER COLUMN "status" TYPE "opod"."credit_purchase_status_new" USING ("status"::text::"opod"."credit_purchase_status_new");
ALTER TYPE "opod"."credit_purchase_status" RENAME TO "credit_purchase_status_old";
ALTER TYPE "opod"."credit_purchase_status_new" RENAME TO "credit_purchase_status";
DROP TYPE "opod"."credit_purchase_status_old";
ALTER TABLE "opod"."credit_purchases" ALTER COLUMN "status" SET DEFAULT 'pending';
COMMIT;

-- DropForeignKey
ALTER TABLE "opod"."credit_accounts" DROP CONSTRAINT "credit_accounts_user_id_fkey";

-- DropForeignKey
ALTER TABLE "opod"."credit_ledger_entries" DROP CONSTRAINT "credit_ledger_entries_purchase_id_fkey";

-- DropForeignKey
ALTER TABLE "opod"."credit_ledger_entries" DROP CONSTRAINT "credit_ledger_entries_user_id_fkey";

-- DropForeignKey
ALTER TABLE "opod"."credit_reconciliation_actions" DROP CONSTRAINT "credit_reconciliation_actions_admin_id_fkey";

-- DropForeignKey
ALTER TABLE "opod"."credit_reconciliation_actions" DROP CONSTRAINT "credit_reconciliation_actions_purchase_id_fkey";

-- DropForeignKey
ALTER TABLE "opod"."credit_refund_allocations" DROP CONSTRAINT "credit_refund_allocations_ledger_entry_id_fkey";

-- DropForeignKey
ALTER TABLE "opod"."credit_refund_allocations" DROP CONSTRAINT "credit_refund_allocations_refund_id_fkey";

-- DropForeignKey
ALTER TABLE "opod"."credit_refunds" DROP CONSTRAINT "credit_refunds_purchase_id_fkey";

-- DropForeignKey
ALTER TABLE "opod"."credit_refunds" DROP CONSTRAINT "credit_refunds_user_id_fkey";

-- AlterTable
ALTER TABLE "opod"."credit_purchases" DROP COLUMN "currency",
DROP COLUMN "paid_amount",
DROP COLUMN "provider",
ADD COLUMN     "fulfilled_at" TIMESTAMPTZ(6),
ADD COLUMN     "idempotency_key" TEXT NOT NULL,
ADD COLUMN     "product_id" TEXT NOT NULL;

-- DropTable
DROP TABLE "opod"."credit_accounts";

-- DropTable
DROP TABLE "opod"."credit_ledger_entries";

-- DropTable
DROP TABLE "opod"."credit_reconciliation_actions";

-- DropTable
DROP TABLE "opod"."credit_refund_allocations";

-- DropTable
DROP TABLE "opod"."credit_refunds";

-- DropEnum
DROP TYPE "opod"."credit_entry_type";

-- DropEnum
DROP TYPE "opod"."credit_refund_status";

-- CreateTable
CREATE TABLE "opod"."credit_ledger" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "opod"."credit_ledger_type" NOT NULL,
    "credit_kind" "opod"."credit_kind",
    "purchase_id" UUID,
    "promotion_code" TEXT,
    "amount" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "reason" TEXT NOT NULL,
    "external_reference" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."payments" (
    "id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "channel" "opod"."payment_channel" NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "opod"."payment_status" NOT NULL DEFAULT 'pending',
    "amount" INTEGER,
    "currency" TEXT,
    "provider_checkout_id" TEXT,
    "provider_checkout_url" TEXT,
    "provider_transaction_id" TEXT,
    "provider_transaction_key" TEXT,
    "provider_product_id" TEXT NOT NULL,
    "provider_environment" TEXT,
    "paid_at" TIMESTAMPTZ(6),
    "refunded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."payment_ledger" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "type" "opod"."payment_ledger_type" NOT NULL,
    "direction" "opod"."payment_direction" NOT NULL,
    "amount" INTEGER,
    "currency" TEXT,
    "provider_transaction_id" TEXT,
    "provider_event_id" TEXT,
    "admin_id" UUID,
    "reason" TEXT,
    "details" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."payment_provider_events" (
    "id" UUID NOT NULL,
    "payment_id" UUID,
    "provider" TEXT NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "status" "opod"."payment_provider_event_status" NOT NULL DEFAULT 'processing',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "last_error_code" TEXT,
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_provider_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."credit_refund" (
    "id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "status" "opod"."credit_refund_state" NOT NULL DEFAULT 'reserved',
    "reason" TEXT NOT NULL DEFAULT 'user_request',
    "idempotency_key" TEXT NOT NULL,
    "credit_amount" INTEGER NOT NULL,
    "promotion_amount" INTEGER NOT NULL DEFAULT 0,
    "locked_amount" INTEGER NOT NULL,
    "recovery_amount" INTEGER NOT NULL,
    "debt_amount" INTEGER NOT NULL DEFAULT 0,
    "gross_amount" INTEGER NOT NULL,
    "fee_amount" INTEGER NOT NULL,
    "refund_amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "provider_refund_id" TEXT,
    "provider_transaction_id" TEXT,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "credit_refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."credit_usage" (
    "usage_ledger_id" UUID NOT NULL,
    "grant_ledger_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "credit_usage_pkey" PRIMARY KEY ("usage_ledger_id","grant_ledger_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_ledger_external_reference_key" ON "opod"."credit_ledger"("external_reference");

-- CreateIndex
CREATE INDEX "credit_ledger_user_id_created_at_idx" ON "opod"."credit_ledger"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "credit_ledger_user_id_type_credit_kind_expires_at_idx" ON "opod"."credit_ledger"("user_id", "type", "credit_kind", "expires_at");

-- CreateIndex
CREATE INDEX "credit_ledger_purchase_id_idx" ON "opod"."credit_ledger"("purchase_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_purchase_id_key" ON "opod"."payments"("purchase_id");

-- CreateIndex
CREATE INDEX "payments_status_updated_at_idx" ON "opod"."payments"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_checkout_id_key" ON "opod"."payments"("provider", "provider_checkout_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_transaction_key_key" ON "opod"."payments"("provider", "provider_transaction_key");

-- CreateIndex
CREATE INDEX "payment_ledger_payment_id_occurred_at_idx" ON "opod"."payment_ledger"("payment_id", "occurred_at");

-- CreateIndex
CREATE INDEX "payment_ledger_type_occurred_at_idx" ON "opod"."payment_ledger"("type", "occurred_at");

-- CreateIndex
CREATE INDEX "payment_ledger_provider_transaction_id_idx" ON "opod"."payment_ledger"("provider_transaction_id");

-- CreateIndex
CREATE INDEX "payment_ledger_admin_id_occurred_at_idx" ON "opod"."payment_ledger"("admin_id", "occurred_at");

-- CreateIndex
CREATE INDEX "payment_provider_events_status_updated_at_idx" ON "opod"."payment_provider_events"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_provider_events_provider_external_event_id_key" ON "opod"."payment_provider_events"("provider", "external_event_id");

-- CreateIndex
CREATE INDEX "credit_refund_purchase_id_status_idx" ON "opod"."credit_refund"("purchase_id", "status");

-- CreateIndex
CREATE INDEX "credit_refund_status_created_at_idx" ON "opod"."credit_refund"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "credit_refund_purchase_id_idempotency_key_key" ON "opod"."credit_refund"("purchase_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "credit_refund_provider_refund_id_key" ON "opod"."credit_refund"("provider_refund_id");

-- CreateIndex
CREATE INDEX "credit_usage_grant_ledger_id_idx" ON "opod"."credit_usage"("grant_ledger_id");

-- CreateIndex
CREATE INDEX "credit_purchases_status_created_at_idx" ON "opod"."credit_purchases"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "credit_purchases_user_id_idempotency_key_key" ON "opod"."credit_purchases"("user_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "opod"."credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."credit_ledger" ADD CONSTRAINT "credit_ledger_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "opod"."credit_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."payments" ADD CONSTRAINT "payments_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "opod"."credit_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."payment_ledger" ADD CONSTRAINT "payment_ledger_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "opod"."payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."payment_ledger" ADD CONSTRAINT "payment_ledger_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "opod"."admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."payment_provider_events" ADD CONSTRAINT "payment_provider_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "opod"."payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."credit_refund" ADD CONSTRAINT "credit_refund_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "opod"."credit_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."credit_usage" ADD CONSTRAINT "credit_usage_usage_ledger_id_fkey" FOREIGN KEY ("usage_ledger_id") REFERENCES "opod"."credit_ledger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opod"."credit_usage" ADD CONSTRAINT "credit_usage_grant_ledger_id_fkey" FOREIGN KEY ("grant_ledger_id") REFERENCES "opod"."credit_ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
