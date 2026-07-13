import { IsArray, IsString } from "class-validator";

export class SetVisualProfileReferencesDto {
  @IsArray()
  @IsString({ each: true })
  mediaIds!: string[];
}
