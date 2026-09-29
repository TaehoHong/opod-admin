import { IsNotEmpty, IsString, IsUUID } from "class-validator";

export class SelectGenerationOutputDto {
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  mediaId!: string;
}
