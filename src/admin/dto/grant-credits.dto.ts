import { IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator";

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
}
