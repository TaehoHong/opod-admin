import {
  buildPlannerUserPrompt,
  PLANNER_SYSTEM_PROMPT,
} from "../../prompts/content-planner";
import {
  createLlmContentPlanner,
  parseContentPlan,
  resolveContentPlanner,
} from "./content-planner";

describe("resolveContentPlanner", () => {
  it("rejects planning without complete provider settings", async () => {
    const planner = resolveContentPlanner({});
    expect(planner.name).toBe("unconfigured");
    await expect(
      planner.plan({
        characterName: "한소이",
        bio: "필름 사진",
        interests: [],
        personas: [],
        memories: [],
        recentCaptions: [],
      }),
    ).rejects.toThrow("content planner LLM is not configured");
  });

  it("uses the LLM planner when provider settings are configured", () => {
    const planner = resolveContentPlanner({
      apiUrl: "https://llm.local/v1/chat/completions",
      apiKey: "key",
      model: "test-model",
    });
    expect(planner.name).toBe("llm:test-model");
  });
});

describe("buildPlannerUserPrompt", () => {
  it("requires shot-specific reference matching and evidence-based wardrobe continuity", () => {
    expect(PLANNER_SYSTEM_PROMPT).toContain(
      "Match references shot by shot, not once for the whole post",
    );
    expect(PLANNER_SYSTEM_PROMPT).toContain(
      "repeat the same wording in every shots.scene",
    );
    expect(PLANNER_SYSTEM_PROMPT).toContain(
      "do not invent a conflicting construction",
    );
    expect(PLANNER_SYSTEM_PROMPT).toContain(
      "shared reference as the first identity-and-wardrobe anchor",
    );
    expect(PLANNER_SYSTEM_PROMPT).toContain(
      "completely above the top frame edge",
    );
    expect(PLANNER_SYSTEM_PROMPT).toContain("analysis-only");
    expect(PLANNER_SYSTEM_PROMPT).toContain(
      "neutral, unobstructed, accessory-free shared anchor",
    );
    expect(PLANNER_SYSTEM_PROMPT).toContain(
      "removing a repeated device or occlusion is less reliable than adding",
    );
    expect(PLANNER_SYSTEM_PROMPT).toContain(
      "every explicit operator exclusion as a hard final-frame constraint",
    );
    expect(PLANNER_SYSTEM_PROMPT).toContain(
      "do not place the top frame edge at the collarbones or shoulders",
    );
    expect(PLANNER_SYSTEM_PROMPT).toContain(
      "normal handheld smartphone is not a reliable hard-privacy mask",
    );
    expect(PLANNER_SYSTEM_PROMPT).toContain(
      "Never call that shot handheld or a handheld mirror selfie",
    );
    expect(PLANNER_SYSTEM_PROMPT).toContain(
      "background palette, and light most closely match",
    );
  });

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

  it("includes reusable and character-specific location references", () => {
    const prompt = buildPlannerUserPrompt({
      characterName: "서린",
      bio: "라이프스타일 인플루언서",
      interests: [],
      personas: [],
      memories: [],
      recentCaptions: [],
      locationCatalog: [
        {
          id: "gym-1",
          name: "서린이 다니는 헬스장",
          description: "촬영 친화적인 24시간 헬스장",
          references: [{ id: "gym-ref-1", description: "전신 거울 구역" }],
        },
      ],
    });

    expect(prompt).toContain("Available locations");
    expect(prompt).toContain("[gym-1] 서린이 다니는 헬스장");
    expect(prompt).toContain("[gym-ref-1] 전신 거울 구역");
  });
});

