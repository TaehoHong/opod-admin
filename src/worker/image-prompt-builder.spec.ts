import { buildImagePromptBuilderUserPrompt } from "../../prompts/image-prompt-builder";
import {
  createLlmImagePromptBuilder,
  localImagePromptBuilder,
  parseBuiltImagePrompts,
  resolveImagePromptBuilder,
} from "./image-prompt-builder";

describe("resolveImagePromptBuilder", () => {
  it("falls back to the local builder without LLM settings", () => {
    expect(resolveImagePromptBuilder({}).name).toBe("local");
    expect(
      resolveImagePromptBuilder({ apiUrl: "https://llm.local", apiKey: "k" })
        .name,
    ).toBe("local");
  });

  it("creates an LLM builder with full settings", () => {
    expect(
      resolveImagePromptBuilder({
        apiUrl: "https://llm.local",
        apiKey: "k",
        model: "test-model",
      }).name,
    ).toBe("llm:test-model");
  });
});

describe("localImagePromptBuilder", () => {
  it("compiles appearance, scene, style per shot deterministically", async () => {
    const built = await localImagePromptBuilder.build({
      appearancePrompt: "same face",
      stylePrompt: "film grain",
      shots: [{ scene: "성수동 산책" }, { scene: "카페 창가" }],
    });
    expect(built.prompts).toEqual([
      "same face, 성수동 산책, film grain",
      "same face, 카페 창가, film grain",
    ]);
  });
});

describe("buildImagePromptBuilderUserPrompt", () => {
  it("includes model, appearance, style, and numbered scenes", () => {
    const prompt = buildImagePromptBuilderUserPrompt({
      targetModelId: "fal-ai/flux/dev",
      appearancePrompt: "young woman, short black hair",
      stylePrompt: "film photography",
      scenes: ["한강 노을 산책", "골목 카페"],
    });
    expect(prompt).toContain("## 대상 이미지 모델\nfal-ai/flux/dev");
    expect(prompt).toContain("young woman, short black hair");
    expect(prompt).toContain("film photography");
    expect(prompt).toContain("1. 한강 노을 산책");
    expect(prompt).toContain("2. 골목 카페");
    expect(prompt).toContain("컷 2개");
  });

  it("marks missing model and prompts as unspecified", () => {
    const prompt = buildImagePromptBuilderUserPrompt({
      appearancePrompt: "",
      stylePrompt: " ",
      scenes: ["장면"],
    });
    expect(prompt).toContain("## 대상 이미지 모델\n(미지정)");
    expect(prompt).toContain("## 캐릭터 외모 프롬프트 (모든 컷 유지)\n(없음)");
    expect(prompt).toContain("## 스타일 프롬프트 (모든 컷 반영)\n(없음)");
  });
});

describe("parseBuiltImagePrompts", () => {
  it("parses prompts and tolerates markdown fences", () => {
    const raw = [
      "```json",
      JSON.stringify({ shots: [{ prompt: "a" }, { prompt: "b" }] }),
      "```",
    ].join("\n");
    expect(parseBuiltImagePrompts(raw, 2)).toEqual(["a", "b"]);
  });

  it("rejects a shot-count mismatch", () => {
    expect(() =>
      parseBuiltImagePrompts(JSON.stringify({ shots: [{ prompt: "a" }] }), 2),
    ).toThrow("image prompt builder returned 1 prompt(s) for 2 shot(s)");
  });

  it("rejects empty prompts", () => {
    expect(() =>
      parseBuiltImagePrompts(
        JSON.stringify({ shots: [{ prompt: "a" }, { prompt: " " }] }),
        2,
      ),
    ).toThrow("image prompt builder returned an empty prompt");
  });

  it("rejects non-JSON output", () => {
    expect(() => parseBuiltImagePrompts("영어로 번역해드릴게요", 1)).toThrow(
      "built image prompts are not valid JSON",
    );
  });

  it("rejects JSON without a shots array", () => {
    expect(() =>
      parseBuiltImagePrompts(JSON.stringify({ prompts: ["a"] }), 1),
    ).toThrow("built image prompts are missing shots");
  });
});

describe("createLlmImagePromptBuilder", () => {
  const input = {
    appearancePrompt: "young woman, short black hair",
    stylePrompt: "film photography",
    shots: [{ scene: "한강 노을 산책" }, { scene: "골목 카페" }],
  };

  it("calls the chat completions API and parses built prompts", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  shots: [
                    { prompt: "sunset walk along the Han river" },
                    { prompt: "alley cafe window seat" },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const builder = createLlmImagePromptBuilder(
      {
        apiUrl: "https://llm.local/v1",
        apiKey: "k",
        model: "m",
        targetModelId: "fal-ai/flux/dev",
      },
      fetchMock,
    );

    await expect(builder.build(input)).resolves.toEqual({
      prompts: ["sunset walk along the Han river", "alley cafe window seat"],
    });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://llm.local/v1");
    const body = JSON.parse(options.body);
    expect(body.model).toBe("m");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].content).toContain("fal-ai/flux/dev");
    expect(body.messages[1].content).toContain("1. 한강 노을 산책");
  });

  it("throws on an HTTP error", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(new Response("oops", { status: 500 }));
    const builder = createLlmImagePromptBuilder(
      { apiUrl: "https://llm.local/v1", apiKey: "k", model: "m" },
      fetchMock,
    );
    await expect(builder.build(input)).rejects.toThrow(
      "image prompt builder LLM failed (500)",
    );
  });
});
