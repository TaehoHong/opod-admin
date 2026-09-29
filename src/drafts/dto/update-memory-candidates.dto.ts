import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsString,
  MaxLength,
} from "class-validator";

export class UpdateMemoryCandidatesDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  selectedKeys!: string[];
}
