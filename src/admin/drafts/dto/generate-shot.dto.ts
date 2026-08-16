import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";

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

  // true(기본): 큐잉 직후 이 프로세스가 바로 실행한다. false: 큐에만 넣고
  // 자동 워커 루프(worker.enabled)가 집어가길 기다린다 — 루프가 꺼져 있으면
  // 운영자가 "지금 실행"을 눌러야 돈다.
  @IsOptional()
  @IsBoolean()
  runNow?: boolean;
}
