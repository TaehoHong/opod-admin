import { createOpenAiImageProvider } from "./openai-image.provider";
import { ImageGenerationRequest } from "./image-generation.provider";

const request: ImageGenerationRequest = {
  idempotencyKey: "job-attempt-1",
  profile: "photoreal_scene_v1",
  prompt: "A cup on a table",
  references: [],
  candidateCount: 1,
  extraParams: { aspect_ratio: "4:5", seed: 42, model: "wrong" },
};
const config = { apiKey: "test-key", model: "gpt-image-2.5-sunburst" };
async function finish(
  provider: ReturnType<typeof createOpenAiImageProvider>,
  id: string,
) {
  for (let i = 0; i < 10; i++) {
    const result = await provider.poll(id);
    if (result.status !== "pending") return result;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw Error("never completed");
}

describe("OpenAI image provider", () => {
  it.each([false, true])(
    "routes references=%s, preserves order and maps ratio without leaking other provider parameters",
    async (edit) => {
      const fetchFn = jest
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: [{ b64_json: "aW1hZ2U=" }] })),
        );
      const provider = createOpenAiImageProvider(config, fetchFn);
      const references = edit
        ? ["one", "two"].map((id) => ({
            id,
            role: "identity" as const,
            url: `https://media.example/${id}.png`,
          }))
        : [];
      const submitted = await provider.submit({ ...request, references });
      expect(fetchFn).not.toHaveBeenCalled();
      expect(await finish(provider, submitted.requestId)).toMatchObject({
        status: "completed",
        images: [{ dataBase64: "aW1hZ2U=" }],
      });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      const [url, init] = fetchFn.mock.calls[0];
      expect(url).toBe(
        `https://api.openai.com/v1/images/${edit ? "edits" : "generations"}`,
      );
      expect(JSON.parse(init.body)).toEqual({
        model: config.model,
        prompt: request.prompt,
        n: 1,
        size: "1024x1280",
        quality: "auto",
        output_format: "png",
        ...(edit
          ? { images: references.map((r) => ({ image_url: r.url })) }
          : {}),
      });
      expect(init.headers.authorization).toBe("Bearer test-key");
    },
  );
  it("does not resubmit an unrecoverable request after restart", async () => {
    const fetchFn = jest.fn();
    const provider = createOpenAiImageProvider(config, fetchFn);
    expect(await provider.poll("old-request")).toMatchObject({
      status: "failed",
      permanent: true,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it.each([401, 429, 500])(
    "exposes HTTP %s as a terminal failure without leaking response secrets",
    async (status) => {
      const fetchFn = jest
        .fn()
        .mockResolvedValue(new Response("secret private data", { status }));
      const provider = createOpenAiImageProvider(config, fetchFn);
      const submitted = await provider.submit(request);
      const result = await finish(provider, submitted.requestId);
      expect(result).toMatchObject({ status: "failed", permanent: true });
      expect(JSON.stringify(result)).not.toContain("secret private data");
      expect(fetchFn).toHaveBeenCalledTimes(1);
    },
  );
});

it.each([
  [{ aspect_ratio: "9:16" }, "720x1280"],
  [{ aspect_ratio: "4:5", size: "1536x1024" }, "1536x1024"],
  [
    { aspect_ratio: "4:5", image_size: { width: 1024, height: 1024 } },
    "1024x1024",
  ],
  [{ aspect_ratio: "4:5", size: "auto" }, "auto"],
])(
  "honors explicit image dimensions and format ratios: %j",
  async (extraParams, size) => {
    const fetchFn = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ b64_json: "aW1hZ2U=" }],
          usage: {
            input_tokens_details: { text_tokens: 100, image_tokens: 200 },
            output_tokens: 300,
          },
        }),
      ),
    );
    const provider = createOpenAiImageProvider(config, fetchFn);
    const submitted = await provider.submit({ ...request, extraParams });
    expect(await finish(provider, submitted.requestId)).toMatchObject({
      status: "completed",
      costUsd: 0.0111,
    });
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).size).toBe(size);
  },
);
