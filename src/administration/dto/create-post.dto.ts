import { Type } from "class-transformer";
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { MediaInputBody, MediaInputDto } from "./media-input.dto";

export class CreatePostDto {
  @IsString()
  @IsNotEmpty()
  actorType!: "character" | "user";

  @IsString()
  @IsNotEmpty()
  actorId!: string;

  @IsOptional()
  @IsString()
  contentType?: "feed" | "reel";

  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hashtags?: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MediaInputDto)
  media!: MediaInputBody[];
}
