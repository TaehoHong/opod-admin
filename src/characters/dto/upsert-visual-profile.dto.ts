import { Prisma } from "@prisma/client";
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
  providerConfig?: Prisma.InputJsonValue;
}
