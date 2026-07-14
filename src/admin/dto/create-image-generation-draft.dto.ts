import { IsInt, IsNotEmpty, IsString, Max, Min } from "class-validator";

export class CreateImageGenerationDraftDto {
  @IsString()
  @IsNotEmpty()
  characterId!: string;

  @IsString()
  @IsNotEmpty()
  inputPrompt!: string;

  @IsInt()
  @Min(1)
  @Max(4)
  candidateCount!: number;
}
