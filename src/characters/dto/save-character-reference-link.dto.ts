import { IsNotEmpty, IsString } from "class-validator";

export class SaveCharacterReferenceLinkDto {
  @IsString()
  @IsNotEmpty()
  url!: string;
}
