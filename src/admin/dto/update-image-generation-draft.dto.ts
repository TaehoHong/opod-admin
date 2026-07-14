import { IsInt, IsNotEmpty, IsString, Max, Min } from "class-validator";

export class UpdateImageGenerationDraftDto {
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @IsInt()
  @Min(1)
  @Max(4)
  candidateCount!: number;
}
