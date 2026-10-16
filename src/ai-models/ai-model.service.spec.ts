import { BadRequestException } from "@nestjs/common";
import { validateAiModel } from "./ai-model.service";

describe("image model registration", () => {
  it.each([
    "alibaba/qwen-image-3.0-pro/edit",
    "alibaba/qwen-image-3.0/edit",
    "bytedance/seedream-5.0-pro/edit",
  ])("accepts the SpicyAPI model %s", (model) => {
    expect(() => validateAiModel("image", "spicyapi", model)).not.toThrow();
  });

  it.each([
    ["spicyapi", "alibaba/qwen-image-3.0-pro/text-to-image"],
    ["spicyapi", "bytedance/seedream-5.0-pro/text-to-image"],
    ["spicyapi", "gpt-image-2.5-sunburst"],
    ["openai", "alibaba/qwen-image-3.0-pro/edit"],
  ])("rejects provider %s with model %s", (provider, model) => {
    expect(() => validateAiModel("image", provider, model)).toThrow(
      BadRequestException,
    );
  });
});
