import { ReferenceEmbeddingClient } from "./reference-embedding";
const vector = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
const logs = {
  runJsonFetch: ({ execute }: { execute: () => Promise<Response> }) =>
    execute(),
};
function client(result: unknown) {
  const fetchFn = jest.fn().mockResolvedValue(Response.json(result));
  return {
    value: new ReferenceEmbeddingClient(
      { apiUrl: "https://fixture.test/embeddings", model: "fixture" },
      logs as never,
      fetchFn,
    ),
    fetchFn,
  };
}
describe("reference embedding transport", () => {
  it("preserves caption bytes and reorders results by provider index", async () => {
    const { value, fetchFn } = client({
      model: "fixture",
      data: [
        { index: 1, embedding: vector },
        { index: 0, embedding: vector.map((x) => (x ? -x : 0)) },
      ],
    });
    const captions = ["  캡션\n원문  ", "other"];
    expect(await value.embed(captions)).toEqual([
      vector.map((x) => (x ? -x : 0)),
      vector,
    ]);
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).input).toEqual(captions);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it.each([
    { model: "other", data: [{ index: 0, embedding: vector }] },
    { model: "fixture", data: [{ index: 0, embedding: [1] }] },
    { model: "fixture", data: [{ index: 0, embedding: vector.map(() => 0) }] },
    { model: "fixture", data: [{ index: 1, embedding: vector }] },
    {
      model: "fixture",
      data: [
        { index: 0, embedding: vector },
        { index: 0, embedding: vector },
      ],
    },
  ])(
    "rejects incompatible provider output without retry (%j)",
    async (result) => {
      const { value, fetchFn } = client(result);
      await expect(value.embed(["caption"])).rejects.toThrow();
      expect(fetchFn).toHaveBeenCalledTimes(1);
    },
  );
});
