import { IsIn, IsNotEmpty, IsString, IsUUID } from "class-validator";

export class ReconcilePaymentDto {
  @IsUUID()
  purchaseId!: string;

  @IsIn([
    "grant_missing_purchase",
    "recover_nonpaid_grants",
    "recover_duplicate_grants",
    "recover_completed_refund",
  ])
  action!:
    | "grant_missing_purchase"
    | "recover_nonpaid_grants"
    | "recover_duplicate_grants"
    | "recover_completed_refund";

  @IsString()
  @IsNotEmpty()
  reference!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
