import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreatePostReactionDto {
  @IsString()
  @IsNotEmpty()
  characterId!: string;

  @IsString()
  @IsNotEmpty()
  reactionType!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
