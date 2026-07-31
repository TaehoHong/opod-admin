import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { basename, extname } from "node:path";
import { AppConfigService } from "../../domain/config/app-config.service";
import { S3Config } from "../../domain/config/app-config";
import { MediaRepository } from "./media.repository";

export type MediaType = "image" | "video";
type UploadMethod = "PUT";

type PrismaMedia = {
  id: string;
  mediaType: MediaType;
  url: string;
  storageKey: string | null;
  contentType: string | null;
  byteSize: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  uploadedAt: Date | null;
  createdAt: Date;
};

export type Media = {
  id: string;
  mediaType: MediaType;
  url: string;
  contentType?: string;
  byteSize?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  uploadedAt: string | null;
  createdAt: string;
};

type SignedMediaUpload = {
  storageKey: string;
  publicUrl: string;
  uploadUrl: string;
  method: UploadMethod;
  headers: Record<string, string>;
  expiresAt: Date;
};

type SignPutUpload = (input: {
  mediaType: MediaType;
  contentType: string;
  fileName: string;
  storagePrefix?: string;
}) => Promise<SignedMediaUpload>;

@Injectable()
export class MediaService {
  constructor(
    private readonly media: MediaRepository,
    private readonly config: AppConfigService,
  ) {}

  async startUpload(input: {
    mediaType: string;
    contentType: string;
    fileName: string;
    byteSize?: number;
    width?: number;
    height?: number;
    durationSeconds?: number;
    storagePrefix?: string;
  }): Promise<{
    media: Media;
    uploadUrl: string;
    method: UploadMethod;
    headers: Record<string, string>;
    expiresAt: string;
  }> {
    const mediaType = this.parseMediaType(input.mediaType);
    const contentType = this.validateContentType(mediaType, input.contentType);
    const fileName = this.validateFileName(input.fileName);
    const storagePrefix = this.validateStoragePrefix(input.storagePrefix);
    const numbers = this.validateMetadata(mediaType, input);

    const signPutUpload = createS3UploadSigner(this.config.s3);
    if (!signPutUpload) {
      throw new ServiceUnavailableException(
        "S3 media upload is not configured",
      );
    }

    const signed = await signPutUpload({
      mediaType,
      contentType,
      fileName,
      ...(storagePrefix ? { storagePrefix } : {}),
    });
    const media = await this.media.create({
      mediaType,
      url: signed.publicUrl,
      storageKey: signed.storageKey,
      contentType,
      ...numbers,
    });

    return {
      media: this.toMedia(media),
      uploadUrl: signed.uploadUrl,
      method: signed.method,
      headers: signed.headers,
      expiresAt: signed.expiresAt.toISOString(),
    };
  }

  async confirmUpload(mediaId: string): Promise<Media> {
    if (!(await this.media.exists(mediaId))) {
      throw new BadRequestException("Media not found");
    }

    return this.toMedia(await this.media.markUploaded(mediaId, new Date()));
  }

  private parseMediaType(mediaType: string): MediaType {
    if (mediaType !== "image" && mediaType !== "video") {
      throw new BadRequestException("Media type must be image or video");
    }
    return mediaType;
  }

  private validateContentType(
    mediaType: MediaType,
    contentType: string,
  ): string {
    const value = contentType.trim().toLowerCase();
    if (!value.startsWith(`${mediaType}/`)) {
      throw new BadRequestException(
        "Media content type does not match media type",
      );
    }
    return value;
  }

  private validateFileName(fileName: string): string {
    const value = basename(fileName.trim());
    if (!value || value === "." || value === "..") {
      throw new BadRequestException("Media file name is required");
    }
    return value;
  }

  private validateStoragePrefix(storagePrefix?: string): string | undefined {
    const value = storagePrefix?.trim().replace(/^\/+|\/+$/g, "");
    if (!value) {
      return undefined;
    }
    const parts = value.split("/");
    if (
      parts.some(
        (part) =>
          !part || part === "." || part === ".." || !/^[\w-]+$/.test(part),
      )
    ) {
      throw new BadRequestException("Invalid media storage prefix");
    }
    return parts.join("/");
  }

