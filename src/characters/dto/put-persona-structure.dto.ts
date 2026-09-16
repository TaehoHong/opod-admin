import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsHash,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
  IsUUID,
} from "class-validator";

export class PersonaFragmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  content!: string;

  @IsIn([
    "identity",
    "behavior",
    "voice",
    "example",
    "greeting",
    "lore",
    "creator_note",
    "motivation",
    "judgment",
    "tension",
    "relationship",
    "boundary",
  ])
  kind!: string;

  @IsIn(["always", "start_only", "retrieved", "never_prompt"])
  injection!: string;

  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(100, { each: true })
  recallKeys: string[] = [];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsUUID(undefined, { each: true })
  canonIds?: string[];
}

export class PutPersonaStructureDto {
  @IsOptional()
  @IsInt()
  @IsIn([1, 2])
  schemaVersion?: number;

  @IsHash("sha256")
  sourceSha256!: string;

  @IsOptional()
  @IsHash("sha256")
  structureSha256?: string;

  // Omit to classify the current source; include to edit source and split together.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  content?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PersonaFragmentDto)
  fragments!: PersonaFragmentDto[];
}
