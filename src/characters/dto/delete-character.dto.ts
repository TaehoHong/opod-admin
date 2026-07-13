import { IsNotEmpty, IsString } from "class-validator";

export class DeleteCharacterDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
