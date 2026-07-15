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

  // 진행 방식: manual = 단계마다 버튼으로만 진행(자동 전이 없음), auto = 워커가 진행.
  @IsOptional()
  @IsString()
  mode?: string;
}
