import { IsOptional, IsString } from "class-validator";

export class EnqueueVisualProfileTestGenerationDto {
  @IsOptional()
  @IsString()
  scene?: string;
}
