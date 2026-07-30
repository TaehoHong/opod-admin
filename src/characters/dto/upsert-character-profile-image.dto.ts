import { Type } from "class-transformer";
import {
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

class CharacterProfileImageCropDto {
  @IsNumber()
  @Min(0)
  @Max(1)
  x!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  y!: number;

  @IsNumber()
  @Min(1)
  @Max(3)
  zoom!: number;
}

export class UpsertCharacterProfileImageDto {
  @IsUUID()
  mediaId!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CharacterProfileImageCropDto)
  crop?: CharacterProfileImageCropDto;
}
