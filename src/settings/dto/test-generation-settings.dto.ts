import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { SPICYAPI_IMAGE_MODELS } from "../../generation/providers/spicyapi-image-models";

// 연결 테스트 입력 — 폼의 미저장 값만 담는다. 생략된 필드는 서버가
// 현재 실효 설정(DB > env)으로 채워 "저장하면 적용될 조합"을 검증한다.
export class TestGenerationSettingsDto {
  @IsIn(["image", "planner", "chat", "embedding"])
  target!: "image" | "planner" | "chat" | "embedding";

  @IsOptional()
  @IsIn(["fal", "opod-flux", "openai", "spicyapi"])
  imageProvider?: "fal" | "opod-flux" | "openai" | "spicyapi";

  @IsOptional()
  @IsString()
  @MaxLength(500)
  openaiApiKey?: string;

  @IsOptional()
  @IsIn(["gpt-image-2.5-sunburst"])
  openaiImageModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  spicyApiKey?: string;

  @IsOptional()
  @IsIn([...SPICYAPI_IMAGE_MODELS])
  spicyImageModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  falApiKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  opodFluxApiBaseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  opodFluxApiKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  llmApiUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  llmApiKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  llmModel?: string;
}
