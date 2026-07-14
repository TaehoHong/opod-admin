import { IsOptional, IsString, MaxLength } from "class-validator";

// 각 필드: 누락 = 유지, null·빈 문자열 = 삭제(env 폴백 복귀), 값 = 저장.
// @IsOptional은 null도 검증에서 제외하므로 null 삭제 시맨틱과 호환된다.
export class UpdateGenerationSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  falApiKey?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  falImageModel?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  falImageT2iModel?: string | null;

  // 기획 LLM (OpenAI-compatible chat completions)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  llmApiUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  llmApiKey?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  llmModel?: string | null;
}
