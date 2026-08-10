import { Type } from "class-transformer";
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";

class UpdateDraftPlanShotDto {
  @IsInt()
  @Min(0)
  sortOrder!: number;

  @IsString()
  @IsNotEmpty()
  scene!: string;
}

export class UpdateDraftPlanDto {
  @IsString()
  @IsNotEmpty()
  caption!: string;

  @IsArray()
  @IsString({ each: true })
  hashtags!: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateDraftPlanShotDto)
  shots!: UpdateDraftPlanShotDto[];
}
