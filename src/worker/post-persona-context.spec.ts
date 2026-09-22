import {
  projectPostPersonaContext,
  StoredPostPersona,
} from "./post-persona-context";

const fragment = (
  id: string,
  content: string,
  kind: string,
  injection: string,
  recallKeys: string[] = [],
) => ({ id, content, kind, injection, recallKeys, canonIds: [] });
const source = (
  fragments: NonNullable<StoredPostPersona["fragments"]>,
): StoredPostPersona => ({
  id: "source",
  schemaVersion: 2,
  title: "Full persona",
  content: fragments.map((item) => item.content).join(""),
  fragments,
});
const base = { query: "", bio: "", interests: [], memories: [] };

describe("post persona context", () => {
  it("uses explicit recall cues and preserves Canon provenance without injecting its excluded source", () => {
    const result = projectPostPersonaContext({
      ...base,
      query: "강릉에서 보낸 하루",
      personas: [
        source([
          fragment("identity", "꽃집에서 일한다.", "identity", "always"),
          fragment(
            "relevant",
            "엄마와 자주 연락한다.",
            "relationship",
            "retrieved",
            ["강릉"],
          ),
          fragment("unrelated", "등산 취향.", "judgment", "retrieved", [
            "등산",
          ]),
          {
            ...fragment(
              "linked",
              "Canon으로 옮긴 원문.",
              "relationship",
              "never_prompt",
              ["강릉"],
            ),
            canonIds: ["canon"],
          },
          fragment("example", "등산 예시.", "example", "always"),
        ]),
      ],
      memories: [
        {
          sourceId: "canon",
          type: "event",
          content: "강릉을 방문했다.",
          injection: "retrieved",
          recallKeys: ["강릉"],
          occurredAt: "2026-09-01T00:00:00.000Z",
          personaSources: [{ sourceId: "source", fragmentId: "linked" }],
        },
        {
          sourceId: "unrelated-canon",
          type: "event",
          content: "등산했다.",
          injection: "retrieved",
          recallKeys: ["등산"],
          personaSources: [{ sourceId: "source", fragmentId: "linked" }],
        },
      ],
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("invalid fixture");
    expect(result.personas.map((item) => item.fragmentId)).toEqual([
      "identity",
      "relevant",
      "example",
    ]);
    expect(result.memories).toEqual([
      expect.objectContaining({
        sourceId: "canon",
        occurredAt: "2026-09-01T00:00:00.000Z",
        personaSources: [{ sourceId: "source", fragmentId: "linked" }],
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("Canon으로 옮긴 원문");
  });

  it("seeds autonomous recall from stable context, never from examples or retrieved text", () => {
    const personas = [
      source([
        fragment(
          "motivation",
          "꽃집 일을 배우고 싶다.",
          "motivation",
          "always",
        ),
        fragment(
          "flower",
          "꽃집에서는 급하게 결정하지 않는다.",
          "judgment",
          "retrieved",
          ["꽃집"],
        ),
        fragment("example", "등산 사진 예시.", "example", "always"),
        fragment("mountain", "등산 기록.", "tension", "retrieved", ["등산"]),
      ]),
    ];
    const result = projectPostPersonaContext({ ...base, personas });
    if (result.status !== "ready") throw new Error("invalid fixture");
    expect(result.personas.map((item) => item.fragmentId)).toEqual([
      "motivation",
      "flower",
      "example",
    ]);
    const requested = projectPostPersonaContext({
      ...base,
      personas,
      query: "바다 사진",
    });
    if (requested.status !== "ready") throw new Error("invalid fixture");
    expect(requested.personas.map((item) => item.fragmentId)).toEqual([
      "motivation",
      "example",
    ]);
  });

  it("keeps unstructured v1 text and its recent legacy memories without inventing roles", () => {
    const personas = [{ title: "voice", content: "짧게 말한다." }];
    const memories = Array.from({ length: 21 }, (_, i) => ({
      type: "fact",
      content: `memory ${i}`,
    }));
    expect(projectPostPersonaContext({ ...base, personas, memories })).toEqual({
      status: "ready",
      hasV2: false,
      personas,
      memories: memories.slice(0, 20),
    });
  });

  it("does not use a structured v1 example as an autonomous recall cue", () => {
    const example = source([
      fragment("example", "등산 사진 예시.", "example", "always"),
      fragment("mountain", "등산 기록.", "lore", "retrieved", ["등산"]),
    ]);
    const result = projectPostPersonaContext({
      ...base,
      personas: [{ ...example, schemaVersion: 1, title: "identity" }],
    });
    if (result.status !== "ready") throw new Error("invalid fixture");
    expect(result.personas.map((item) => item.fragmentId)).toEqual(["example"]);
  });

  it("does not fall back to raw source text when stored fragments are incomplete", () => {
    const persona = source([
      fragment("identity", "공개 정보.", "identity", "always"),
    ]);
    expect(
      projectPostPersonaContext({
        ...base,
        personas: [{ ...persona, content: "공개 정보.누락된 비공개 정보." }],
      }),
    ).toEqual({ status: "invalid" });
  });
});
