import { createHash } from "node:crypto";
import { StrictJsonAgentClient } from "../shared/ai/strict-json-agent";
import { ReferenceSelectionAgent } from "./reference-selection-agent";
import { REFERENCE_SELECTION_JSON_SCHEMA } from "../../prompts/reference-selection";
const bytes = Buffer.from("source pixels");
const candidate = {
  mediaId: "9007199254740993",
  sha256: createHash("sha256").update(bytes).digest("hex"),
  media: { url: "source" },
};
const input = {
  character: { concept: "daily", imageStyle: "snap", constraints: "" },
};
function setup(value: unknown) {
  const fetchFn = jest.fn(async (...args: Parameters<typeof fetch>) => {
    void args;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(value) } }],
      }),
    );
  });
  const client = new StrictJsonAgentClient(
    { apiUrl: "https://example.test", apiKey: "test", model: "injected" },
    fetchFn,
    undefined,
    {
      systemPrompt: "saved",
      outputSchema: REFERENCE_SELECTION_JSON_SCHEMA,
      metadata: {},
    },
  );
  return {
    fetchFn,
    agent: new ReferenceSelectionAgent(client, async () => ({
      bytes,
      contentType: "image/png",
    })),
  };
}
it("binds the exact candidate ID to pixels and validates the selected result", async () => {
  const decision = {
    status: "selected",
    selections: [{ mediaId: candidate.mediaId }],
    shortfallReason: "",
  };
  const { agent, fetchFn } = setup(decision);
  expect((await agent.select(input, [candidate])).output).toEqual(decision);
  const request = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body));
  expect(
    request.response_format.json_schema.schema.properties.selections.items
      .required,
  ).toEqual(["mediaId"]);
  expect(
    request.response_format.json_schema.schema.properties.selections.items
      .properties,
  ).not.toHaveProperty("reason");
  expect(request.messages[1].content.slice(1)).toEqual([
    { type: "text", text: `Candidate mediaId ${candidate.mediaId}` },
    {
      type: "image_url",
      image_url: {
        url: `data:image/png;base64,${bytes.toString("base64")}`,
        detail: "high",
      },
    },
  ]);
});
it("rejects changed source bytes before any model request", async () => {
  const { agent, fetchFn } = setup({});
  await expect(
    agent.select(input, [{ ...candidate, sha256: "wrong" }]),
  ).rejects.toThrow("hash mismatch");
  expect(fetchFn).not.toHaveBeenCalled();
});
it("rejects unknown model selections without another request", async () => {
  const { agent, fetchFn } = setup({
    status: "selected",
    selections: [{ mediaId: "unknown", reason: "pose" }],
    shortfallReason: "",
  });
  await expect(agent.select(input, [candidate])).rejects.toThrow(
    "unknown or duplicate",
  );
  expect(fetchFn).toHaveBeenCalledTimes(1);
});
it("requires saved prompt settings before reading pixels or calling the model", async () => {
  const fetchFn = jest.fn();
  const readBytes = jest.fn(async () => ({ bytes, contentType: "image/png" }));
  const client = new StrictJsonAgentClient(
    { apiUrl: "https://example.test", apiKey: "test", model: "injected" },
    fetchFn,
  );
  await expect(
    new ReferenceSelectionAgent(client, readBytes).select(input, [candidate]),
  ).rejects.toThrow("Saved agent prompt is required");
  expect(readBytes).not.toHaveBeenCalled();
  expect(fetchFn).not.toHaveBeenCalled();
});
