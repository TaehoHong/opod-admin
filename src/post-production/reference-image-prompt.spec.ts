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
it("maps each shot reference to its attached pixels and preserves generation order", async () => {
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
  const agent = new ReferenceImagePromptAgent(client, async (image) => ({
    bytes: image.url === "source" ? bytes : Buffer.from("identity pixels"),
    contentType: "image/png",
  }));
  await agent.build(input);
  const request = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body));
  const mapping = JSON.parse(request.messages[1].content[0].text);
  expect(mapping.shots[0].references).toEqual([
    {
      id: "SOURCE_01",
      role: "source",
      inputOrder: 1,
      promptLabel: "Image 1",
      imageId: "INPUT_IMAGE_1",
    },
    {
      id: "CHARACTER_01",
      role: "character_identity",
      inputOrder: 2,
      promptLabel: "Image 2",
      imageId: "INPUT_IMAGE_2",
    },
  ]);
  expect(request.messages[1].content[1].text).toBe("INPUT_IMAGE_1");
  expect(request.messages[1].content[2].image_url.url).toBe(
    `data:image/png;base64,${bytes.toString("base64")}`,
  );
  expect(request.messages[1].content[3].text).toBe("INPUT_IMAGE_2");
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

it("attaches five unique images for three shots sharing two character references", async () => {
  const face = {
    id: "CHARACTER_1",
    role: "character_identity" as const,
    inputOrder: 1,
    promptLabel: "Image 1",
    media: { url: "face" },
  };
  const body = {
    id: "CHARACTER_2",
    role: "character_identity" as const,
    inputOrder: 2,
    promptLabel: "Image 2",
    media: { url: "body" },
  };
  const source = (url: string) => ({
    id: "SOURCE",
    role: "source" as const,
    inputOrder: 3,
    promptLabel: "Image 3",
    media: { url },
    sha256: createHash("sha256").update(url).digest("hex"),
  });
  const multiInput: ReferenceImagePromptInput = {
    ...input,
    shots: [
      { shotId: "SHOT_01", references: [face, body, source("source-1")] },
      {
        shotId: "SHOT_02",
        references: [
          { ...face, media: { url: "face-copy" } },
          body,
          source("source-2"),
        ],
      },
      { shotId: "SHOT_03", references: [face, body, source("source-3")] },
    ],
  };
  const fetchFn = jest.fn(async (...args: Parameters<typeof fetch>) => {
    void args;
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              status: "blocked",
              blockedReason: "test",
              shots: [],
            }),
          },
        },
      ],
    });
  });
  const client = new StrictJsonAgentClient(
    { apiUrl: "https://example.test", apiKey: "test", model: "injected" },
    fetchFn,
    undefined,
    { systemPrompt: "saved", outputSchema: {}, metadata: {} },
  );
  const agent = new ReferenceImagePromptAgent(client, async (image) => ({
    bytes: Buffer.from(image.url === "face-copy" ? "face" : image.url),
    contentType: "image/png",
  }));
  await agent.build(multiInput);
  const content = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body))
    .messages[1].content;
  expect(
    content
      .filter((part: { type: string }) => part.type === "image_url")
      .map((part: { image_url: { url: string } }) =>
        Buffer.from(part.image_url.url.split(",")[1], "base64").toString(),
      ),
  ).toEqual(["face", "body", "source-1", "source-2", "source-3"]);
  const mapping = JSON.parse(content[0].text);
  expect(
    mapping.shots.map(
      (s: { references: { imageId: string; promptLabel: string }[] }) =>
        s.references.map((r) => [r.imageId, r.promptLabel]),
    ),
  ).toEqual([
    [
      ["INPUT_IMAGE_1", "Image 1"],
      ["INPUT_IMAGE_2", "Image 2"],
      ["INPUT_IMAGE_3", "Image 3"],
    ],
    [
      ["INPUT_IMAGE_1", "Image 1"],
      ["INPUT_IMAGE_2", "Image 2"],
      ["INPUT_IMAGE_4", "Image 3"],
    ],
    [
      ["INPUT_IMAGE_1", "Image 1"],
      ["INPUT_IMAGE_2", "Image 2"],
      ["INPUT_IMAGE_5", "Image 3"],
    ],
  ]);
  await expect(
    agent.build({
      ...multiInput,
      shots: [
        multiInput.shots[0],
        {
          ...multiInput.shots[1],
          references: [
            { ...face, sha256: "changed" },
            body,
            source("source-2"),
          ],
        },
      ],
    }),
  ).rejects.toThrow("hash mismatch");
  expect(fetchFn).toHaveBeenCalledTimes(1);
});
