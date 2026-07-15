import { compileImagePrompt } from "./image-prompt";

describe("compileImagePrompt", () => {
  it("places appearance before the request and style after it", () => {
    expect(
      compileImagePrompt(
        { appearancePrompt: "same face", stylePrompt: "film grain" },
        "walking in Seongsu",
      ),
    ).toBe("same face, walking in Seongsu, film grain");
    expect(compileImagePrompt(null, "walking in Seongsu")).toBe(
      "walking in Seongsu",
    );
  });
});
