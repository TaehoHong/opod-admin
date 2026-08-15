import { captionUserContent, parseCaptionSet } from "./caption-writer";

const ready = {
  status: "ready",
  caption: "20분 일찍 왔는데 벌써 다 마심",
  captionLanguages: ["ko"],
  hashtags: ["#카페", "기다리는중"],
};

describe("Caption Agent contract", () => {
  it("accepts a strict ready result and normalizes hashtags", () => {
    expect(parseCaptionSet(ready)).toEqual({
      status: "ready",
      caption: "20분 일찍 왔는데 벌써 다 마심",
      captionLanguages: ["ko"],
      hashtags: ["카페", "기다리는중"],
    });
  });

  // post-planner-v1에서 이관한 검사 — 옮기면서 약해지면 게시 본문 계약이 깨진다.
  it("rejects non-canonical language tags, duplicate tags, extra fields and blank captions", () => {
    expect(() =>
      parseCaptionSet({ ...ready, captionLanguages: ["KO"] }),
    ).toThrow("canonical BCP-47");
    expect(() =>
      parseCaptionSet({ ...ready, hashtags: ["카페", "#카페"] }),
    ).toThrow("not normalized or unique");
    expect(() => parseCaptionSet({ ...ready, intent: {} })).toThrow(
      "invalid fields",
    );
    expect(() => parseCaptionSet({ ...ready, caption: "   " })).toThrow(
      "caption is invalid",
    );
    expect(() => parseCaptionSet({ ...ready, status: "blocked" })).toThrow(
      "invalid status",
    );
  });

  // 이미지가 빠지면 "이미지를 보고 쓴다"가 조용히 무너진다 — 컷 수만큼
  // image_url 블록이 있어야 하고 sortOrder 순이어야 한다.
  it("sends one image block per shot in shot order after the text input", async () => {
    const readBytes = jest.fn(async () => ({
      bytes: Buffer.from("png"),
      contentType: "image/png",
    }));
    const blocks = await captionUserContent(
      {
        character: {
          name: "서린",
          bio: "",
          interests: [],
          defaultContentLanguage: "ko",
        },
        persona: {
          characterContext: [],
          writingProfile: { contentStyle: [], voice: [] },
          boundaries: [],
          additionalContext: [],
        },
        memories: [],
        recentPosts: [],
        postPlan: {
          intent: {
            premise: "필라테스 다녀옴",
            primaryPurpose: "기록",
            secondaryPurpose: null,
          },
        },
        shots: [
          {
            sortOrder: 0,
            visualPurpose: "전신",
            scene: "거울 셀피",
            lockedElements: [],
            mediaId: "m0",
          },
          {
            sortOrder: 1,
            visualPurpose: "디테일",
            scene: "운동화",
            lockedElements: [],
            mediaId: "m1",
          },
        ],
      },
      [
        { sortOrder: 1, mediaId: "m1", media: { url: "u1" } },
        { sortOrder: 0, mediaId: "m0", media: { url: "u0" } },
      ],
      readBytes,
    );

    expect(blocks[0]).toEqual({
      type: "text",
      text: expect.stringContaining("필라테스 다녀옴"),
    });
    const imageBlocks = blocks.filter(
      (block) => (block as { type: string }).type === "image_url",
    );
    expect(imageBlocks).toHaveLength(2);
    expect(blocks[1]).toEqual({
      type: "text",
      text: "Generated image for shot 0 media m0",
    });
    expect(blocks[3]).toEqual({
      type: "text",
      text: "Generated image for shot 1 media m1",
    });
    expect(readBytes).toHaveBeenNthCalledWith(1, { url: "u0" });
  });
});
