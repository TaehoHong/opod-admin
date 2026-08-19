import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

// 각 필드: 누락 = 유지, null·빈 문자열 = 삭제(env 폴백 복귀), 값 = 저장.
// @IsOptional은 null도 검증에서 제외하므로 null 삭제 시맨틱과 호환된다.
export class UpdateGenerationSettingsDto {
  @IsOptional()
  @IsIn(["fal", "opod-flux"])
  imageProvider?: "fal" | "opod-flux" | null;

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

  @IsOptional()
  @IsString()
  @Matches(/^$|^https:\/\//, {
    message: "opodFluxApiBaseUrl must start with https://",
  })
  @MaxLength(500)
  opodFluxApiBaseUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  opodFluxApiKey?: string | null;

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

  // 평가 워커 LLM — 채팅 LLM과 같은 규칙이고 env 폴백은 없다.
  @IsOptional()
  @IsString()
  @Matches(/^$|^https?:\/\//, {
    message: "evaluatorLlmApiUrl must start with http:// or https://",
  })
  @MaxLength(500)
  evaluatorLlmApiUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  evaluatorLlmApiKey?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  evaluatorLlmModel?: string | null;

  // 워커 자동 루프 on/off. null = 삭제(env 기본값 복귀).
  // workerEnabled는 생성 워커와 draft 워커를 함께 제어한다.
  @IsOptional()
  @IsBoolean()
  workerEnabled?: boolean | null;

  @IsOptional()
  @IsBoolean()
  evaluationWorkerEnabled?: boolean | null;

  // 신규 draft만 V3 계약으로 pin한다. true 저장은 controller가 현재 기획
  // LLM의 strict JSON schema capability를 실제 확인한 뒤에만 허용한다.
  @IsOptional()
  @IsBoolean()
  pipelineV3Enabled?: boolean | null;

  // 포맷별 생성 이미지 종횡비. "가로:세로"만 허용하고 빈 문자열은 삭제(기본값
  // 복귀)다. 프로바이더에 그대로 전달되는 값이라 형식이 어긋나면 생성이 422로
  // 죽으므로 저장 전에 막는다.
  @IsOptional()
  @IsString()
  @Matches(/^$|^\d{1,2}:\d{1,2}$/, {
    message: "aspectRatioFeed must look like 4:5",
  })
  aspectRatioFeed?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^$|^\d{1,2}:\d{1,2}$/, {
    message: "aspectRatioStory must look like 9:16",
  })
  aspectRatioStory?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^$|^\d{1,2}:\d{1,2}$/, {
    message: "aspectRatioReel must look like 9:16",
  })
  aspectRatioReel?: string | null;
}
