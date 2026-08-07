// 기획 평가 LLM 프롬프트 — 콘텐츠 플랜을 8차원 루브릭으로 심사한다.
// fetch·파싱·오케스트레이션은 src/worker/plan-evaluator.ts에 있다.
// 루브릭 버전·차원 정의·언어별 AI 티 패턴 팩은 전부 여기서 관리한다
// (docs/plan-prompt-evaluation-agent.md 4.1절, docs/prompt-research-log.md).

export const EVAL_RUBRIC_VERSION = "eval-rubric-v1";

export const PLAN_EVAL_DIMENSIONS = [
  "persona_fit",
  "voice_tone_fit",
  "ai_tell_free",
  "memory_continuity",
  "location_coherence",
  "shot_composition",
  "reference_usage",
  "caption_quality",
] as const;

export type PlanEvalDimension = (typeof PLAN_EVAL_DIMENSIONS)[number];

export type PlanEvaluationPromptInput = {
  // 캡션이 작성되어야 하는 언어 (BCP 47 소문자, Character.contentLanguage).
  contentLanguage: string;
  characterName: string;
  bio: string;
  interests: string[];
  personas: { title: string; content: string }[];
  memories: string[];
  // voice_tone_fit 비교 기준 — 이 캐릭터가 실제로 써 온 캡션.
  recentCaptions: string[];
  locationName?: string;
  plan: {
    caption: string;
    hashtags: string[];
    shots: {
      sortOrder: number;
      scene: string;
      captureSetup: string;
      characterVisible: boolean;
      referenceIds: string[];
      environmentReferenceIds?: string[];
    }[];
  };
};

// 언어별 AI 티 패턴 팩. 지원 언어를 추가할 때 이 팩만 늘리면 된다.
// 영어 팩 출처: Wikipedia AI Cleanup 체크리스트, LLM 과대표현 어휘 연구
// (docs/related-research.md 2절). 한국어 팩: humanize-korean 분류 축약.
const AI_TELL_PACKS: Record<string, string[]> = {
  en: [
    "Overused LLM vocabulary: delve, vibrant, tapestry, testament, elevate, unleash, embark, realm, journey (as metaphor), foster, boast, nestled.",
    "Rule-of-three phrasing (three parallel adjectives or clauses) used repeatedly.",
    "Formulaic intensifiers and closers: 'It's important to note', 'truly special', 'couldn't be happier', 'What a day!' endings.",
    "Overuse of em-dashes or semicolons in casual caption text.",
    "Promotional or press-release tone instead of a personal voice.",
    "Perfectly balanced, uniform sentence rhythm with no fragments or asymmetry a real person would produce.",
  ],
  ko: [
    "번역투 문형: '~에 의해', '~하는 것 같아요'의 남발, 영어 어순을 옮긴 듯한 문장.",
    "상투적 마무리 멘트: '너무 좋았어요! 다음에 또 올게요', '행복한 하루였습니다' 류의 정형화된 끝맺음.",
    "기계적 병렬 나열(셋씩 묶는 수식)과 균일한 문장 리듬.",
    "과도한 감탄사·이모지 반복 패턴이 페르소나 습관과 무관하게 등장.",
    "설명문 같은 격식체와 SNS 구어체가 어색하게 섞임.",
  ],
};

const AI_TELL_GENERIC: string[] = [
  "Mechanically parallel lists, uniform sentence rhythm, and formulaic openers/closers.",
  "Hashtag overload or hashtags that read like SEO keywords rather than the character's habit.",
  "A generic, could-be-anyone voice with none of the character's stated quirks.",
];

// 해당 언어 팩 + 공통 팩. 미지원 언어는 공통 팩만 쓴다.
export function aiTellPatterns(contentLanguage: string): string[] {
  const pack = AI_TELL_PACKS[contentLanguage.trim().toLowerCase()] ?? [];
  return [...pack, ...AI_TELL_GENERIC];
}

