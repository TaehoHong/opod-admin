import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export class CreateDraftDto {
  @IsOptional()
  @IsIn(["existing", "natural-v1"])
  postGenerationAgent?: "existing" | "natural-v1";

  @IsString()
  @IsNotEmpty()
  characterId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  sceneHint?: string;

  @IsOptional()
  @IsString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  contentType?: string;
}

export class NaturalAutomationDto {
  @IsBoolean() enabled!: boolean;
}
