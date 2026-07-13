import { IsArray, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateCharacterDto {
  @IsString()
  @IsNotEmpty()
  publicId!: string;

  @IsString()
  @IsNotEmpty()
  displayName!: string;

  @IsString()
  @IsNotEmpty()
  bio!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  interests?: string[];
}