describe("parseContentPlan", () => {
  it("allows an environment reference without identity in a hidden-character shot", () => {
    const plan = parseContentPlan(
      JSON.stringify({
        caption: "오늘은 조용한 시간",
        hashtags: [],
        locationId: "gym-1",
        shots: [
          {
            sortOrder: 0,
            scene: "사람이 없는 헬스장 거울 구역",
            captureSetup: "벤치 위 고정 휴대폰",
            characterVisible: false,
            referenceIds: [],
            environmentReferenceIds: ["gym-ref-1", "other-ref"],
          },
        ],
      }),
      1,
      ["identity-1"],
      [
        {
          id: "gym-1",
          name: "헬스장",
          description: "설명",
          references: [{ id: "gym-ref-1", description: "거울 구역" }],
        },
      ],
    );

    expect(plan.locationId).toBe("gym-1");
    expect(plan.shots[0]).toMatchObject({
      referenceIds: [],
      environmentReferenceIds: ["gym-ref-1"],
    });
  });

  it("parses plain JSON output", () => {
    const plan = parseContentPlan(
      JSON.stringify({
        caption: "노을이 예뻤던 날",
        hashtags: ["#필름사진", "여행", "필름사진"],
        shots: [
          {
            sortOrder: 0,
            scene: "해변 역광 실루엣",
            captureSetup: "친구가 눈높이에서 촬영",
            characterVisible: true,
            referenceIds: ["r1"],
          },
          {
            sortOrder: 1,
            scene: "필름 카메라 클로즈업",
            captureSetup: "소이가 위에서 직접 촬영",
            characterVisible: false,
            referenceIds: [],
          },
        ],
      }),
      2,
      ["r1"],
    );
    expect(plan.caption).toBe("노을이 예뻤던 날");
    // # 제거 + 중복 제거
    expect(plan.hashtags).toEqual(["필름사진", "여행"]);
    expect(plan.shots).toHaveLength(2);
  });

  it("extracts the requested number of shots from a fenced JSON block", () => {
    const raw = [
      "```json",
      JSON.stringify({
        caption: "c",
        hashtags: [],
        shots: ["a", "b", "c"].map((scene, sortOrder) => ({
          sortOrder,
          scene,
          captureSetup: "눈높이 촬영",
          characterVisible: false,
          referenceIds: [],
        })),
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
            sortOrder: 0,
            scene: "장면",
            captureSetup: "친구가 눈높이에서 촬영",
            characterVisible: true,
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

  it("keeps final-frame content separate from capture setup", () => {
    const plan = parseContentPlan(
      JSON.stringify({
        caption: "c",
        hashtags: [],
        shots: [
          {
            sortOrder: 0,
            scene: "사람이 없는 연트럴파크 철길과 해질녘 하늘",
            captureSetup:
              "소이가 Canon AE-1을 눈높이에 들고 프레임 밖에서 촬영",
            characterVisible: false,
            referenceIds: [],
          },
        ],
      }),
      1,
      ["r1"],
    );

    expect(plan.shots[0]).toEqual({
      sortOrder: 0,
      scene: "사람이 없는 연트럴파크 철길과 해질녘 하늘",
      captureSetup: "소이가 Canon AE-1을 눈높이에 들고 프레임 밖에서 촬영",
      characterVisible: false,
      referenceIds: [],
      environmentReferenceIds: [],
    });
  });

  it("rejects a character-visible shot without a usable catalog reference", () => {
    expect(() =>
      parseContentPlan(
        JSON.stringify({
          caption: "c",
          hashtags: [],
          shots: [
            {
              sortOrder: 0,
              scene: "장면",
              captureSetup: "눈높이 촬영",
              characterVisible: true,
              referenceIds: ["missing"],
            },
          ],
        }),
        1,
      ),
    ).toThrow(
      "shot 0 shows the character but has no usable identity reference",
    );
  });

  it("rejects output with a different shot count", () => {
    expect(() =>
      parseContentPlan(JSON.stringify({ caption: "c", shots: [] }), 2),
    ).toThrow("content plan returned 0 shot(s) for 2 requested shot(s)");
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
    maxShots: 1,
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
                  shots: [
                    {
                      sortOrder: 0,
                      scene: "골목길 오후 빛",
                      captureSetup: "손에 든 카메라로 눈높이 촬영",
                      characterVisible: false,
                      referenceIds: [],
                    },
                  ],
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
      shots: [
        {
          sortOrder: 0,
          scene: "골목길 오후 빛",
          captureSetup: "손에 든 카메라로 눈높이 촬영",
          characterVisible: false,
          referenceIds: [],
        },
      ],
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
