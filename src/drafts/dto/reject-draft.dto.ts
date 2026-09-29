import { IsOptional, IsString } from "class-validator";

export class RejectDraftDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
