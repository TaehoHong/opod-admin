import { IMAGE_PLAN_JSON_SCHEMA } from "../../prompts/image-planner";
import { PROMPT_SET_JSON_SCHEMA } from "../../prompts/image-prompt-generator";
import { POST_PLAN_JSON_SCHEMA } from "../../prompts/post-planner";
import {
  UNION_ENVELOPE_KEY,
  assertStrictSchemaCompatible,
  isRootUnionSchema,
  rootUnionSchema,
} from "../../prompts/strict-schema";
import { StrictJsonAgentClient } from "./strict-json-agent";
import {
  GeneratedImageEvaluationAgentV3,
  ImagePlanEvaluationAgentV3,
  ImagePromptEvaluationAgentV3,
  PostEvaluationAgentV3,
} from "./v3-evaluators";

// 프로바이더가 거부하는 문법으로 스키마를 배포하면 해당 단계가 400으로 죽는다.
// 2026-08-13에 루트 oneOf 때문에 게시글 기획이 전부 실패했으므로, 문법 검사는
// 네트워크 없이 여기서 회귀로 고정한다.
describe("V3 strict schema compatibility", () => {
  it.each([
    ["post plan", POST_PLAN_JSON_SCHEMA],
    ["image plan", IMAGE_PLAN_JSON_SCHEMA],
    ["prompt set", PROMPT_SET_JSON_SCHEMA],
  ])("%s schema is compatible", (label, schema) => {
    expect(() => assertStrictSchemaCompatible(schema, label)).not.toThrow();
  });

  it("evaluation agent schemas are compatible", async () => {
    const captured: unknown[] = [];
    const client = {
      run: async (request: { schema: unknown }) => {
        captured.push(request.schema);
        throw new Error("stop after capturing the schema");
      },
    } as unknown as StrictJsonAgentClient;
    const calls = [
      () =>
        new PostEvaluationAgentV3(client).evaluate({
          planningInput: {},
          postPlan: { status: "ready" },
        }),
      () =>
        new PostEvaluationAgentV3(client).evaluate({
          planningInput: {},
          postPlan: { status: "conflict" },
        }),
      () =>
        new ImagePlanEvaluationAgentV3(client).evaluate({
          planningInput: {},
          imagePlan: { status: "ready" },
        }),
      () =>
        new ImagePlanEvaluationAgentV3(client).evaluate({
          planningInput: {},
          imagePlan: { status: "blocked" },
        }),
      () =>
        new ImagePromptEvaluationAgentV3(client).evaluate({
          promptBuildPackage: {},
          promptResult: {},
          lint: {},
        }),
      () => new GeneratedImageEvaluationAgentV3(client).evaluate({}),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toThrow("stop after capturing the schema");
    }
    expect(captured).toHaveLength(calls.length);
    captured.forEach((schema, index) =>
      expect(() =>
        assertStrictSchemaCompatible(schema, `evaluator ${index}`),
      ).not.toThrow(),
    );
  });
});

describe("assertStrictSchemaCompatible", () => {
  const wrap = (properties: Record<string, unknown>) => ({
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  });

  it("rejects a non-object root", () => {
    expect(() =>
      assertStrictSchemaCompatible({ anyOf: [{ type: "object" }] }, "root"),
    ).toThrow(/루트는 type "object"/);
  });

  it("rejects oneOf anywhere", () => {
    expect(() =>
      assertStrictSchemaCompatible(
        wrap({ a: { oneOf: [{ type: "string" }] } }),
        "s",
      ),
    ).toThrow(/oneOf/);
  });

  it("rejects uniqueItems", () => {
    expect(() =>
      assertStrictSchemaCompatible(
        wrap({
          a: { type: "array", uniqueItems: true, items: { type: "string" } },
        }),
        "s",
      ),
    ).toThrow(/uniqueItems/);
  });

  it("rejects const without type", () => {
    expect(() =>
      assertStrictSchemaCompatible(wrap({ a: { const: "ready" } }), "s"),
    ).toThrow(/const/);
  });

  it("rejects an optional property", () => {
    expect(() =>
      assertStrictSchemaCompatible(
        {
          type: "object",
          properties: { a: { type: "string" }, b: { type: "string" } },
          required: ["a"],
          additionalProperties: false,
        },
        "s",
      ),
    ).toThrow(/required/);
  });

  it("rejects a missing additionalProperties", () => {
    expect(() =>
      assertStrictSchemaCompatible(
        { type: "object", properties: {}, required: [] },
        "s",
      ),
    ).toThrow(/additionalProperties/);
  });

  it("accepts nested anyOf and length bounds", () => {
    expect(() =>
      assertStrictSchemaCompatible(
        wrap({
          a: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
          b: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: { type: "string" },
          },
        }),
        "s",
      ),
    ).not.toThrow();
  });
});

describe("rootUnionSchema", () => {
  const variant = (status: string) => ({
    type: "object",
    properties: { status: { type: "string", enum: [status] } },
    required: ["status"],
    additionalProperties: false,
  });

  it("wraps variants in a single object property", () => {
    const schema = rootUnionSchema([variant("ready"), variant("blocked")]);
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties as object)).toEqual([
      UNION_ENVELOPE_KEY,
    ]);
    expect(isRootUnionSchema(schema)).toBe(true);
  });

  it("does not treat a plain object schema as a union", () => {
    expect(isRootUnionSchema(variant("ready"))).toBe(false);
    expect(
      isRootUnionSchema({
        type: "object",
        properties: { result: { type: "string" } },
        required: ["result"],
        additionalProperties: false,
      }),
    ).toBe(false);
  });
});
