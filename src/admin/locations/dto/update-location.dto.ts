import { IsOptional, IsString, Matches, MaxLength } from "class-validator";

export class UpdateLocationDto {
  @IsOptional()
  @IsString()
  characterId?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(100)
  locationKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  visualPrompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  negativePrompt?: string;
}
