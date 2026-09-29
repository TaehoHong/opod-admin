import { IsOptional, IsString, MaxLength } from "class-validator";

// 수동 단계 실행(POST :id/plan)의 선택 본문. V4 ⑥ 캡션 재실행에서 이번 실행에만
// 전달되는 운영자 지시 — 영속 operatorRequest와 달리 저장은 captionBuild.input
// 스냅숏에만 남는다(아키텍처 §20.5).
export class RunStageDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
