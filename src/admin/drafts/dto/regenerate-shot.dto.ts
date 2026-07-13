import { IsOptional, IsString } from "class-validator";

export class RegenerateShotDto {
  @IsOptional()
  @IsString()
  prompt?: string;
}
