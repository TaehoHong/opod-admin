import {
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
export class CreateAiModelDto {
  @IsIn(["llm", "image"]) type!: "llm" | "image";
  @IsString() @MaxLength(100) provider!: string;
  @IsString() @MaxLength(512) model!: string;
}
export class PromptRevisionDto {
  @IsInt() @Min(0) expectedRevision!: number;
}
export class SavePostAgentPromptDto extends PromptRevisionDto {
  @IsString() @Matches(/^[1-9][0-9]*$/) aiModelId!: string;
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(512)
  model!: string | null;
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(50000)
  systemPrompt!: string | null;
  // Shape validation is owned by PostAgentPromptService against the stage schema.
  @ValidateIf(() => false) outputSchema!: unknown;
}

export class SaveNaturalAgentDto {
  @IsBoolean() schedulerDefault!: boolean;
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  expectedRevision!: string | null;
  @IsString() @Matches(/^[1-9][0-9]*$/) planningAiModelId!: string;
  @IsString() @Matches(/^[1-9][0-9]*$/) reviewAiModelId!: string;
  @ValidateIf(() => false) prompts!: unknown;
}
