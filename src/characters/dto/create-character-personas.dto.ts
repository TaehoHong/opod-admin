import { Type } from "class-transformer";
import { IsArray, IsOptional, IsString, ValidateNested } from "class-validator";

// Item fields stay optional so the service keeps producing its per-index
// error messages (e.g. "Character persona items[0] title is required").
export class CharacterPersonaItemDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;
}

export class CreateCharacterPersonasDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CharacterPersonaItemDto)
  items?: CharacterPersonaItemDto[];
}
