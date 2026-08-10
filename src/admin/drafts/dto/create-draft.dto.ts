import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateDraftDto {
  @IsString()
  @IsNotEmpty()
  characterId!: string;

  @IsOptional()
  @IsString()
  sceneHint?: string;

  @IsOptional()
  @IsString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  contentType?: string;
}
