import { IsNotEmpty, IsString } from "class-validator";

export class SelectGenerationOutputDto {
  @IsString()
  @IsNotEmpty()
  mediaId!: string;
}
