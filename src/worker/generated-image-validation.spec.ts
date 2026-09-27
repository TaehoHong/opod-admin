import sharp from "sharp";
import {
  requestedImageAspectRatio,
  validateGeneratedImage,
} from "./generated-image-validation";

function picture(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: "white" } });
}

describe("generated image validation", () => {
  it("honors explicit model dimensions over the fallback format ratio", () => {
    expect(
      requestedImageAspectRatio({
        aspect_ratio: "4:5",
        image_size: { width: 1200, height: 800 },
      }),
    ).toBe(1.5);
    expect(
      requestedImageAspectRatio({
        aspect_ratio: "4:5",
        image_size: "landscape_16_9",
      }),
    ).toBeNull();
    expect(requestedImageAspectRatio({ aspect_ratio: "auto" })).toBeNull();
  });

  it("accepts integer rounding but rejects a different composition ratio", async () => {
    await expect(
      validateGeneratedImage(await picture(67, 100).png().toBuffer(), 2 / 3),
    ).resolves.toMatchObject({ width: 67, height: 100 });
    await expect(
      validateGeneratedImage(await picture(70, 100).png().toBuffer(), 2 / 3),
    ).rejects.toThrow("aspect ratio mismatch");
  });

  it("uses the displayed dimensions of an EXIF-rotated photograph", async () => {
    const bytes = await picture(50, 40)
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    await expect(validateGeneratedImage(bytes, 0.8)).resolves.toEqual({
      width: 40,
      height: 50,
      contentType: "image/jpeg",
    });
  });

  it("rejects truncated pixel data even when the image header is readable", async () => {
    const bytes = await picture(400, 500).jpeg().toBuffer();
    const truncated = bytes.subarray(0, bytes.length - 150);
    await expect(sharp(truncated).metadata()).resolves.toMatchObject({
      width: 400,
    });
    await expect(validateGeneratedImage(truncated, 0.8)).rejects.toThrow(
      "generated_image_invalid:",
    );
  });

  it("rejects an empty downloaded file as an invalid output", async () => {
    await expect(validateGeneratedImage(Buffer.alloc(0), null)).rejects.toThrow(
      "generated_image_invalid:",
    );
  });
});
