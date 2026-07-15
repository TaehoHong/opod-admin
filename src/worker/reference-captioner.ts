import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { contentFromChatCompletion } from "./content-planner";

// 레퍼런스 이미지 캡셔닝 — 비전 LLM(기획 LLM과 동일 설정)으로 장면·구도·의상·
// 조명 서술을 생성한다. 이 서술이 기획 LLM의 샷별 레퍼런스 선별 카탈로그가
// 된다 (docs/media-generation-pipeline.md "컨텍스트 선별").
// 이미지 전달은 S3 버킷 공개 정책과 무관하도록 base64 data URL로 한다.

const HTTP_TIMEOUT_MS = 60_000;
const CAPTION_MAX_LENGTH = 600;

export type ReferenceImage = {
  url: string;
  storageKey?: string | null;
  contentType?: string | null;
};

export type ReferenceCaptioner = {
  readonly name: string;
  caption(image: ReferenceImage): Promise<string>;
};

// 이미지 바이트 확보 — 자사 S3 객체(storageKey 있음)는 자격증명으로 읽고,
// 그 외 URL은 공개 fetch로 받는다.
export type MediaBytesReader = (
  image: ReferenceImage,
) => Promise<{ bytes: Buffer; contentType: string }>;

type ReaderEnv = Record<string, string | undefined>;

export function createMediaBytesReader(
  env: ReaderEnv = process.env,
  fetchFn: typeof fetch = fetch,
): MediaBytesReader {
  const bucket = env.S3_BUCKET?.trim();
  const region = env.AWS_REGION?.trim();
  const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim();
  const client =
    bucket && region && accessKeyId && secretAccessKey
      ? new S3Client({ region, credentials: { accessKeyId, secretAccessKey } })
      : null;

  return async (image) => {
    if (client && image.storageKey) {
      const object = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: image.storageKey }),
      );
      if (!object.Body) {
        throw new Error("reference image object has no body");
      }
      const bytes = Buffer.from(await object.Body.transformToByteArray());
      return {
        bytes,
        contentType: image.contentType || object.ContentType || "image/png",
      };
    }
    const response = await fetchFn(image.url, {
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`reference image download failed (${response.status})`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      bytes,
      contentType:
        image.contentType ||
        response.headers.get("content-type") ||
        "image/png",
    };
  };
}

const CAPTION_SYSTEM_PROMPT = [
  "너는 이미지 생성 레퍼런스 카탈로그를 만드는 사진 아키비스트다.",
  "주어진 인물 사진을 '어떤 장면에 레퍼런스로 쓸 수 있는지' 기준으로 서술한다.",
  "규칙:",
  "- 장소·장면, 구도(전신/상반신/클로즈업, 각도), 포즈, 의상, 조명, 분위기를 담는다.",
  "- 인물의 이름·정체성 추정은 금지. 외모 묘사는 최소화한다 (외모는 별도 프롬프트로 주입됨).",
  "- 한국어 2~3문장, 검색·대조하기 쉽게 구체적으로.",
  "- 서술 문장만 출력한다 (머리말·마크다운 금지).",
].join("\n");

export function createLlmReferenceCaptioner(
  config: { apiUrl: string; apiKey: string; model: string },
  readBytes: MediaBytesReader,
  fetchFn: typeof fetch = fetch,
): ReferenceCaptioner {
  return {
    name: `llm:${config.model}`,
    async caption(image) {
      const { bytes, contentType } = await readBytes(image);
      const response = await fetchFn(config.apiUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: CAPTION_SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: "이 레퍼런스 이미지를 서술하라." },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${contentType};base64,${bytes.toString("base64")}`,
                  },
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`reference captioning failed (${response.status})`);
      }
      const content = contentFromChatCompletion(await response.json());
      if (!content) {
        throw new Error("reference captioning returned no content");
      }
      return content.slice(0, CAPTION_MAX_LENGTH);
    },
  };
}
