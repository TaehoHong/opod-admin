import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  IsOptional,
  IsHash,
  MaxLength,
} from "class-validator";

export class PutMemoryRoutingDto {
  @IsOptional()
  @IsHash("sha256")
  memorySha256?: string;
  @IsIn(["fact", "event"])
  kind!: string;

  @IsIn(["always", "retrieved"])
  injection!: string;

  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(100, { each: true })
  recallKeys: string[] = [];
}
