import { IsArray, IsOptional, IsString } from "class-validator";

export class ReorderCharacterPersonasDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  personaIds?: string[];
}
