-- AlterTable
ALTER TABLE "opod"."credit_refund" ADD COLUMN "free_promotion_amount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "opod"."payments" ADD COLUMN "net_amount" INTEGER,
ADD COLUMN "tax_amount" INTEGER;
