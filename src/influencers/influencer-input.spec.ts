import {
  compositionText,
  instagramAccount,
  parseMediaMetadata,
} from "./influencer-input";
describe("influencer inputs", () => {
  it("normalizes profile aliases but rejects posts and lookalike hosts", () => {
    expect(instagramAccount(" https://INSTAGRAM.com/Example/?x=1 ")).toEqual({
      platform: "instagram",
      username: "example",
      url: "https://www.instagram.com/example/",
    });
    expect(() => instagramAccount("https://instagram.com/p/abc/")).toThrow();
    expect(() =>
      instagramAccount("https://instagram.com.evil.test/example/"),
    ).toThrow();
  });
  it("rejects metadata that changes the claimed post identity", () => {
    expect(() =>
      parseMediaMetadata(
        JSON.stringify({
          influencerId: "1",
          postId: "ABC",
          postUrl: "https://instagram.com/p/OTHER/",
          slideIndex: 1,
          assetType: "image",
          analysis: null,
        }),
      ),
    ).toThrow();
  });
  it("uses pose geometry rather than wardrobe or background for embedding", () => {
    expect(
      compositionText({
        description: "person in cafe",
        pose: "seated",
        camera: "eye level",
        wardrobe: "white shirt",
        background: "cafe",
      }),
    ).toBe("pose: seated\ncamera: eye level");
  });
});
