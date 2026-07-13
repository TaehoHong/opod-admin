import { IsBoolean, IsNumber, IsOptional } from "class-validator";

export class UpsertPostingPolicyDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsNumber()
  weeklyCadence?: number;

  @IsOptional()
  @IsNumber()
  hourStartKst?: number;

  @IsOptional()
  @IsNumber()
  hourEndKst?: number;
}
