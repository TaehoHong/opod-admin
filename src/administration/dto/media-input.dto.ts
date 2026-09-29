import { IsNumber, IsOptional, IsString } from "class-validator";

// Posts/stories accept either a stored media reference ({ mediaId }) or a
// direct media descriptor ({ mediaType, url, ... }). Every field is decorated
// so the whitelist keeps both shapes; the services keep enforcing which shape
// is actually valid.
export class MediaInputDto {
  @IsOptional()
  @IsString()
  mediaId?: string;

  @IsOptional()
  @IsString()
  mediaType?: "image" | "video";

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsNumber()
  width?: number;

  @IsOptional()
  @IsNumber()
  height?: number;

  @IsOptional()
  @IsNumber()
  durationSeconds?: number;
}

export type MediaInputBody = MediaInputDto &
  ({ mediaId: string } | { mediaType: "image" | "video"; url: string });
