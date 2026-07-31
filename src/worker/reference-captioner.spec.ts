import { S3Client } from "@aws-sdk/client-s3";
import { createMediaBytesReader } from "./reference-captioner";

describe("createMediaBytesReader", () => {
  it("reads owned reference objects through authenticated S3 access", async () => {
    const send = jest.spyOn(S3Client.prototype, "send").mockResolvedValue({
      Body: {
        transformToByteArray: () =>
          Promise.resolve(Uint8Array.from(Buffer.from("private-image"))),
      },
      ContentType: "image/webp",
    } as never);
    const fetchFn = jest.fn();
    const readBytes = createMediaBytesReader(
      {
        bucket: "private-bucket",
        region: "ap-northeast-2",
        accessKeyId: "access",
        secretAccessKey: "secret",
      },
      fetchFn as unknown as typeof fetch,
    );

    await expect(
      readBytes({
        url: "https://cdn.example.com/reference.webp",
        storageKey: "references/private.webp",
      }),
    ).resolves.toEqual({
      bytes: Buffer.from("private-image"),
      contentType: "image/webp",
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(fetchFn).not.toHaveBeenCalled();
    send.mockRestore();
  });

  it("falls back to public fetch when S3 is not configured", async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      new Response(Buffer.from("public-image"), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );
    const readBytes = createMediaBytesReader(
      undefined,
      fetchFn as unknown as typeof fetch,
    );

    await expect(
      readBytes({ url: "https://cdn.example.com/reference.jpg" }),
    ).resolves.toEqual({
      bytes: Buffer.from("public-image"),
      contentType: "image/jpeg",
    });
    expect(fetchFn).toHaveBeenCalledWith(
      "https://cdn.example.com/reference.jpg",
      { signal: expect.any(AbortSignal) },
    );
  });
});
