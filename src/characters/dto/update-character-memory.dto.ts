import { IsOptional, IsString } from "class-validator";

export class UpdateCharacterMemoryDto {
  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
