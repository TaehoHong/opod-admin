import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { MediaService, createS3UploadSigner } from "./media.service";

const s3 = {
  bucket: "bucket",
  region: "us-east-1",
  accessKeyId: "test-access",
  secretAccessKey: "test-secret",
  publicBaseUrl: "https://cdn.example.com",
};

describe("MediaService", () => {
  it("starts an S3 upload as pending media", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const create = jest.fn().mockImplementation((data) =>
      Promise.resolve({
        id: "media-1",
        ...data,
        durationSeconds: data.durationSeconds ?? null,
        uploadedAt: null,
        createdAt,
      }),
    );
    const service = new (
      MediaService as new (...args: unknown[]) => MediaService
    )({ create }, { s3 });

    await expect(
      service.startUpload({
        mediaType: "image",
        contentType: "image/png",
        fileName: " photo.png ",
        width: 1024,
        height: 768,
        byteSize: 12345,
      }),
    ).resolves.toMatchObject({
      media: {
        id: "media-1",
        mediaType: "image",
        url: expect.stringMatching(
          /^https:\/\/cdn\.example\.com\/media\/image\/.+\.png$/,
        ),
        contentType: "image/png",
        byteSize: 12345,
        width: 1024,
        height: 768,
        uploadedAt: null,
        createdAt: createdAt.toISOString(),
      },
      uploadUrl: expect.stringContaining(
        "https://bucket.s3.us-east-1.amazonaws.com/media/image/",
      ),
      method: "PUT",
      headers: { "content-type": "image/png" },
      expiresAt: expect.any(String),
    });
    expect(create.mock.calls[0][0]).toMatchObject({
      mediaType: "image",
      storageKey: expect.stringMatching(/^media\/image\/.+\.png$/),
      url: expect.stringMatching(
        /^https:\/\/cdn\.example\.com\/media\/image\/.+\.png$/,
      ),
      contentType: "image/png",
      byteSize: 12345,
      width: 1024,
      height: 768,
    });
  });

  it("starts an avatar content upload under the requested S3 prefix", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const create = jest.fn().mockImplementation((data) =>
      Promise.resolve({
        id: "media-1",
        ...data,
        durationSeconds: data.durationSeconds ?? null,
        uploadedAt: null,
        createdAt,
      }),
    );
    const service = new (
      MediaService as new (...args: unknown[]) => MediaService
    )({ create }, { s3 });

    await expect(
      service.startUpload({
        mediaType: "video",
        contentType: "video/mp4",
        fileName: " reel.mp4 ",
        storagePrefix: "pod/reels/character/character-1",
      }),
    ).resolves.toMatchObject({
      media: {
        id: "media-1",
        mediaType: "video",
        url: expect.stringMatching(
          /^https:\/\/cdn\.example\.com\/pod\/reels\/character\/character-1\/.+\.mp4$/,
        ),
      },
      uploadUrl: expect.stringContaining(
        "https://bucket.s3.us-east-1.amazonaws.com/pod/reels/character/character-1/",
      ),
    });
    expect(create.mock.calls[0][0]).toMatchObject({
      mediaType: "video",
      storageKey: expect.stringMatching(
        /^pod\/reels\/character\/character-1\/.+\.mp4$/,
      ),
      url: expect.stringMatching(
        /^https:\/\/cdn\.example\.com\/pod\/reels\/character\/character-1\/.+\.mp4$/,
      ),
    });
  });

  it("fails clearly when S3 upload signing is not configured", async () => {
    const service = new (
      MediaService as new (...args: unknown[]) => MediaService
    )({ create: jest.fn() }, { s3: undefined });

    await expect(
      service.startUpload({
        mediaType: "image",
        contentType: "image/png",
        fileName: "photo.png",
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("confirms a pending media upload", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const uploadedAt = new Date("2026-06-30T00:02:00.000Z");
    const update = jest.fn().mockResolvedValue({
      id: "media-1",
      mediaType: "image",
      url: "https://cdn.example.com/media/image/photo.png",
      storageKey: "media/image/photo.png",
      contentType: "image/png",
      byteSize: 12345,
      width: 1024,
      height: 768,
      durationSeconds: null,
      uploadedAt,
      createdAt,
    });
    const service = new (
      MediaService as new (...args: unknown[]) => MediaService
    )({
      exists: jest.fn().mockResolvedValue(true),
      markUploaded: update,
    });

    await expect(service.confirmUpload("media-1")).resolves.toMatchObject({
      id: "media-1",
      mediaType: "image",
      uploadedAt: uploadedAt.toISOString(),
    });
    expect(update).toHaveBeenCalledWith("media-1", expect.any(Date));
  });

  it("rejects upload confirmation for missing media", async () => {
    const service = new (
      MediaService as new (...args: unknown[]) => MediaService
    )({
      exists: jest.fn().mockResolvedValue(false),
      markUploaded: jest.fn(),
    });

    await expect(service.confirmUpload("missing")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe("createS3UploadSigner", () => {
  it("creates a deterministic S3 presigned PUT URL", async () => {
    const signPutUpload = createS3UploadSigner(
      s3,
      () => new Date("2026-06-30T00:00:00.000Z"),
      () => "fixed-id",
    );

    const signed = await signPutUpload?.({
      mediaType: "image",
      contentType: "image/png",
      fileName: "photo.png",
    });

    expect(signed).toMatchObject({
      storageKey: "media/image/fixed-id.png",
      publicUrl: "https://cdn.example.com/media/image/fixed-id.png",
      method: "PUT",
      headers: { "content-type": "image/png" },
      expiresAt: new Date("2026-06-30T00:10:00.000Z"),
    });
    expect(signed?.uploadUrl).toContain(
      "https://bucket.s3.us-east-1.amazonaws.com/media/image/fixed-id.png",
    );
    expect(signed?.uploadUrl).toContain(
      "X-Amz-Credential=test-access%2F20260630%2Fus-east-1%2Fs3%2Faws4_request",
    );
    expect(signed?.uploadUrl).toContain(
      "X-Amz-SignedHeaders=content-type%3Bhost",
    );
    expect(signed?.uploadUrl).toContain("X-Amz-Signature=");
  });
});
