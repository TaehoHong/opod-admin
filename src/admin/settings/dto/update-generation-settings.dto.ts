import { IsOptional, IsString, Matches, MaxLength } from "class-validator";

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
  // 빈 문자열은 삭제 의미라 통과시키고, 값이 있으면 http(s) URL이어야 한다.
  @IsOptional()
  @IsString()
  @Matches(/^$|^https?:\/\//, {
    message: "llmApiUrl must start with http:// or https://",
  })
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

  // 캐릭터 채팅 LLM (opod-agent) — 미설정 필드는 planner.*를 상속하므로
  // 값이 있을 때만 오버라이드로 저장된다. 삭제(null/빈값) = 재상속.
  @IsOptional()
  @IsString()
  @Matches(/^$|^https?:\/\//, {
    message: "agentLlmApiUrl must start with http:// or https://",
  })
  @MaxLength(500)
  agentLlmApiUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  agentLlmApiKey?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  agentLlmModel?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  agentEmbeddingModel?: string | null;
}
