import { parsePostPlan } from "./post-planner";

const ready = {
  status: "ready",
  intent: {
    premise: "친구보다 먼저 카페에 도착했다.",
    primaryPurpose: "일찍 도착한 민망함을 자조적으로 기록한다.",
    secondaryPurpose: null,
  },
  newMemoryCandidates: [],
};

describe("Post Planning Agent contract (v2)", () => {
  it("accepts a strict ready result with intent and memory candidates only", () => {
    expect(parsePostPlan(ready)).toEqual(ready);
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
      parsePostPlan({
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
      }),
    ).toMatchObject({ status: "conflict" });
  });
});
