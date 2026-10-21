import {
  IsBoolean,
  ValidateIf,
  IsIn,
  IsISO8601,
  IsString,
} from "class-validator";

export class RestartReferenceDraftDto {
  @IsIn(["reference_select", "generation"])
  target!: "reference_select" | "generation";

  @IsString()
  @IsISO8601({ strict: true })
  expectedRevision!: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  enablePromptExpansion?: boolean;
}
