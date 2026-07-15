import {
  buildPlannerUserPrompt,
  createContentPlanner,
  createLlmContentPlanner,
  localContentPlanner,
  parseContentPlan,
} from "./content-planner";

describe("createContentPlanner", () => {
  it("falls back to the local planner without LLM env", () => {
    expect(createContentPlanner({}).name).toBe("local");
  });

  it("uses the LLM planner when env is configured", () => {
    const planner = createContentPlanner({
      LLM_API_URL: "https://llm.local/v1/chat/completions",
      LLM_API_KEY: "key",
      LLM_MODEL: "test-model",
    });
    expect(planner.name).toBe("llm:test-model");
  });
});

describe("localContentPlanner", () => {
  it("produces a deterministic plan from the scene hint", async () => {
    const plan = await localContentPlanner.plan({
      characterName: "한소이",
      bio: "필름 사진",
      interests: ["필름사진", "여행"],
      personas: [],
      memories: [],
      recentCaptions: [],
      sceneHint: "애월 해변 산책",
      maxShots: 2,
    });
    expect(plan.caption).toContain("애월 해변 산책");
    expect(plan.shots).toHaveLength(2);
    expect(plan.hashtags).toContain("필름사진");
  });
});

describe("buildPlannerUserPrompt", () => {
  it("assembles personas, memories, and recent captions", () => {
    const prompt = buildPlannerUserPrompt({
      characterName: "한소이",
      bio: "필름 사진과 감성 여행",
      interests: ["필름사진"],
      personas: [{ title: "말투", content: "차분한 존댓말" }],
      memories: ["제주 애월에 다녀옴 (2026-07)"],
      recentCaptions: ["지난주 흑백 필름 현상소 방문기"],
      sceneHint: "노을 골목",
    });
    expect(prompt).toContain("### 말투");
    expect(prompt).toContain("- 제주 애월에 다녀옴 (2026-07)");
    expect(prompt).toContain("- 지난주 흑백 필름 현상소 방문기");
    expect(prompt).toContain("노을 골목");
  });
});

describe("parseContentPlan", () => {
  it("parses plain JSON output", () => {
    const plan = parseContentPlan(
      JSON.stringify({
        caption: "노을이 예뻤던 날",
        hashtags: ["#필름사진", "여행", "필름사진"],
        shots: [
          { scene: "해변 역광 실루엣" },
          { scene: "필름 카메라 클로즈업" },
        ],
      }),
      2,
    );
    expect(plan.caption).toBe("노을이 예뻤던 날");
    // # 제거 + 중복 제거
    expect(plan.hashtags).toEqual(["필름사진", "여행"]);
    expect(plan.shots).toHaveLength(2);
  });

  it("extracts JSON from a fenced markdown block and clamps shots", () => {
    const raw = [
      "```json",
      JSON.stringify({
        caption: "c",
        hashtags: [],
        shots: [{ scene: "a" }, { scene: "b" }, { scene: "c" }, { scene: "d" }],
      }),
      "```",
    ].join("\n");
    const plan = parseContentPlan(raw, 3);
    expect(plan.shots).toHaveLength(3);
  });

  it("keeps only catalog reference ids, deduped and capped at 3", () => {
    const plan = parseContentPlan(
      JSON.stringify({
        caption: "c",
        hashtags: [],
        shots: [
          {
            scene: "장면",
            // 환각 id(ghost)와 중복은 걸러지고 3개까지만 남는다.
            referenceIds: ["r1", "ghost", "r2", "r2", "r3", "r4"],
          },
        ],
      }),
      1,
      ["r1", "r2", "r3", "r4"],
    );
    expect(plan.shots[0].referenceIds).toEqual(["r1", "r2", "r3"]);
  });

  it("returns empty referenceIds without a catalog", () => {
    const plan = parseContentPlan(
      JSON.stringify({
        caption: "c",
        hashtags: [],
        shots: [{ scene: "장면", referenceIds: ["r1"] }],
      }),
      1,
    );
    expect(plan.shots[0].referenceIds).toEqual([]);
  });

  it("rejects output without usable shots", () => {
    expect(() =>
      parseContentPlan(JSON.stringify({ caption: "c", shots: [] }), 2),
    ).toThrow("content plan has no usable shots");
  });

  it("rejects non-JSON output", () => {
    expect(() => parseContentPlan("죄송하지만 기획을 도와드릴게요", 2)).toThrow(
      "content plan is not valid JSON",
    );
  });
});

describe("createLlmContentPlanner", () => {
  const input = {
    characterName: "한소이",
    bio: "필름 사진",
    interests: [],
    personas: [],
    memories: [],
    recentCaptions: [],
  };

  it("calls the chat completions API and parses the plan", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  caption: "골목 산책",
                  hashtags: ["산책"],
                  shots: [{ scene: "골목길 오후 빛" }],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const planner = createLlmContentPlanner(
      { apiUrl: "https://llm.local/v1", apiKey: "k", model: "m" },
      fetchMock,
    );

    await expect(planner.plan(input)).resolves.toMatchObject({
      caption: "골목 산책",
      shots: [{ scene: "골목길 오후 빛" }],
    });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://llm.local/v1");
    const body = JSON.parse(options.body);
    expect(body.model).toBe("m");
    expect(body.messages[0].role).toBe("system");
  });

  it("throws on a failed LLM response", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(new Response("nope", { status: 500 }));
    const planner = createLlmContentPlanner(
      { apiUrl: "https://llm.local/v1", apiKey: "k", model: "m" },
      fetchMock,
    );

    await expect(planner.plan(input)).rejects.toThrow(
      "content planner LLM failed (500)",
    );
  });
});
