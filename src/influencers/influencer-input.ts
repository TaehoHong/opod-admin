import { BadRequestException } from "@nestjs/common";
import { plainToInstance, Type } from "class-transformer";
export { compositionText } from "../shared/ai/image-composition";
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  validateSync,
} from "class-validator";

export function instagramAccount(value: string) {
  const match =
    /^https?:\/\/(?:www\.)?instagram\.com\/([a-z0-9_.]{1,30})\/?(?:[?#].*)?$/i.exec(
      value.trim(),
    );
  const username = match?.[1].toLowerCase();
  if (
    !username ||
    [
      "p",
      "reel",
      "reels",
      "stories",
      "explore",
      "accounts",
      "direct",
      "about",
      "developer",
      "legal",
    ].includes(username)
  ) {
    throw new BadRequestException(
      "Instagram 계정 프로필 링크를 입력해 주세요.",
    );
  }
  return {
    platform: "instagram",
    username,
    url: `https://www.instagram.com/${username}/`,
  };
}

export class RegisterInfluencer {
  @IsString() @IsNotEmpty() @MaxLength(2048) url!: string;
}

export class ImageAnalysisContent {
  @IsString() @IsNotEmpty() @MaxLength(2000) description!: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) personCount?: number | null;
  @IsOptional() @IsString() @MaxLength(1000) framing?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) faceDirection?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) bodyDirection?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) pose?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) hands?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) gaze?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) camera?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) placement?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) occlusion?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) background?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) wardrobe?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) lighting?: string | null;
}
export class ImageAnalysis {
  @IsString() @IsNotEmpty() @MaxLength(200) model!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) version!: string;
  @IsObject()
  @ValidateNested()
  @Type(() => ImageAnalysisContent)
  content!: ImageAnalysisContent;
}
export class RegisterInfluencerMedia {
  @IsString() @Matches(/^[1-9][0-9]*$/) influencerId!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,100}$/) postId!: string;
  @IsOptional() @IsString() sourceCaption?: string | null;
  @IsString() @MaxLength(2048) postUrl!: string;
  @IsInt() @Min(1) @Max(100) slideIndex!: number;
  @IsIn(["image", "video_thumbnail"]) assetType!: "image" | "video_thumbnail";
  @IsOptional()
  @ValidateNested()
  @Type(() => ImageAnalysis)
  analysis?: ImageAnalysis | null;
}
export function parseMediaMetadata(value: unknown): RegisterInfluencerMedia {
  try {
    if (typeof value !== "string" || value.length > 20000) throw new Error();
    const raw: unknown = JSON.parse(value);
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error();
    const input = plainToInstance(RegisterInfluencerMedia, raw);
    if (
      validateSync(input, { whitelist: true, forbidNonWhitelisted: true })
        .length
    )
      throw new Error();
    const url = new URL(input.postUrl);
    if (
      url.protocol !== "https:" ||
      !["instagram.com", "www.instagram.com"].includes(url.hostname) ||
      url.port ||
      url.username ||
      url.password ||
      !new RegExp(`^/(p|reel|tv)/${input.postId}/?$`).test(url.pathname)
    )
      throw new Error();
    input.postUrl = `https://www.instagram.com${url.pathname.replace(/\/$/, "")}/`;
    if (
      input.analysis &&
      (!input.analysis.model.trim() ||
        !input.analysis.version.trim() ||
        !input.analysis.content.description.trim())
    )
      throw new Error();
    return input;
  } catch {
    throw new BadRequestException("Invalid media metadata");
  }
}

// Stable field order makes retries independent of JSON object key order.
export function normalizedAnalysis(
  content: ImageAnalysisContent,
): Record<string, string | number | null> {
  const result: Record<string, string | number | null> = {};
  for (const key of [
    "description",
    "personCount",
    "framing",
    "faceDirection",
    "bodyDirection",
    "pose",
    "hands",
    "gaze",
    "camera",
    "placement",
    "occlusion",
    "background",
    "wardrobe",
    "lighting",
  ] as const) {
    const value = content[key];
    result[key] = typeof value === "string" ? value.trim() : (value ?? null);
  }
  return result;
}
