import { IsNumber, IsOptional, IsString } from "class-validator";

export class CompleteGenerationJobDto {
  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  mediaId?: string;

  @IsOptional()
  @IsNumber()
  width?: number;

  @IsOptional()
  @IsNumber()
  height?: number;

  @IsOptional()
  @IsNumber()
  durationSeconds?: number;
}
