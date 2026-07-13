import { IsNotEmpty, IsString } from "class-validator";

export class CreateCharacterMemoryDto {
  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
