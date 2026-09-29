import { IsOptional, IsString } from "class-validator";

export class FailGenerationJobDto {
  @IsOptional()
  @IsString()
  errorMessage?: string;
}
