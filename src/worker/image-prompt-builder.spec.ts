import {
  buildImagePromptBuilderUserPrompt,
  imageModelFamily,
  modelFamilyGuidance,
} from "../../prompts/image-prompt-builder";
import {
  createLlmImagePromptBuilder,
  localImagePromptBuilder,
  parseBuiltImagePrompts,
  resolveImagePromptBuilder,
} from "./image-prompt-builder";

describe("imageModelFamily", () => {
  it("classifies fal model ids into prompt-syntax families", () => {
    expect(imageModelFamily("fal-ai/flux/dev")).toBe("flux");
    expect(imageModelFamily("fal-ai/nano-banana-pro/edit")).toBe("nano-banana");
    expect(imageModelFamily("fal-ai/gemini-2.5-flash-image")).toBe(
      "nano-banana",
    );
    expect(imageModelFamily("fal-ai/stable-diffusion-v35-large")).toBe(
      "stable-diffusion",
    );
    expect(imageModelFamily("fal-ai/fast-sdxl")).toBe("stable-diffusion");
    expect(imageModelFamily("fal-ai/some-unknown-model")).toBe("generic");
    expect(imageModelFamily(undefined)).toBe("generic");
  });

  it("gives distinct guidance per family", () => {
    expect(modelFamilyGuidance("fal-ai/flux/dev")).toContain("descriptive");
    expect(modelFamilyGuidance("fal-ai/flux/dev")).toContain(
      "weighting syntax",
    );
    expect(modelFamilyGuidance("fal-ai/fast-sdxl")).toContain(
      "comma-separated tag and keyword list",
    );
    expect(modelFamilyGuidance("fal-ai/flux/dev")).not.toEqual(
      modelFamilyGuidance("fal-ai/fast-sdxl"),
    );
  });
});

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
    expect(prompt).toContain("## Target image model\nfal-ai/flux/dev");
    // Flux 계열 표현 규칙이 함께 주입된다.
    expect(prompt).toContain("## Target model guidance");
    expect(prompt).toContain("weighting syntax");
    expect(prompt).toContain("young woman, short black hair");
    expect(prompt).toContain("film photography");
    expect(prompt).toContain("1. 한강 노을 산책");
    expect(prompt).toContain("2. 골목 카페");
    expect(prompt).toContain("the 2 shots");
  });

  it("injects the family-specific guidance for the target model", () => {
    const sdxl = buildImagePromptBuilderUserPrompt({
      targetModelId: "fal-ai/fast-sdxl",
      appearancePrompt: "a",
      stylePrompt: "b",
      scenes: ["장면"],
    });
    expect(sdxl).toContain("comma-separated tag and keyword list");
    expect(sdxl).not.toContain("Flux ignores");
  });

  it("marks missing model and prompts as unspecified", () => {
    const prompt = buildImagePromptBuilderUserPrompt({
      appearancePrompt: "",
      stylePrompt: " ",
      scenes: ["장면"],
    });
    expect(prompt).toContain("## Target image model\n(unspecified)");
    expect(prompt).toContain("## Character appearance prompt\n(none)");
    expect(prompt).toContain("## Style prompt (apply to every shot)\n(none)");
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
