import {
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import sharp from "sharp";
import { AppConfigService } from "../core/config/app-config.service";

export const MAX_REFERENCE_BYTES = 30 * 1024 * 1024;
export async function inspectReferenceImage(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_REFERENCE_BYTES)
    throw new UnprocessableEntityException("Invalid image size");
  try {
    const image = sharp(bytes, {
      limitInputPixels: 40_000_000,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    const formats: Record<string, string> = {
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
    };
    if (
      !metadata.format ||
      !formats[metadata.format] ||
      !metadata.width ||
      !metadata.height ||
      (metadata.pages ?? 1) !== 1
    )
      throw new Error();
    await image.stats();
    return {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      extension: metadata.format,
      contentType: formats[metadata.format],
    };
  } catch {
    throw new UnprocessableEntityException(
      "A decodable JPEG, PNG or WebP image is required",
    );
  }
}
@Injectable()
export class InfluencerMediaStore {
  constructor(private readonly config: AppConfigService) {}
  private connection() {
    const config = this.config.s3;
    if (!config) throw new ServiceUnavailableException("S3 is not configured");
    return {
      config,
      client: new S3Client({
        region: config.region,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      }),
    };
  }
  async save(key: string, bytes: Buffer, sha256: string, contentType: string) {
    const { client, config } = this.connection();
    try {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: bytes,
            ContentType: contentType,
            Metadata: { sha256 },
            IfNoneMatch: "*",
          }),
        );
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode !== 412
        )
          throw error;
      }
      const stored = await client.send(
        new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
      );
      if (
        stored.ContentLength !== bytes.length ||
        stored.Metadata?.sha256 !== sha256
      )
        throw new Error("Stored object mismatch");
    } catch {
      throw new ServiceUnavailableException("S3 image storage failed");
    } finally {
      client.destroy();
    }
  }
  async url(key: string) {
    const { client, config } = this.connection();
    try {
      return await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: config.bucket, Key: key }),
        { expiresIn: 900 },
      );
    } finally {
      client.destroy();
    }
  }
}