  private validateMetadata(
    mediaType: MediaType,
    input: {
      byteSize?: number;
      width?: number;
      height?: number;
      durationSeconds?: number;
    },
  ) {
    const numbers = {
      ...(input.byteSize !== undefined
        ? { byteSize: this.positiveInt(input.byteSize, "Media byte size") }
        : {}),
      ...(input.width !== undefined
        ? { width: this.positiveInt(input.width, "Media width") }
        : {}),
      ...(input.height !== undefined
        ? { height: this.positiveInt(input.height, "Media height") }
        : {}),
      ...(input.durationSeconds !== undefined
        ? {
            durationSeconds: this.positiveInt(
              input.durationSeconds,
              "Media duration",
            ),
          }
        : {}),
    };

    if (mediaType === "image" && numbers.durationSeconds !== undefined) {
      throw new BadRequestException("Image media cannot have duration");
    }

    return numbers;
  }

  private positiveInt(value: number, label: string): number {
    if (!Number.isInteger(value) || value <= 0) {
      throw new BadRequestException(`${label} must be a positive integer`);
    }
    return value;
  }

  private toMedia(media: PrismaMedia): Media {
    return {
      id: media.id,
      mediaType: media.mediaType,
      url: media.url,
      ...(media.contentType ? { contentType: media.contentType } : {}),
      ...(media.byteSize ? { byteSize: media.byteSize } : {}),
      ...(media.width ? { width: media.width } : {}),
      ...(media.height ? { height: media.height } : {}),
      ...(media.durationSeconds
        ? { durationSeconds: media.durationSeconds }
        : {}),
      uploadedAt: media.uploadedAt?.toISOString() ?? null,
      createdAt: media.createdAt.toISOString(),
    };
  }
}

// 확인에 필요한 최소 필드. repository가 이 형태로 읽어 오면 검증은 순수
// 함수로 끝난다 — prisma를 넘겨받지 않아도 된다.
export type AssertableMedia = {
  id: string;
  mediaType: MediaType;
  url: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  uploadedAt: Date | null;
};

export const assertableMediaFields = {
  id: true,
  mediaType: true,
  url: true,
  width: true,
  height: true,
  durationSeconds: true,
  uploadedAt: true,
} as const;

export function assertUploadedMediaRow(
  media: AssertableMedia | null,
  expectedMediaType?: MediaType,
): AssertableMedia {
  if (!media) {
    throw new BadRequestException("Media not found");
  }
  if (!media.uploadedAt) {
    throw new BadRequestException("Media upload is not confirmed");
  }
  if (expectedMediaType && media.mediaType !== expectedMediaType) {
    throw new BadRequestException("Media type does not match generation job");
  }
  return media;
}

export function createS3UploadSigner(
  config: S3Config | undefined,
  now: () => Date = () => new Date(),
  randomId: () => string = randomUUID,
): SignPutUpload | undefined {
  if (!config) {
    return undefined;
  }

  const client = new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return async (input) => {
    const prefix = input.storagePrefix ?? ["media", input.mediaType].join("/");
    const storageKey = [
      prefix,
      `${randomId()}${extname(input.fileName).toLowerCase()}`,
    ].join("/");
    const expiresInSeconds = 600;
    const signedAt = now();
    const encodedKey = storageKey
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: storageKey,
        ContentType: input.contentType,
      }),
      {
        expiresIn: expiresInSeconds,
        signingDate: signedAt,
        signableHeaders: new Set(["content-type"]),
      },
    );
    const publicUrlBase = config.publicBaseUrl
      ? config.publicBaseUrl.replace(/\/$/, "")
      : `https://${config.bucket}.s3.${config.region}.amazonaws.com`;

    return {
      storageKey,
      publicUrl: `${publicUrlBase}/${encodedKey}`,
      uploadUrl,
      method: "PUT",
      headers: { "content-type": input.contentType },
      expiresAt: new Date(signedAt.getTime() + expiresInSeconds * 1000),
    };
  };
}
