import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

export class CreateLocationDto {
  @IsOptional()
  @IsString()
  characterId?: string | null;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(100)
  locationKey!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  displayName!: string;

  @IsString()
  @MaxLength(4000)
  description!: string;

  @IsString()
  @MaxLength(4000)
  visualPrompt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  negativePrompt?: string;
}
