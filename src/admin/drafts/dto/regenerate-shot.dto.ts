import { IsBoolean, IsOptional, IsString } from "class-validator";

export class RegenerateShotDto {
  @IsOptional()
  @IsString()
  prompt?: string;

  // generate와 같은 의미 — true(기본)면 새 잡을 바로 실행, false면 큐에만 넣는다.
  @IsOptional()
  @IsBoolean()
  runNow?: boolean;
}
