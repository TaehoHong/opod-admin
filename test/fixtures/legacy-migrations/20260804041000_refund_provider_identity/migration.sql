-- Refund IDs are scoped by the provider that issued them.
DROP INDEX "opod"."credit_refund_provider_refund_id_key";

ALTER TABLE "opod"."credit_refund"
ADD COLUMN "provider" TEXT NOT NULL;

CREATE UNIQUE INDEX "credit_refund_provider_provider_refund_id_key"
ON "opod"."credit_refund"("provider", "provider_refund_id");
