import { IsOptional, IsString } from "class-validator";

export class RunGenerationJobDto {
  @IsOptional()
  @IsString()
  provider?: string;
}
