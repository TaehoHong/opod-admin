import { IsOptional, IsString } from "class-validator";

export class RetryGenerationJobDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
