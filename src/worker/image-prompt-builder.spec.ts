import {
  IMAGE_PROMPT_BUILDER_SYSTEM_PROMPT,
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
      shots: [
        {
          sortOrder: 0,
          scene: "성수동 산책",
          captureSetup: "친구가 눈높이에서 촬영",
          characterVisible: true,
        },
        {
          sortOrder: 1,
          scene: "카페 창가",
          captureSetup: "창틀 위 고정 카메라",
          characterVisible: true,
        },
      ],
    });
    expect(built.prompts).toEqual([
      "same face, Final image content: 성수동 산책. Use a physically plausible camera viewpoint consistent with the final-frame scene; do not add any off-frame photographer or capture equipment, film grain",
      "same face, Final image content: 카페 창가. Use a physically plausible camera viewpoint consistent with the final-frame scene; do not add any off-frame photographer or capture equipment, film grain",
    ]);
  });

  it("omits character appearance from shots where the character is not visible", async () => {
    const built = await localImagePromptBuilder.build({
      appearancePrompt: "young woman, short black hair",
      stylePrompt: "film grain",
      shots: [
        {
          sortOrder: 0,
          scene: "사람이 없는 철길과 노을",
          captureSetup: "촬영자는 눈높이에서 프레임 밖에 있음",
          characterVisible: false,
        },
      ],
    } as never);

    expect(built.prompts[0]).not.toContain("young woman");
    expect(built.prompts[0]).toContain("사람이 없는 철길과 노을");
    expect(built.prompts[0]).not.toContain(
      "촬영자는 눈높이에서 프레임 밖에 있음",
    );
    expect(built.prompts[0]).toContain(
      "the character, photographer, hands, body, and capture equipment remain entirely outside the frame",
    );
  });
});

describe("buildImagePromptBuilderUserPrompt", () => {
  it("tells the builder to omit non-visual location metadata", () => {
    expect(IMAGE_PROMPT_BUILDER_SYSTEM_PROMPT).toContain(
      "Keep location wording limited to details that can change the visible pixels",
    );
    expect(IMAGE_PROMPT_BUILDER_SYSTEM_PROMPT).toContain(
      "a spacious gym lined with strength-training machines",
    );
  });

  it("includes model, appearance, style, and numbered scenes", () => {
    const prompt = buildImagePromptBuilderUserPrompt({
      appearancePrompt: "young woman, short black hair",
      stylePrompt: "film photography",
      shots: [
        {
          sortOrder: 0,
          scene: "한강 노을 산책",
          captureSetup: "친구가 눈높이에서 촬영",
          characterVisible: true,
          targetModelId: "fal-ai/flux/dev",
        },
        {
          sortOrder: 1,
          scene: "골목 카페",
          captureSetup: "테이블 위 고정 카메라",
          characterVisible: true,
          targetModelId: "fal-ai/flux/dev",
        },
      ],
    });
    expect(prompt).toContain("Target image model: fal-ai/flux/dev");
    // Flux 계열 표현 규칙이 함께 주입된다.
    expect(prompt).toContain("Target model guidance");
    expect(prompt).toContain("weighting syntax");
    expect(prompt).toContain("young woman, short black hair");
    expect(prompt).toContain("film photography");
    expect(prompt).toContain("Final-frame scene: 한강 노을 산책");
    expect(prompt).toContain("Final-frame scene: 골목 카페");
    expect(prompt).toContain("the 2 shots");
  });

  it("injects the family-specific guidance for the target model", () => {
    const sdxl = buildImagePromptBuilderUserPrompt({
      appearancePrompt: "a",
      stylePrompt: "b",
      shots: [
        {
          sortOrder: 0,
          scene: "장면",
          captureSetup: "눈높이 촬영",
          characterVisible: true,
          targetModelId: "fal-ai/fast-sdxl",
        },
      ],
    });
    expect(sdxl).toContain("comma-separated tag and keyword list");
    expect(sdxl).not.toContain("Flux ignores");
  });

  it("marks a hidden-character shot and does not attach appearance to it", () => {
    const prompt = buildImagePromptBuilderUserPrompt({
      appearancePrompt: "young woman, short black hair",
      stylePrompt: "film photography",
      shots: [
        {
          sortOrder: 0,
          scene: "사람이 없는 철길과 노을",
          captureSetup: "촬영자는 프레임 밖에서 눈높이로 촬영",
          characterVisible: false,
          targetModelId: "fal-ai/nano-banana-pro",
        },
      ],
    } as never);

    expect(prompt).toContain("Character visible in final frame: no");
    expect(prompt).toContain("사람이 없는 철길과 노을");
    expect(prompt).toContain("촬영자는 프레임 밖에서 눈높이로 촬영");
    expect(prompt).toContain("Appearance to use in this shot: (none)");
  });

  it("marks missing model and prompts as unspecified", () => {
    const prompt = buildImagePromptBuilderUserPrompt({
      appearancePrompt: "",
      stylePrompt: " ",
      shots: [
        {
          sortOrder: 0,
          scene: "장면",
          captureSetup: "눈높이 촬영",
          characterVisible: true,
        },
      ],
    });
    expect(prompt).toContain("Target image model: (unspecified)");
    expect(prompt).toContain("Appearance to use in this shot: (none)");
    expect(prompt).toContain(
      "## Style defaults (apply only when compatible with the shot)\n(none)",
    );
  });
});

