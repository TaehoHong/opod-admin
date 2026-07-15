import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class GenerateShotDto {
  // 실행 전 최종 프롬프트 수정 (선택).
  @IsOptional()
  @IsString()
  prompt?: string;

  // 컷별 best-of-N 후보 수 (선택).
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  candidateCount?: number;
}
