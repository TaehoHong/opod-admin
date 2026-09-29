import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreatePostCommentDto {
  @IsString()
  @IsNotEmpty()
  characterId!: string;

  @IsString()
  @IsNotEmpty()
  body!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
