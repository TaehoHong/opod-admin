import { IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator";

export class StartMediaUploadDto {
  @IsString()
  @IsNotEmpty()
  mediaType!: string;

  @IsString()
  @IsNotEmpty()
  contentType!: string;

  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsOptional()
  @IsNumber()
  byteSize?: number;

  @IsOptional()
  @IsNumber()
  width?: number;

  @IsOptional()
  @IsNumber()
  height?: number;

  @IsOptional()
  @IsNumber()
  durationSeconds?: number;

  @IsOptional()
  @IsString()
  storagePrefix?: string;
}
