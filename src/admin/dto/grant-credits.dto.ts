import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from "class-validator";

export class GrantCreditsDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsNumber()
  amount!: number;

  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsOptional()
  @IsString()
  externalReference?: string;

  @IsOptional()
  @IsIn(["free", "paid"])
  creditKind?: "free" | "paid";

  @IsOptional()
  @IsUUID()
  purchaseId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  promotionCode?: string;
}
