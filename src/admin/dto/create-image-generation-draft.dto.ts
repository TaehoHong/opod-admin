import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from "class-validator";

export class CreateImageGenerationDraftDto {
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  characterId!: string;

  @IsString()
  @IsNotEmpty()
  inputPrompt!: string;

  @IsInt()
  @Min(1)
  @Max(4)
  candidateCount!: number;

  // 종횡비 (예: "4:3", "16:9"). 잡 paramsJson.aspect_ratio로 저장되어
  // 프로필 providerConfig 기본값을 덮어쓴다. 허용 값 검증은 프로바이더 몫.
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,2}:\d{1,2}$/)
  aspectRatio?: string;
}
