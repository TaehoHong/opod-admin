import { Type } from "class-transformer";
import { IsArray, IsString, MaxLength, ValidateNested } from "class-validator";

export class LocationReferenceDto {
  @IsString()
  mediaId!: string;

  @IsString()
  @MaxLength(2000)
  description!: string;
}

export class SetLocationReferencesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LocationReferenceDto)
  references!: LocationReferenceDto[];
}