export const PLAN_EVALUATOR_SYSTEM_PROMPT = [
  "You are a strict quality judge for social media content plans written for AI virtual influencer characters.",
  "Evaluate the given plan against the character context, dimension by dimension.",
  "Dimensions:",
  "- persona_fit: the post's content and shots fit the character's world, interests, and daily context.",
  "- voice_tone_fit: the caption's voice and tone match the persona and the character's recent captions (formality, emoji habits, signature expressions). Judge in the post's content language.",
  "- ai_tell_free: the caption does NOT read like machine-generated text. Check against the 'AI-tell patterns' section; a clean caption scores high.",
  "- memory_continuity: the plan does not repeat recent post topics and does not contradict established memories.",
  "- location_coherence: place, time of day, and outfit stay coherent across the whole post.",
  "- shot_composition: shots form a varied, story-like sequence rather than near-duplicates.",
  "- reference_usage: identity/environment reference selection matches each shot's intent (references only on character-visible shots, environment refs only for the chosen location).",
  "- caption_quality: caption and hashtags are natural and platform-appropriate for the content language.",
  "Scoring: for each dimension, first reason briefly, then give an integer score 1-5 (5 = excellent, 3 = acceptable with issues, 1 = must fix).",
  "Also list concrete issues (each tied to a dimension) and actionable suggestions.",
  "Write reasons, issues, and suggestions in Korean (operator-facing), quoting problematic caption text verbatim in its original language.",
  "Return only the JSON below, with no explanation or Markdown:",
  '{"scores": {"persona_fit": {"score": 4, "reason": "..."}, "voice_tone_fit": {"score": 3, "reason": "..."}, "ai_tell_free": {"score": 2, "reason": "..."}, "memory_continuity": {"score": 5, "reason": "..."}, "location_coherence": {"score": 4, "reason": "..."}, "shot_composition": {"score": 4, "reason": "..."}, "reference_usage": {"score": 5, "reason": "..."}, "caption_quality": {"score": 3, "reason": "..."}}, "issues": [{"dimension": "ai_tell_free", "detail": "..."}], "suggestions": ["..."]}',
].join("\n");

export function buildPlanEvaluatorUserPrompt(
  input: PlanEvaluationPromptInput,
): string {
  const sections = [
    `## Character\nName: ${input.characterName}\nBio: ${input.bio}\nInterests: ${input.interests.join(", ") || "(none)"}\nContent language of captions: ${input.contentLanguage}`,
  ];
  if (input.personas.length > 0) {
    sections.push(
      `## Personas\n${input.personas
        .map((persona) => `### ${persona.title}\n${persona.content}`)
        .join("\n")}`,
    );
  }
  if (input.memories.length > 0) {
    sections.push(
      `## Established world and memories\n${input.memories
        .slice(0, 20)
        .map((memory) => `- ${memory}`)
        .join("\n")}`,
    );
  }
  if (input.recentCaptions.length > 0) {
    sections.push(
      `## Recent captions by this character (voice/tone baseline; also check topic repetition)\n${input.recentCaptions
        .slice(0, 10)
        .map((caption) => `- ${caption}`)
        .join("\n")}`,
    );
  }
  sections.push(
    `## AI-tell patterns for "${input.contentLanguage}" (ai_tell_free dimension)\n${aiTellPatterns(
      input.contentLanguage,
    )
      .map((pattern) => `- ${pattern}`)
      .join("\n")}`,
  );
  const shots = input.plan.shots
    .map((shot) =>
      [
        `### Shot ${shot.sortOrder}`,
        `Scene: ${shot.scene}`,
        `Capture setup: ${shot.captureSetup}`,
        `Character visible: ${shot.characterVisible ? "yes" : "no"}`,
        `Identity references: ${shot.referenceIds.length}`,
        `Environment references: ${(shot.environmentReferenceIds ?? []).length}`,
      ].join("\n"),
    )
    .join("\n\n");
  sections.push(
    [
      "## Plan under evaluation",
      `Caption: ${input.plan.caption}`,
      `Hashtags: ${input.plan.hashtags.map((tag) => `#${tag}`).join(" ") || "(none)"}`,
      `Location: ${input.locationName ?? "(none)"}`,
      "",
      shots,
    ].join("\n"),
  );
  sections.push(
    "## Request\nEvaluate every dimension and return the JSON verdict.",
  );
  return sections.join("\n\n");
}
