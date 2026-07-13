import { Type } from "class-transformer";
import { IsArray, IsOptional, IsString, ValidateNested } from "class-validator";

// Item fields stay optional so the service keeps producing its per-index
// error messages (e.g. "Character memory items[0] content is required").
export class CharacterMemoryItemDto {
  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class CreateCharacterMemoriesDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CharacterMemoryItemDto)
  items?: CharacterMemoryItemDto[];
}
