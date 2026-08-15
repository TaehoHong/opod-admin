import {
  CAPTION_SET_JSON_SCHEMA,
  CAPTION_WRITER_SYSTEM_PROMPT,
} from "../../prompts/caption-writer";
import {
  LLM_LOG_TYPE,
  LlmLogContext,
} from "../domain/llm-logs/llm-log.service";
import { cleanHashtags } from "./content-planner";
import { PersonaEntry } from "./post-planner";
import { MediaBytesReader, ReferenceImage } from "./reference-captioner";
import { StrictJsonAgentClient } from "./strict-json-agent";
import { isRecord } from "./value-utils";

// V4 ⑥ 캡션 Agent — 생성 이미지를 보고 캡션·해시태그를 쓴다.
// 설계 정본 docs/post-creation-agent-architecture-v3.md §20.5.
export type CaptionWriterInput = {
  character: {
    name: string;
    bio: string;
    interests: string[];
    defaultContentLanguage: string;
  };
  persona: {
    characterContext: PersonaEntry[];
    writingProfile: { contentStyle: PersonaEntry[]; voice: PersonaEntry[] };
    boundaries: PersonaEntry[];
    additionalContext: PersonaEntry[];
  };
  memories: { type: string; content: string }[];
  recentPosts: {
    premise: string | null;
    caption: string;
    hashtags: string[];
  }[];
  postPlan: {
    intent: {
      premise: string;
      primaryPurpose: string;
      secondaryPurpose: string | null;
    };
  };
  // ImagePlan 컷 원문 — 요약 금지. 이미지와 계획 양쪽 근거 규칙의 텍스트 절반.
  shots: {
    sortOrder: number;
    visualPurpose: string;
    scene: string;
    lockedElements: string[];
    mediaId: string;
  }[];
  operatorRequest?: string;
  operatorNote?: string;
};

export type CaptionSet = {
  status: "ready";
  caption: string;
  captionLanguages: string[];
  hashtags: string[];
};

export type CaptionShotImage = {
  sortOrder: number;
  mediaId: string;
  media: ReferenceImage;
};

export class CaptionWriterAgent {
  constructor(
    private readonly client: StrictJsonAgentClient,
    private readonly readBytes: MediaBytesReader,
  ) {}

  async write(
    input: CaptionWriterInput,
    images: CaptionShotImage[],
    context?: LlmLogContext,
  ): Promise<{ output: CaptionSet; producerLogId: string | null }> {
    const result = await this.client.run({
      logType: LLM_LOG_TYPE.captionWriteV4,
      schemaName: "opod_caption_set_v1",
      schema: CAPTION_SET_JSON_SCHEMA as unknown as Record<string, unknown>,
      systemPrompt: CAPTION_WRITER_SYSTEM_PROMPT,
      input,
      userContent: await captionUserContent(input, images, this.readBytes),
      context,
    });
    return {
      output: parseCaptionSet(result.value),
      producerLogId: result.producerLogId,
    };
  }
}

// 텍스트 입력 + 컷별 생성 이미지(base64 image_url). 생성 이미지 평가가 쓰는
// 전송 형태와 같다 — 이미지는 실행 시점에만 읽고 저장하지 않는다.
export async function captionUserContent(
  input: CaptionWriterInput,
  images: CaptionShotImage[],
  readBytes: MediaBytesReader,
): Promise<unknown[]> {
  const blocks: unknown[] = [{ type: "text", text: JSON.stringify(input) }];
  for (const image of [...images].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const { bytes, contentType } = await readBytes(image.media);
    blocks.push(
      {
        type: "text",
        text: `Generated image for shot ${image.sortOrder} media ${image.mediaId}`,
      },
      {
        type: "image_url",
        image_url: {
          url: `data:${contentType};base64,${bytes.toString("base64")}`,
          detail: "high",
        },
      },
    );
  }
  return blocks;
}

export function parseCaptionSet(value: unknown): CaptionSet {
  if (!isRecord(value) || value.status !== "ready") {
    throw new Error("caption set has an invalid status");
  }
  exactKeys(
    value,
    ["status", "caption", "captionLanguages", "hashtags"],
    "caption set",
  );
  const captionLanguages = stringArray(
    value.captionLanguages,
    1,
    10,
    35,
    "captionLanguages",
  );
  for (const language of captionLanguages) {
    if (!isCanonicalLanguageTag(language))
      throw new Error(`caption language ${language} is not canonical BCP-47`);
  }
  if (!Array.isArray(value.hashtags))
    throw new Error("hashtags must be an array");
  const hashtags = cleanHashtags(value.hashtags);
  if (hashtags.length !== value.hashtags.length)
    throw new Error("hashtags are not normalized or unique");
  return {
    status: "ready",
    caption: requiredText(value.caption, 2_000, "caption"),
    captionLanguages,
    hashtags,
  };
}

function requiredText(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`${label} is invalid`);
  return value.trim();
}

function stringArray(
  value: unknown,
  min: number,
  max: number,
  itemMax: number,
  label: string,
): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    throw new Error(`${label} is invalid`);
  const result = value.map((item) => requiredText(item, itemMax, label));
  if (new Set(result).size !== result.length)
    throw new Error(`${label} has duplicates`);
  return result;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${label} has invalid fields`);
  }
}

function isCanonicalLanguageTag(value: string): boolean {
  try {
    return Intl.getCanonicalLocales(value)[0] === value;
  } catch {
    return false;
  }
}
