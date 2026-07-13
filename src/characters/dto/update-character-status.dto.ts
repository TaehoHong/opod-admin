import { IsNotEmpty, IsString } from "class-validator";

export class UpdateCharacterStatusDto {
  @IsString()
  @IsNotEmpty()
  status!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
