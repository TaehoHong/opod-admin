// 이미지 프롬프트 정적 린트 (Layer 1) — LLM 없이 결정적으로 잡히는 결함을
// 검출한다. 순수 함수만 두고 상태·IO를 갖지 않는다.
// docs/image-prompt-evaluation-agent.md 3절. 심사(Layer 2)는
// src/worker/prompt-evaluator.ts가 이 결과를 참고 정보로 받는다.

export type PromptLintShot = {
  sortOrder: number;
  characterVisible: boolean;
  prompt: string;
};

export type PromptLintIssue = {
  rule:
    | "korean_residue"
    | "unmanned_person_leak"
    | "meta_leak"
    | "duplicate_prompt"
    | "length_bounds";
  detail: string;
};

// 무인 컷(characterVisible=false)에 남으면 안 되는 인물 어휘.
// 레퍼런스 정책(무인 컷 인물 묘사 금지)의 프롬프트 층 재검증이다.
const PERSON_TERMS = [
  "woman",
  "man",
  "girl",
  "boy",
  "she",
  "her",
  "he",
  "his",
  "person",
  "people",
  "face",
  "selfie",
  "portrait",
  "influencer",
];

// scene에 촬영 과정이 피사체로 누출됐는지 보는 문구 사전. "camera angle"처럼
// 시점 표현으로 정당한 단어는 제외하고 문구 단위로만 잡는다.
const META_LEAK_PHRASES = [
  "photographer",
  "behind the camera",
  "holding the camera",
  "taking the photo",
  "taking a photo of her",
  "taking a photo of him",
  "off-frame",
  "off frame",
  "camera operator",
];

const MIN_WORDS = 8;
const MAX_WORDS = 350;

export function lintPromptShot(shot: PromptLintShot): PromptLintIssue[] {
  const issues: PromptLintIssue[] = [];
  const prompt = shot.prompt.trim();
  if (!prompt) {
    return [{ rule: "length_bounds", detail: "프롬프트가 비어 있습니다" }];
  }
  if (/[가-힣]/.test(prompt)) {
    issues.push({
      rule: "korean_residue",
      detail: "영어 프롬프트에 한글이 남아 있습니다",
    });
  }
  if (!shot.characterVisible) {
    const lower = prompt.toLowerCase();
    const leaked = PERSON_TERMS.filter((term) =>
      new RegExp(`\\b${term}\\b`).test(lower),
    );
    if (leaked.length > 0) {
      issues.push({
        rule: "unmanned_person_leak",
        detail: `무인 컷에 인물 어휘가 남아 있습니다: ${leaked.join(", ")}`,
      });
    }
  }
  {
    const lower = prompt.toLowerCase();
    const leaked = META_LEAK_PHRASES.filter((phrase) => lower.includes(phrase));
    if (leaked.length > 0) {
      issues.push({
        rule: "meta_leak",
        detail: `촬영 과정 메타가 피사체로 누출됐습니다: ${leaked.join(", ")}`,
      });
    }
  }
  const words = prompt.split(/\s+/).length;
  if (words < MIN_WORDS) {
    issues.push({
      rule: "length_bounds",
      detail: `프롬프트가 너무 짧습니다 (${words} words < ${MIN_WORDS})`,
    });
  } else if (words > MAX_WORDS) {
    issues.push({
      rule: "length_bounds",
      detail: `프롬프트가 너무 깁니다 (${words} words > ${MAX_WORDS})`,
    });
  }
  return issues;
}

// 전 컷 린트 + 컷 간 중복 검사. sortOrder → issues 맵을 돌려준다.
export function lintPromptShots(
  shots: PromptLintShot[],
): Map<number, PromptLintIssue[]> {
  const result = new Map<number, PromptLintIssue[]>(
    shots.map((shot) => [shot.sortOrder, lintPromptShot(shot)]),
  );
  const normalized = new Map<string, number>();
  for (const shot of shots) {
    const key = shot.prompt.trim().toLowerCase().replace(/\s+/g, " ");
    if (!key) {
      continue;
    }
    const first = normalized.get(key);
    if (first === undefined) {
      normalized.set(key, shot.sortOrder);
      continue;
    }
    result.get(shot.sortOrder)?.push({
      rule: "duplicate_prompt",
      detail: `shot ${first}과(와) 프롬프트가 사실상 동일합니다`,
    });
  }
  return result;
}