describe("parseBuiltImagePrompts", () => {
  it("parses prompts and tolerates markdown fences", () => {
    const raw = [
      "```json",
      JSON.stringify({
        shots: [
          { sortOrder: 0, prompt: "a" },
          { sortOrder: 1, prompt: "b" },
        ],
      }),
      "```",
    ].join("\n");
    expect(parseBuiltImagePrompts(raw, 2)).toEqual(["a", "b"]);
  });

  it("rejects a shot-count mismatch", () => {
    expect(() =>
      parseBuiltImagePrompts(
        JSON.stringify({ shots: [{ sortOrder: 0, prompt: "a" }] }),
        2,
      ),
    ).toThrow("image prompt builder returned 1 prompt(s) for 2 shot(s)");
  });

  it("rejects empty prompts", () => {
    expect(() =>
      parseBuiltImagePrompts(
        JSON.stringify({
          shots: [
            { sortOrder: 0, prompt: "a" },
            { sortOrder: 1, prompt: " " },
          ],
        }),
        2,
      ),
    ).toThrow("image prompt builder returned an empty prompt");
  });

  it("rejects reordered prompt-builder output", () => {
    expect(() =>
      parseBuiltImagePrompts(
        JSON.stringify({
          shots: [
            { sortOrder: 1, prompt: "second" },
            { sortOrder: 0, prompt: "first" },
          ],
        }),
        2,
      ),
    ).toThrow("image prompt builder shot 0 has invalid sortOrder");
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
    shots: [
      {
        sortOrder: 0,
        scene: "한강 노을 산책",
        captureSetup: "친구가 눈높이에서 촬영",
        characterVisible: true,
        targetModelId: "fal-ai/flux/dev",
      },
      {
        sortOrder: 1,
        scene: "골목 카페",
        captureSetup: "테이블 위 고정 카메라",
        characterVisible: true,
        targetModelId: "fal-ai/flux/dev",
      },
    ],
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
                    {
                      sortOrder: 0,
                      prompt: "sunset walk along the Han river",
                    },
                    { sortOrder: 1, prompt: "alley cafe window seat" },
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
        targetModelIds: {
          t2i: "fal-ai/flux/dev",
          edit: "fal-ai/nano-banana-pro/edit",
        },
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
    expect(body.messages[1].content).toContain(
      "Final-frame scene: 한강 노을 산책",
    );
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
