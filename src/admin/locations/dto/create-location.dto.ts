import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

export class CreateLocationDto {
  @IsOptional()
  @IsString()
  characterId?: string | null;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(100)
  locationKey!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  displayName!: string;

  @IsString()
  @MaxLength(4000)
  description!: string;

  @IsString()
  @MaxLength(4000)
  visualPrompt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  negativePrompt?: string;

  // 빈 공간 레퍼런스를 만들 때만 쓰는 금지어. 컷 생성 요청에는 나가지 않는다 —
  // 인물이 나와야 하는 컷에 "사람 금지"가 함께 나가면 목록 전체가 무시된다.
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  referenceNegativePrompt?: string;
}
