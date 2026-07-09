import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { MediaService, createS3UploadSigner } from "./media.service";

describe("MediaService", () => {
  it("starts an S3 upload as pending media", async () => {
    const restoreS3Env = setS3Env({
      S3_BUCKET: "bucket",
      AWS_REGION: "us-east-1",
      AWS_ACCESS_KEY_ID: "test-access",
      AWS_SECRET_ACCESS_KEY: "test-secret",
      S3_PUBLIC_BASE_URL: "https://cdn.example.com",
    });
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const create = jest.fn().mockImplementation(({ data }) =>
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
    )({ media: { create } });

    try {
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
      expect(create.mock.calls[0][0].data).toMatchObject({
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
    } finally {
      restoreS3Env();
    }
  });

  it("starts an avatar content upload under the requested S3 prefix", async () => {
    const restoreS3Env = setS3Env({
      S3_BUCKET: "bucket",
      AWS_REGION: "us-east-1",
      AWS_ACCESS_KEY_ID: "test-access",
      AWS_SECRET_ACCESS_KEY: "test-secret",
      S3_PUBLIC_BASE_URL: "https://cdn.example.com",
    });
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const create = jest.fn().mockImplementation(({ data }) =>
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
    )({ media: { create } });

    try {
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
            /^pod\/reels\/character\/character-1\/.+\.mp4$/,
          ),
        },
        uploadUrl: expect.stringContaining(
          "https://bucket.s3.us-east-1.amazonaws.com/pod/reels/character/character-1/",
        ),
      });
      expect(create.mock.calls[0][0].data).toMatchObject({
        mediaType: "video",
        storageKey: expect.stringMatching(
          /^pod\/reels\/character\/character-1\/.+\.mp4$/,
        ),
        url: expect.stringMatching(
          /^pod\/reels\/character\/character-1\/.+\.mp4$/,
        ),
      });
    } finally {
      restoreS3Env();
    }
  });

  it("fails clearly when S3 upload signing is not configured", async () => {
    const restoreS3Env = setS3Env({});
    const service = new (
      MediaService as new (...args: unknown[]) => MediaService
    )({ media: { create: jest.fn() } });

    try {
      await expect(
        service.startUpload({
          mediaType: "image",
          contentType: "image/png",
          fileName: "photo.png",
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    } finally {
      restoreS3Env();
    }
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
      media: {
        findUnique: jest.fn().mockResolvedValue({ id: "media-1" }),
        update,
      },
    });

    await expect(service.confirmUpload("media-1")).resolves.toMatchObject({
      id: "media-1",
      mediaType: "image",
      uploadedAt: uploadedAt.toISOString(),
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "media-1" },
      data: { uploadedAt: expect.any(Date) },
    });
  });

  it("rejects upload confirmation for missing media", async () => {
    const service = new (
      MediaService as new (...args: unknown[]) => MediaService
    )({
      media: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    });

    await expect(service.confirmUpload("missing")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe("createS3UploadSigner", () => {
  it("creates a deterministic S3 presigned PUT URL", async () => {
    const signPutUpload = createS3UploadSigner(
      {
        S3_BUCKET: "bucket",
        AWS_REGION: "us-east-1",
        AWS_ACCESS_KEY_ID: "test-access",
        AWS_SECRET_ACCESS_KEY: "test-secret",
        S3_PUBLIC_BASE_URL: "https://cdn.example.com",
      },
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

function setS3Env(values: Record<string, string | undefined>): () => void {
  const keys = [
    "S3_BUCKET",
    "AWS_REGION",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "S3_PUBLIC_BASE_URL",
  ];
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );

  for (const key of keys) {
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}
