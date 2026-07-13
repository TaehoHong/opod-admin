// 포스트 기획(content_plan) 단계. 페르소나·메모리·최근 캡션을 조립해 LLM에게
// 포스트 컨셉(캡션/해시태그/샷 리스트)을 구조화 출력으로 받는다.
// env(LLM_API_URL/LLM_API_KEY/LLM_MODEL, OpenAI-compatible chat completions)가
// 없으면 로컬 결정적 플래너로 대체된다 (개발/테스트용).

export type ContentPlanInput = {
  characterName: string;
  bio: string;
  interests: string[];
  // sortOrder 순으로 정렬된 활성 페르소나.
  personas: { title: string; content: string }[];
  memories: string[];
  // 소재 중복 방지용 최근 게시 캡션.
  recentCaptions: string[];
  // 수동 draft 생성 시 운영자가 준 장면 힌트.
  sceneHint?: string;
  maxShots?: number;
};

export type ContentPlan = {
  caption: string;
  hashtags: string[];
  shots: { scene: string }[];
};

export type ContentPlanner = {
  readonly name: string;
  plan(input: ContentPlanInput): Promise<ContentPlan>;
};

const HTTP_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_SHOTS = 2;
const SHOTS_HARD_CAP = 3;
const HASHTAG_MAX = 5;

type PlannerEnv = Record<string, string | undefined>;

export function createContentPlanner(
  env: PlannerEnv = process.env,
  fetchFn: typeof fetch = fetch,
): ContentPlanner {
  const apiUrl = env.LLM_API_URL?.trim();
  const apiKey = env.LLM_API_KEY?.trim();
  const model = env.LLM_MODEL?.trim();
  if (!apiUrl || !apiKey || !model) {
    return localContentPlanner;
  }
  return createLlmContentPlanner({ apiUrl, apiKey, model }, fetchFn);
}

// 개발용 결정적 플래너. LLM 없이도 파이프라인 전 구간이 돈다.
export const localContentPlanner: ContentPlanner = {
  name: "local",
  plan(input) {
    const subject = input.sceneHint?.trim() || input.interests[0] || "일상";
    const maxShots = clampShots(input.maxShots);
    const shots = Array.from({ length: maxShots }, (_, index) => ({
      scene:
        index === 0
          ? `${subject}의 한 장면`
          : `${subject}의 다른 각도, 디테일 컷`,
    }));
    return Promise.resolve({
      caption: `${subject} 기록 — ${input.characterName}의 하루`,
      hashtags: cleanHashtags([
        ...input.interests.slice(0, HASHTAG_MAX - 1),
        "일상",
      ]),
      shots,
    });
  },
};

export function createLlmContentPlanner(
  config: { apiUrl: string; apiKey: string; model: string },
  fetchFn: typeof fetch = fetch,
): ContentPlanner {
  return {
    name: `llm:${config.model}`,
    async plan(input) {
      const response = await fetchFn(config.apiUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: PLANNER_SYSTEM_PROMPT },
            { role: "user", content: buildPlannerUserPrompt(input) },
          ],
        }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`content planner LLM failed (${response.status})`);
      }
      const content = contentFromChatCompletion(await response.json());
      if (!content) {
        throw new Error("content planner LLM returned no content");
      }
      return parseContentPlan(content, clampShots(input.maxShots));
    },
  };
}

const PLANNER_SYSTEM_PROMPT = [
  "너는 AI 버추얼 인플루언서의 SNS 콘텐츠 기획자다.",
  "캐릭터 정보를 바탕으로 인스타그램 스타일 피드 포스트 1건을 기획한다.",
  "규칙:",
  "- 캐릭터의 확정 세계관(메모리)과 모순되는 장소·시점·사건을 만들지 않는다.",
  "- 최근 게시물과 소재가 겹치지 않게 한다.",
  "- shots의 scene은 이미지 생성 프롬프트로 쓸 수 있게 장면·구도·분위기를 구체적으로 쓴다 (인물 외모 묘사는 제외 — 별도 주입됨).",
  "- 캡션은 캐릭터의 말투로, 1~3문장.",
  "반드시 아래 JSON만 출력한다 (설명·마크다운 금지):",
  '{"caption": "...", "hashtags": ["태그1", "태그2"], "shots": [{"scene": "..."}]}',
].join("\n");

export function buildPlannerUserPrompt(input: ContentPlanInput): string {
  const sections = [
    `## 캐릭터\n이름: ${input.characterName}\n소개: ${input.bio}\n관심사: ${input.interests.join(", ") || "(없음)"}`,
  ];
  if (input.personas.length > 0) {
    sections.push(
      `## 페르소나\n${input.personas
        .map((persona) => `### ${persona.title}\n${persona.content}`)
        .join("\n")}`,
    );
  }
  if (input.memories.length > 0) {
    sections.push(
      `## 확정 세계관/메모리 (모순 금지)\n${input.memories
        .slice(0, 20)
        .map((memory) => `- ${memory}`)
        .join("\n")}`,
    );
  }
  if (input.recentCaptions.length > 0) {
    sections.push(
      `## 최근 게시물 캡션 (소재 중복 금지)\n${input.recentCaptions
        .slice(0, 20)
        .map((caption) => `- ${caption}`)
        .join("\n")}`,
    );
  }
  if (input.sceneHint?.trim()) {
    sections.push(`## 운영자 장면 힌트 (반영 필수)\n${input.sceneHint.trim()}`);
  }
  sections.push(
    `## 요청\n샷(이미지 컷) ${clampShots(input.maxShots)}개짜리 피드 포스트 1건을 기획하라.`,
  );
  return sections.join("\n\n");
}

// LLM 출력에서 JSON을 견고하게 추출·검증한다 (마크다운 펜스 허용).
export function parseContentPlan(raw: string, maxShots: number): ContentPlan {
  const text = raw.trim();
  const jsonText = text.startsWith("{")
    ? text
    : (text.match(/\{[\s\S]*\}/)?.[0] ?? "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("content plan is not valid JSON");
  }
  if (!isRecord(parsed) || typeof parsed.caption !== "string") {
    throw new Error("content plan is missing a caption");
  }
  const caption = parsed.caption.trim();
  if (!caption) {
    throw new Error("content plan is missing a caption");
  }
  const shots = (Array.isArray(parsed.shots) ? parsed.shots : [])
    .filter(
      (shot): shot is { scene: string } =>
        isRecord(shot) &&
        typeof shot.scene === "string" &&
        Boolean(shot.scene.trim()),
    )
    .map((shot) => ({ scene: shot.scene.trim() }))
    .slice(0, maxShots);
  if (shots.length === 0) {
    throw new Error("content plan has no usable shots");
  }
  return {
    caption,
    hashtags: cleanHashtags(
      Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
    ),
    shots,
  };
}

function cleanHashtags(values: unknown[]): string[] {
  const cleaned: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const tag = value.trim().replace(/^#+/, "").trim();
    if (tag && !cleaned.includes(tag)) {
      cleaned.push(tag);
    }
    if (cleaned.length >= HASHTAG_MAX) {
      break;
    }
  }
  return cleaned;
}

function clampShots(value: number | undefined): number {
  if (!value || !Number.isInteger(value) || value < 1) {
    return DEFAULT_MAX_SHOTS;
  }
  return Math.min(value, SHOTS_HARD_CAP);
}

function contentFromChatCompletion(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    return null;
  }
  const first = value.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) {
    return null;
  }
  const content = first.message.content;
  return typeof content === "string" && content.trim() ? content.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
