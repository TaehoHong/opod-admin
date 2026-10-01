import {
  parsePostPlan,
  PostPlanningAgent,
  PostPlannerInput,
} from "./post-planner";
import { StrictJsonAgentClient } from "../shared/ai/strict-json-agent";
import { POST_PLAN_JSON_SCHEMA } from "../../prompts/post-planner";

const ready = {
  status: "ready",
  intent: {
    premise: "친구보다 먼저 카페에 도착했다.",
    primaryPurpose: "일찍 도착한 민망함을 자조적으로 기록한다.",
    secondaryPurpose: null,
  },
  newMemoryCandidates: [],
  accountFit:
    "최근 게시물 사이에 가벼운 일상을 공유하며 계정의 중심을 유지한다.",
};

describe("Post Planning Agent contract (v3)", () => {
  it("accepts an image-only production conflict only with a truthful medium quote", () => {
    const input = {
      productionContext: { contentType: "feed", mediaType: "image" },
      operatorRequest: "영상으로만 올려줘",
    } as unknown as PostPlannerInput;
    const conflict = (text: string) => ({
      status: "conflict",
      conflicts: [
        {
          left: { source: "operatorRequest", text: "영상으로만 올려줘" },
          right: { source: "productionContext.mediaType", text },
          reason: "요청은 영상만 허용하고 현재 제작 경로는 이미지다.",
        },
      ],
    });
    expect(parsePostPlan(conflict("image"), input)).toMatchObject({
      status: "conflict",
    });
    expect(() => parsePostPlan(conflict("video"), input)).toThrow();
    expect(() =>
      parsePostPlan(conflict("image"), {
        operatorRequest: input.operatorRequest,
      } as PostPlannerInput),
    ).toThrow();
  });

  it("accepts intent, account fit, and memory candidates", () => {
    expect(parsePostPlan(ready)).toEqual(ready);
  });

  it("requires an account-fit explanation before accepting a new plan", () => {
    const withoutFit: Record<string, unknown> = { ...ready };
    delete withoutFit.accountFit;
    expect(() => parsePostPlan(withoutFit)).toThrow();
    expect(() => parsePostPlan({ ...ready, accountFit: " " })).toThrow();
  });

  // V4: 캡션·해시태그·언어는 ⑥ Caption Agent 소유다. 여기서 받아주면 이중 소유가
  // 되살아난다 — 이 테스트가 그 회귀를 잡는다.
  it("rejects caption fields and other extra fields", () => {
    expect(() =>
      parsePostPlan({ ...ready, caption: "20분 일찍 왔는데 벌써 다 마심" }),
    ).toThrow("invalid fields");
    expect(() => parsePostPlan({ ...ready, hashtags: ["#카페"] })).toThrow(
      "invalid fields",
    );
    expect(() => parsePostPlan({ ...ready, imageCount: 2 })).toThrow(
      "invalid fields",
    );
  });

  it("keeps symmetric truthful conflict operands", () => {
    expect(
      parsePostPlan(
        {
          status: "conflict",
          conflicts: [
            {
              left: {
                source: "persona.writingProfile.contentStyle",
                text: "광고는 쓰지 않는다",
              },
              right: {
                source: "persona.writingProfile.voice",
                text: "항상 광고 문구로 쓴다",
              },
              reason: "동시에 만족할 수 없다",
            },
          ],
        },
        {
          persona: {
            writingProfile: {
              contentStyle: [{ content: "광고는 쓰지 않는다" }],
              voice: [{ content: "항상 광고 문구로 쓴다" }],
            },
          },
        } as PostPlannerInput,
      ),
    ).toMatchObject({ status: "conflict" });
  });
});

describe("Post Planning Agent conflict evidence", () => {
  const input: PostPlannerInput = {
    character: {
      name: "Test",
      bio: "사진을 찍는다",
      interests: [],
      defaultContentLanguage: "ko",
    },
    contentProfile: {
      accountConcept: "일상 사진",
      constraints: "광고는 쓰지 않는다",
    },
    persona: {
      characterContext: [],
      writingProfile: { contentStyle: [], voice: [] },
      boundaries: [],
      additionalContext: [],
    },
    memories: [],
    recentPosts: [],
  };
  function agent(output: unknown) {
    return new PostPlanningAgent(
      new StrictJsonAgentClient(
        {
          apiUrl: "https://llm.test/chat",
          apiKey: "fixture",
          model: "fixture",
        },
        async () =>
          Response.json({
            choices: [
              { message: { content: JSON.stringify({ result: output }) } },
            ],
          }),
        undefined,
        {
          systemPrompt: "Plan a post.",
          outputSchema: POST_PLAN_JSON_SCHEMA,
          metadata: {},
        },
      ),
    );
  }
  it("rejects an operator conflict when no operator request was supplied", async () => {
    await expect(
      agent({
        status: "conflict",
        conflicts: [
          {
            left: { source: "operatorRequest", text: "광고를 쓴다" },
            right: {
              source: "contentProfile.constraints",
              text: "광고는 쓰지 않는다",
            },
            reason: "광고 요청이 제한과 충돌한다",
          },
        ],
      }).plan(input),
    ).rejects.toThrow("conflict left does not match input");
  });
  it("rejects a quotation assigned to the wrong input source", async () => {
    await expect(
      agent({
        status: "conflict",
        conflicts: [
          {
            left: {
              source: "persona.characterContext",
              text: "광고는 쓰지 않는다",
            },
            right: { source: "operatorRequest", text: "광고를 쓴다" },
            reason: "광고 요청이 제한과 충돌한다",
          },
        ],
      }).plan({ ...input, operatorRequest: "광고를 쓴다" }),
    ).rejects.toThrow("conflict left does not match input");
  });
});
