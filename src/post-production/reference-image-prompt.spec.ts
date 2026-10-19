import {
  parseReferenceImagePrompt,
  ReferenceImagePromptInput,
  ReferenceImagePromptAgent,
} from "./reference-image-prompt";
import { StrictJsonAgentClient } from "../shared/ai/strict-json-agent";
import { createHash } from "node:crypto";
const bytes = Buffer.from("pixels");
const input: ReferenceImagePromptInput = {
  character: { concept: "daily", imageStyle: "snap", constraints: "" },
  shots: [
    {
      shotId: "SHOT_01",
      references: [
        {
          id: "SOURCE_01",
          role: "source",
          inputOrder: 1,
          promptLabel: "Image 1",
          sha256: createHash("sha256").update(bytes).digest("hex"),
          media: { url: "source" },
        },
        {
          id: "CHARACTER_01",
          role: "character_identity",
          inputOrder: 2,
          promptLabel: "Image 2",
          media: { url: "identity" },
        },
      ],
    },
  ],
};
const shot = {
  shotId: "SHOT_01",
  referenceIds: ["SOURCE_01", "CHARACTER_01"],
  preserve: "pose",
  adjust: "outfit",
  prompt: "Use Image 1 for pose and Image 2 for identity.",
  negativePrompt: "",
};
it("accepts a required blank negative prompt and preserves source reference order", () => {
  expect(
    parseReferenceImagePrompt(
      { status: "ready", blockedReason: null, shots: [shot] },
      input,
    ),
  ).toEqual({ status: "ready", blockedReason: null, shots: [shot] });
});
it.each([
  { ...shot, referenceIds: ["CHARACTER_01", "SOURCE_01"] },
  { ...shot, negativePrompt: undefined },
  { ...shot, shotId: "unknown" },
  { ...shot, prompt: " " },
])("rejects unsafe generated prompt mappings and missing fields", (invalid) => {
  expect(() =>
    parseReferenceImagePrompt(
      { status: "ready", blockedReason: null, shots: [invalid] },
      input,
    ),
  ).toThrow();
});
it("accepts blocked only with a reason and no shots", () => {
  expect(
    parseReferenceImagePrompt(
      { status: "blocked", blockedReason: "conflict", shots: [] },
      input,
    ),
  ).toEqual({ status: "blocked", blockedReason: "conflict", shots: [] });
  expect(() =>
    parseReferenceImagePrompt(
      { status: "blocked", blockedReason: "conflict", shots: [shot] },
      input,
    ),
  ).toThrow();
});
it("sends each shot reference with its role and exact pixel order", async () => {
  const fetchFn = jest.fn(async (...args: Parameters<typeof fetch>) => {
    void args;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                status: "ready",
                blockedReason: null,
                shots: [shot],
              }),
            },
          },
        ],
      }),
    );
  });
  const client = new StrictJsonAgentClient(
    { apiUrl: "https://example.test", apiKey: "test", model: "injected" },
    fetchFn,
    undefined,
    { systemPrompt: "saved", outputSchema: {}, metadata: {} },
  );
  const agent = new ReferenceImagePromptAgent(client, async () => ({
    bytes,
    contentType: "image/png",
  }));
  await agent.build(input);
  const request = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body));
  expect(request.messages[1].content[1].text).toBe(
    "SHOT_01 / SOURCE_01 / Image 1 / source",
  );
  expect(request.messages[1].content[3].text).toBe(
    "SHOT_01 / CHARACTER_01 / Image 2 / character_identity",
  );
  await expect(
    agent.build({
      ...input,
      shots: [
        {
          ...input.shots[0],
          references: [
            input.shots[0].references[0],
            { ...input.shots[0].references[1], sha256: "changed" },
          ],
        },
      ],
    }),
  ).rejects.toThrow("hash mismatch");
  expect(fetchFn).toHaveBeenCalledTimes(1);
});
