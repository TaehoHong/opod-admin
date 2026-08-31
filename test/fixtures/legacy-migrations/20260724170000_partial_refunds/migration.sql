CREATE TYPE "opod"."credit_refund_status" AS ENUM ('reserved', 'refunded', 'released');

CREATE TABLE "opod"."credit_refunds" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "purchase_id" UUID NOT NULL,
  "status" "opod"."credit_refund_status" NOT NULL DEFAULT 'reserved',
  "credit_amount" INTEGER NOT NULL,
  "gross_amount" INTEGER NOT NULL,
  "fee_amount" INTEGER NOT NULL,
  "refund_amount" INTEGER NOT NULL,
  "reason" TEXT NOT NULL DEFAULT 'user_request',
  "reference" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "credit_refunds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "credit_refunds_amounts_check" CHECK (
    "credit_amount" > 0
    AND "gross_amount" > 0
    AND "fee_amount" >= 0
    AND "refund_amount" = "gross_amount" - "fee_amount"
  )
);

CREATE UNIQUE INDEX "credit_refunds_reference_key"
ON "opod"."credit_refunds"("reference");
CREATE INDEX "credit_refunds_user_id_status_created_at_idx"
ON "opod"."credit_refunds"("user_id", "status", "created_at");
CREATE INDEX "credit_refunds_purchase_id_status_idx"
ON "opod"."credit_refunds"("purchase_id", "status");

ALTER TABLE "opod"."credit_refunds"
ADD CONSTRAINT "credit_refunds_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "opod"."credit_refunds"
ADD CONSTRAINT "credit_refunds_purchase_id_fkey"
FOREIGN KEY ("purchase_id") REFERENCES "opod"."credit_purchases"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
