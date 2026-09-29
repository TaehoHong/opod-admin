import { Type } from "class-transformer";
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { MediaInputBody, MediaInputDto } from "./media-input.dto";

export class CreateStoryDto {
  @IsString()
  @IsNotEmpty()
  characterId!: string;

  @IsOptional()
  @IsString()
  caption?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsObject()
  @ValidateNested()
  @Type(() => MediaInputDto)
  media!: MediaInputBody;
}
