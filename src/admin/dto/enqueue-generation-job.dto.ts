import { Prisma } from "@prisma/client";
import { IsNotEmpty, IsObject, IsOptional, IsString } from "class-validator";

export class EnqueueGenerationJobDto {
  @IsString()
  @IsNotEmpty()
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
  paramsJson?: Prisma.InputJsonValue;

  @IsOptional()
  @IsString()
  originJobId?: string;
}
