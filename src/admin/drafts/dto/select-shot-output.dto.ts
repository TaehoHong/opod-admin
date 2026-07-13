import { IsNotEmpty, IsString } from "class-validator";

export class SelectShotOutputDto {
  @IsString()
  @IsNotEmpty()
  mediaId!: string;
}
