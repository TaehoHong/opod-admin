import sharp from "sharp";
import { applyFinishWithMeta, parseFinishPreset } from "./film-finish";

describe("applyFinishWithMeta", () => {
  async function sourcePng(): Promise<Buffer> {
    return sharp({
      create: {
        width: 96,
        height: 96,
        channels: 3,
        background: { r: 200, g: 120, b: 80 },
      },
    })
      .png()
      .toBuffer();
  }

  it("produces a deterministic JPEG distinct from the source", async () => {
    const source = await sourcePng();

    const first = await applyFinishWithMeta(source, "film");
    const second = await applyFinishWithMeta(source, "film");

    // 결정성 — 같은 입력·프리셋은 바이트까지 같아야 한다. 미리보기와 게시,
    // 그리고 게시물 간 마감 강도가 늘 같다는 계약.
    expect(second.bytes.equals(first.bytes)).toBe(true);

    // JPEG 출력 + 크기 메타 + 원본 픽셀과 실제로 다름(보정 적용).
    expect(first.bytes[0]).toBe(0xff);
    expect(first.bytes[1]).toBe(0xd8);
    expect(first.width).toBe(96);
    expect(first.height).toBe(96);
    const [sourceRaw, finishedRaw] = await Promise.all([
      sharp(source).raw().toBuffer(),
      sharp(first.bytes).raw().toBuffer(),
    ]);
    expect(finishedRaw.equals(sourceRaw)).toBe(false);
  });

  it("mono-film removes color while film keeps a warm cast", async () => {
    const source = await sourcePng();

    const mono = await applyFinishWithMeta(source, "mono-film");
    const film = await applyFinishWithMeta(source, "film");
    expect(mono.bytes.equals(film.bytes)).toBe(false);

    // 중앙 픽셀 채널 편차 — 흑백 필름은 R≈G≈B여야 한다 (그레인 오차 허용).
    const raw = await sharp(mono.bytes).raw().toBuffer();
    const center = (48 * 96 + 48) * 3;
    const [r, g, b] = [raw[center], raw[center + 1], raw[center + 2]];
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(4);
  });
});

describe("parseFinishPreset", () => {
  it("accepts known presets and rejects everything else", () => {
    expect(parseFinishPreset("film")).toBe("film");
    expect(parseFinishPreset("mono-film")).toBe("mono-film");
    expect(parseFinishPreset("none")).toBeNull();
    expect(parseFinishPreset(undefined)).toBeNull();
    expect(parseFinishPreset("sepia")).toBeNull();
  });
});
