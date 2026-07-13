import { IsNumber, IsOptional, IsString } from "class-validator";

export class UpdateCharacterPersonaDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}
