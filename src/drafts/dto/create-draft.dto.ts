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
  @IsIn(["natural-v1", "reference-v1"])
  postGenerationAgent?: "existing" | "natural-v1" | "reference-v1";

  @IsOptional()
  @IsIn(["manual", "auto"])
  mode?: "manual" | "auto";

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

export class DraftAutomationDto {
  @IsBoolean() enabled!: boolean;
}
