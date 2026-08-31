import type { JsonValue } from "../../domain/database/json";
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from "class-validator";

export class EnqueueGenerationJobDto {
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  characterId!: string;

  @IsString()
  @IsNotEmpty()
  mediaType!: string;

  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @IsOptional()
  @IsString()
  provider?: string;

  // Free-form provider params; whitelist must not strip its keys, so no
  // nested DTO here.
  @IsOptional()
  @IsObject()
  paramsJson?: JsonValue;

  @IsOptional()
  @IsString()
  originJobId?: string;
}
