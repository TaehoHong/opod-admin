import { IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateOperatorRequestDto {
  // 공백 문자열은 요청 해제로 처리하므로 서비스에서 다듬는다. null도 통과시킨다.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  operatorRequest?: string | null;
}
