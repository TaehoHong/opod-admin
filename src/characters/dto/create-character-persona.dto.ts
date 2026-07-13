import { IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator";

export class CreateCharacterPersonaDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}
