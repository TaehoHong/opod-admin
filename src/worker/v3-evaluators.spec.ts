import {
  GENERATED_SET_DIMENSIONS,
  GENERATED_SHOT_DIMENSIONS,
  IMAGE_PROMPT_DIMENSIONS,
  POST_EVALUATOR_READY_DIMENSIONS,
} from "../../prompts/v3-evaluators";
import {
  GeneratedImageEvaluationAgentV3,
  parseTextEvaluation,
} from "./v3-evaluators";

function scores(dimensions: readonly string[], score = 5) {
  return Object.fromEntries(dimensions.map((dimension) => [dimension, score]));
}

describe("V3 evaluation contracts", () => {
  it("requires every fixed Post dimension and matching evidence for every defect", () => {
    expect(
      parseTextEvaluation(
        {
          status: "evaluated_ready",
          operatorRequestEvaluation: {
            provided: false,
            postPlanningRequirementsPresent: false,
            assessment: "not_supplied",
            reason: "요청 없음",
          },
          scores: scores(POST_EVALUATOR_READY_DIMENSIONS),
          issues: [],
          verdict: "pass",
        },
        POST_EVALUATOR_READY_DIMENSIONS,
        ["pass", "issues_found"],
      ),
    ).toMatchObject({ verdict: "pass" });

    expect(() =>
      parseTextEvaluation(
        {
          status: "evaluated_ready",
          scores: {
            ...scores(POST_EVALUATOR_READY_DIMENSIONS),
            memory_discipline: 3,
          },
          issues: [],
          verdict: "issues_found",
        },
        POST_EVALUATOR_READY_DIMENSIONS,
        ["pass", "issues_found"],
      ),
    ).toThrow("score/issue mismatch for memory_discipline");
  });

  it("keeps Prompt evaluator generation settings out of its fixed dimensions", () => {
    expect(IMAGE_PROMPT_DIMENSIONS).toEqual([
      "shot_contract_fidelity",
      "character_contract_fidelity",
      "continuity_encoding",
      "reference_contract_fidelity",
      "model_policy_compliance",
      "negative_prompt_safety",
      "data_boundary",
      "scope_compliance",
    ]);
  });

  it("distinguishes no-contract N/A from an applicable generated-image contract", async () => {
    const shotDimensions = Object.fromEntries(
      GENERATED_SHOT_DIMENSIONS.map((dimension) => [
        dimension,
        {
          applicable: ![
            "identity_and_appearance",
            "reference_adherence",
            "style_fidelity",
            "text_fidelity",
          ].includes(dimension),
          score: [
            "identity_and_appearance",
            "reference_adherence",
            "style_fidelity",
            "text_fidelity",
          ].includes(dimension)
            ? null
            : 5,
        },
      ]),
    );
    const setDimensions = Object.fromEntries(
      GENERATED_SET_DIMENSIONS.map((dimension) => [
        dimension,
        { applicable: false, score: null },
      ]),
    );
    const client = {
      run: jest.fn().mockResolvedValue({
        producerLogId: "1",
        value: {
          status: "evaluated_generated_images",
          shots: [
            {
              sortOrder: 0,
              dimensions: shotDimensions,
              issues: [],
            },
          ],
          setDimensions,
          setIssues: [],
          verdict: "pass",
        },
      }),
    };

    await expect(
      new GeneratedImageEvaluationAgentV3(client as never).evaluate({}),
    ).resolves.toMatchObject({ verdict: "pass" });

    client.run.mockResolvedValueOnce({
      producerLogId: "2",
      value: {
        status: "evaluated_generated_images",
        shots: [
          {
            sortOrder: 0,
            dimensions: {
              ...shotDimensions,
              identity_and_appearance: { applicable: true, score: null },
            },
            issues: [],
          },
        ],
        setDimensions,
        setIssues: [],
        verdict: "pass",
      },
    });
    await expect(
      new GeneratedImageEvaluationAgentV3(client as never).evaluate({}),
    ).rejects.toThrow("applicability mismatch for identity_and_appearance");
  });
});
