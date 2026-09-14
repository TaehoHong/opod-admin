import { Type } from "class-transformer";
import {
  IsArray,
  IsHash,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from "class-validator";

export class MemorySourceRefDto {
  @IsIn(["persona_source", "post", "manual"])
  kind!: "persona_source" | "post" | "manual";
  @IsUUID()
  sourceId!: string;
  @IsString()
  @IsNotEmpty()
  quote!: string;
  @IsHash("sha256")
  sha256!: string;
  @IsOptional() @IsHash("sha256") sourceSha256?: string;
  @IsOptional() @IsInt() @Min(0) byteStart?: number;
  @IsOptional() @IsInt() @Min(0) byteEnd?: number;
}

export class UpdateCharacterMemoryDto {
  @IsOptional() @IsHash("sha256") memorySha256?: string;
  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MemorySourceRefDto)
  sourceRefs?: MemorySourceRefDto[];
  @IsOptional() @IsString() occurredLabel?: string;
  @IsOptional()
  @IsIn(["year", "month", "day", "instant", "approximate"])
  occurredPrecision?: string;
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  occurredAt?: string;
}
