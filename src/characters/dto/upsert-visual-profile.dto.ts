import type { JsonValue } from "../../domain/database/json";
import { IsObject, IsOptional, IsString } from "class-validator";

export class UpsertVisualProfileDto {
  @IsOptional()
  @IsString()
  appearancePrompt?: string;

  @IsOptional()
  @IsString()
  stylePrompt?: string;

  @IsOptional()
  @IsString()
  negativePrompt?: string;

  // Free-form provider config; whitelist must not strip its keys, so no
  // nested DTO here.
  @IsOptional()
  @IsObject()
  providerConfig?: JsonValue;
}
