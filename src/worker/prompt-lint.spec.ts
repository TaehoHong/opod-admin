import { lintPromptShot, lintPromptShots } from "./prompt-lint";

// 린트가 놓치면 정책 위반 프롬프트가 그대로 provider로 가거나 LLM 심사
// 비용이 낭비된다 — 검출 규칙 자체가 보호 대상 행동이다.
describe("lintPromptShot", () => {
  const clean =
    "A sunlit cafe table by the window, iced latte in a tall glass, soft morning light, shallow depth of field, phone-camera framing from a seated position";

  it("깨끗한 프롬프트는 통과한다", () => {
    expect(
      lintPromptShot({ sortOrder: 0, characterVisible: true, prompt: clean }),
    ).toEqual([]);
  });

  it("한글 잔존을 검출한다", () => {
    const issues = lintPromptShot({
      sortOrder: 0,
      characterVisible: true,
      prompt: `${clean} 카페 창가`,
    });
    expect(issues.map((issue) => issue.rule)).toContain("korean_residue");
  });

  it("무인 컷의 인물 어휘 잔존을 검출한다", () => {
    const issues = lintPromptShot({
      sortOrder: 0,
      characterVisible: false,
      prompt:
        "A young woman holding an iced latte by the window, warm sunlight across the wooden table",
    });
    expect(issues.map((issue) => issue.rule)).toContain(
      "unmanned_person_leak",
    );
  });

  it("인물 컷에서는 인물 어휘를 허용한다", () => {
    const issues = lintPromptShot({
      sortOrder: 0,
      characterVisible: true,
      prompt:
        "A young woman holding an iced latte by the window, warm sunlight across the wooden table",
    });
    expect(issues).toEqual([]);
  });

  it("촬영 과정 메타 누출을 검출한다", () => {
    const issues = lintPromptShot({
      sortOrder: 0,
      characterVisible: true,
      prompt: `${clean}, a photographer taking the photo from behind the camera`,
    });
    expect(issues.map((issue) => issue.rule)).toContain("meta_leak");
  });

  it("빈/과소 프롬프트를 거절한다", () => {
    expect(
      lintPromptShot({ sortOrder: 0, characterVisible: true, prompt: " " }),
    ).toEqual([
      expect.objectContaining({ rule: "length_bounds" }),
    ]);
    const short = lintPromptShot({
      sortOrder: 0,
      characterVisible: true,
      prompt: "a cafe table",
    });
    expect(short.map((issue) => issue.rule)).toContain("length_bounds");
  });
});

describe("lintPromptShots", () => {
  it("컷 간 사실상 동일한 프롬프트를 중복으로 표시한다", () => {
    const prompt =
      "A sunlit cafe table by the window, iced latte in a tall glass, soft morning light, cinematic depth";
    const result = lintPromptShots([
      { sortOrder: 0, characterVisible: true, prompt },
      { sortOrder: 1, characterVisible: true, prompt: `  ${prompt.toUpperCase()}  ` },
    ]);
    expect(result.get(0)).toEqual([]);
    expect(result.get(1)?.map((issue) => issue.rule)).toContain(
      "duplicate_prompt",
    );
  });
});
