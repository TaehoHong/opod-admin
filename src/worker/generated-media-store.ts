import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";

export type StoredGeneratedFile = {
  url: string;
  storageKey?: string;
};

// 프로바이더 출력 바이트를 우리 스토리지에 영구 저장한다.
// 프로바이더가 준 임시 URL을 그대로 Media에 저장하는 것은 금지
// (만료되고, uploadedAt 게이트에 걸려 게시할 수 없다).
export type GeneratedMediaStore = (input: {
  bytes: Buffer;
  contentType: string;
  // 기존 업로드 컨벤션(pod/...)과 같은 트리에 두기 위한 키 프리픽스.
  keyPrefix?: string;
}) => Promise<StoredGeneratedFile>;

const LOCAL_STORE_MAX_BYTES = 1024 * 1024;

type StoreEnv = Record<string, string | undefined>;

export function createGeneratedMediaStore(
  env: StoreEnv = process.env,
): GeneratedMediaStore {
  const bucket = env.S3_BUCKET?.trim();
  const region = env.AWS_REGION?.trim();
  const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    return localGeneratedMediaStore;
  }

  const publicBaseUrl = env.S3_PUBLIC_BASE_URL?.trim();
  const client = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });

  return async ({ bytes, contentType, keyPrefix }) => {
    const prefix = keyPrefix?.replace(/^\/+|\/+$/g, "") || "pod/generated";
    const storageKey = `${prefix}/${randomUUID()}.${extensionFor(contentType)}`;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: storageKey,
        Body: bytes,
        ContentType: contentType,
      }),
    );
    const base = publicBaseUrl
      ? publicBaseUrl.replace(/\/$/, "")
      : `https://${bucket}.s3.${region}.amazonaws.com`;
    const encodedKey = storageKey
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    return { url: `${base}/${encodedKey}`, storageKey };
  };
}

// S3 미설정 시(로컬 개발) 데이터 URL로 저장한다. 실서비스 경로 아님.
export function localGeneratedMediaStore(input: {
  bytes: Buffer;
  contentType: string;
}): Promise<StoredGeneratedFile> {
  if (input.bytes.byteLength > LOCAL_STORE_MAX_BYTES) {
    return Promise.reject(
      new Error(
        "S3 media store is not configured; refusing to inline large generated media",
      ),
    );
  }
  return Promise.resolve({
    url: `data:${input.contentType};base64,${input.bytes.toString("base64")}`,
  });
}

function extensionFor(contentType: string): string {
  switch (contentType.toLowerCase()) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    default:
      return "bin";
  }
}
