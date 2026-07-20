import sharp from "sharp";

// 게시 마감(후보정) 프리셋 — 생성 이미지의 디지털 티를 걷어내는 결정적
// 픽셀 연산. LLM·생성 모델을 타지 않는다: 같은 입력·같은 프리셋이면 항상
// 같은 출력이 나와야 피드 톤이 유지된다 (Math.random 등 비결정 요소 금지).
//
// 프리셋은 초안 검수에서 게시글마다 고른다 (drafts conceptJson.finish):
// - film      — 웜 컬러 매트릭스 + 채도 완화 + 그레인 + 비네트 (Kodak Gold 방향)
// - mono-film — 흑백 변환 + 그레인 + 비네트 (컬러 캐스트 없음)
// 공통: 블랙 리프트/하이라이트 롤오프, 미세 소프트닝.

export const FINISH_PRESETS = ["film", "mono-film"] as const;
export type FinishPreset = (typeof FINISH_PRESETS)[number];

export function parseFinishPreset(value: unknown): FinishPreset | null {
  return FINISH_PRESETS.includes(value as FinishPreset)
    ? (value as FinishPreset)
    : null;
}

// 시드 고정 그레인 타일 — 전체 해상도 노이즈 대신 타일을 반복 합성한다.
const GRAIN_TILE_SIZE = 256;
// 128(무변화) 기준 ±진폭. 오버레이 블렌드라 값이 클수록 알갱이가 굵어진다.
const GRAIN_AMPLITUDE = 18;
const GRAIN_SEED = 0x5350444f; // "OPDS"

// 모서리 최대 어둡기(0~1). 필름 렌즈 특유의 옅은 주변부 감광만 흉내낸다.
const VIGNETTE_STRENGTH = 0.2;

const JPEG_QUALITY = 88;

// BT.709 휘도 계수 — 흑백 변환을 recomb으로 해서 3채널을 유지한다
// (grayscale()은 밴드 수가 줄어 그레인 합성과 충돌한다).
const LUMA = [0.2126, 0.7152, 0.0722] as const;

const grainTileCache = new Map<number, Buffer>();

// xorshift32 — 시드 고정으로 크기가 같으면 항상 같은 그레인 패턴을 만든다.
// composite 입력은 원본보다 클 수 없어서 작은 이미지는 타일도 줄여 만든다.
function grainTile(size: number): Buffer {
  const cached = grainTileCache.get(size);
  if (cached) {
    return cached;
  }
  let state = GRAIN_SEED;
  const next = () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
  const pixels = size * size;
  const data = Buffer.alloc(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    // 두 난수의 평균 — 극단값이 줄어 입자가 부드러워진다.
    const noise = (next() + next()) / 2 - 0.5;
    const value = Math.round(128 + noise * 2 * GRAIN_AMPLITUDE);
    // 휘도 그레인: RGB 동일값 (컬러 노이즈는 디지털 센서 티가 난다).
    data[i * 3] = value;
    data[i * 3 + 1] = value;
    data[i * 3 + 2] = value;
  }
  grainTileCache.set(size, data);
  return data;
}

function vignetteSvg(width: number, height: number): Buffer {
  return Buffer.from(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs><radialGradient id="v" cx="50%" cy="50%" r="75%">
        <stop offset="55%" stop-color="#000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000" stop-opacity="${VIGNETTE_STRENGTH}"/>
      </radialGradient></defs>
      <rect width="100%" height="100%" fill="url(#v)"/>
    </svg>`,
  );
}

export type FinishedImage = {
  bytes: Buffer;
  width: number;
  height: number;
  contentType: "image/jpeg";
};

export async function applyFinish(
  bytes: Buffer,
  preset: FinishPreset,
): Promise<Buffer> {
  return (await applyFinishWithMeta(bytes, preset)).bytes;
}

// Media 행 생성(게시 경로)에 필요한 크기 메타데이터까지 돌려준다.
export async function applyFinishWithMeta(
  bytes: Buffer,
  preset: FinishPreset,
): Promise<FinishedImage> {
  // rotate() 인자 없이 — EXIF 방향을 픽셀에 확정한 뒤 보정한다.
  const base = sharp(bytes).rotate();
  const { width, height } = await base.metadata();
  if (!width || !height) {
    throw new Error("finish source has no dimensions");
  }
  const graded =
    preset === "mono-film"
      ? base.recomb([[...LUMA], [...LUMA], [...LUMA]])
      : base
          // 웜 캐스트: R을 살리고 B를 눌러 Kodak Gold의 노란 기운을 만든다.
          .recomb([
            [1.04, 0.04, 0.0],
            [0.02, 1.0, 0.02],
            [0.0, 0.05, 0.91],
          ])
          .modulate({ saturation: 0.87 });
  return graded
    // out = in×0.9 + 14 — 블랙이 뜨고 화이트가 죽는 바랜 필름 대비.
    .linear(0.9, 14)
    // 디지털 선예도를 녹이는 최소 블러 (그레인 전에 적용돼야 입자가 산다).
    .blur(0.4)
    .composite([
      (() => {
        const tileSize = Math.min(GRAIN_TILE_SIZE, width, height);
        return {
          input: grainTile(tileSize),
          raw: { width: tileSize, height: tileSize, channels: 3 as const },
          tile: true,
          blend: "overlay" as const,
        };
      })(),
      { input: vignetteSvg(width, height), blend: "over" },
    ])
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => ({
      bytes: data,
      width: info.width,
      height: info.height,
      contentType: "image/jpeg" as const,
    }));
}

// 미디어 원본 바이트 로더 — 후보정 입력용. 자사 S3 객체(storageKey)는
// presigned URL로 읽고(버킷 비공개 유지), S3 미설정 로컬 개발에서 생성
// 워커가 data URL로 저장한 미디어도 처리한다.
export async function mediaSourceBytes(
  media: { url: string; storageKey: string | null },
  signUrl: ((storageKey: string) => Promise<string>) | null,
  download: (url: string) => Promise<Buffer> = downloadMediaBytes,
): Promise<Buffer> {
  if (media.storageKey && signUrl) {
    return download(await signUrl(media.storageKey));
  }
  if (media.url.startsWith("data:")) {
    const comma = media.url.indexOf(",");
    if (comma < 0) {
      throw new Error("malformed data URL media");
    }
    return Buffer.from(media.url.slice(comma + 1), "base64");
  }
  return download(media.url);
}

export async function downloadMediaBytes(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`media source download failed (${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer());
}
