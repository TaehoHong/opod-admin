import { IsArray, IsOptional, IsString } from "class-validator";

export class UpdateDraftDto {
  @IsOptional()
  @IsString()
  caption?: string;

  // Element handling stays in the service (non-string entries are skipped
  // there), so only the array shape is validated here.
  @IsOptional()
  @IsArray()
  hashtags?: string[];

  // null clears the schedule; @IsOptional lets null through.
  @IsOptional()
  @IsString()
  scheduledAt?: string | null;
}
