import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

// 연결 테스트 입력 — 폼의 미저장 값만 담는다. 생략된 필드는 서버가
// 현재 실효 설정(DB > env)으로 채워 "저장하면 적용될 조합"을 검증한다.
export class TestGenerationSettingsDto {
  @IsIn(["image", "planner", "chat"])
  target!: "image" | "planner" | "chat";

  @IsOptional()
  @IsString()
  @MaxLength(500)
  falApiKey?: string;

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
