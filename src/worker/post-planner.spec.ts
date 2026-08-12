import { parsePostPlan } from "./post-planner";

const ready = {
  status: "ready",
  intent: {
    premise: "친구보다 먼저 카페에 도착했다.",
    primaryPurpose: "일찍 도착한 민망함을 자조적으로 기록한다.",
    secondaryPurpose: null,
  },
  caption: "20분 일찍 왔는데 벌써 다 마심",
  captionLanguages: ["ko"],
  hashtags: ["#카페", "기다리는중"],
  newMemoryCandidates: [],
};

describe("Post Planning Agent contract", () => {
  it("accepts a strict ready result and preserves current hashtag normalization", () => {
    expect(parsePostPlan(ready)).toMatchObject({
      status: "ready",
      hashtags: ["카페", "기다리는중"],
    });
  });

  it("rejects extra fields and non-canonical caption language tags", () => {
    expect(() => parsePostPlan({ ...ready, imageCount: 2 })).toThrow(
      "invalid fields",
    );
    expect(() => parsePostPlan({ ...ready, captionLanguages: ["KO"] })).toThrow(
      "canonical BCP-47",
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
