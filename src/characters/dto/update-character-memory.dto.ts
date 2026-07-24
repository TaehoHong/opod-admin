import { IsOptional, IsString } from "class-validator";

export class UpdateCharacterMemoryDto {
  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
