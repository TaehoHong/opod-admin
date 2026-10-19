import sharp from "sharp";
import { createHash } from "node:crypto";
import { inspectReferenceImage } from "./influencer-media-store";
describe("reference image validation", () => {
  it("derives MIME and digest from actual image bytes", async () => {
    const bytes = await sharp({
      create: { width: 3, height: 4, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    expect(await inspectReferenceImage(bytes)).toEqual({
      extension: "png",
      contentType: "image/png",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  });
  it("rejects an HTML response disguised as an image", async () => {
    await expect(
      inspectReferenceImage(Buffer.from("<html>login required</html>")),
    ).rejects.toThrow("decodable");
  });
  it("rejects truncated image content before it can be stored", async () => {
    const bytes = await sharp({
      create: { width: 30, height: 40, channels: 3, background: "blue" },
    })
      .png()
      .toBuffer();
    await expect(
      inspectReferenceImage(bytes.subarray(0, bytes.length - 20)),
    ).rejects.toThrow("decodable");
  });
});
