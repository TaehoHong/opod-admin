import {
  GENERATED_IMAGE_EVALUATOR_SYSTEM_PROMPT,
  GENERATED_SET_DIMENSIONS,
  GENERATED_SHOT_DIMENSIONS,
  IMAGE_PLAN_BLOCKED_DIMENSIONS,
  IMAGE_PLAN_EVALUATOR_SYSTEM_PROMPT,
  IMAGE_PLAN_READY_DIMENSIONS,
  IMAGE_PROMPT_DIMENSIONS,
  IMAGE_PROMPT_EVALUATOR_SYSTEM_PROMPT,
  POST_EVALUATOR_CONFLICT_DIMENSIONS,
  POST_EVALUATOR_READY_DIMENSIONS,
  POST_EVALUATOR_SYSTEM_PROMPT,
} from "../../prompts/v3-evaluators";
import { LlmLogContext } from "../domain/llm-logs/llm-log.service";
import { StrictJsonAgentClient } from "./strict-json-agent";
import { isRecord } from "./value-utils";

type EvaluationIssue = {
  dimension: string;
  severity: "minor" | "major" | "critical";
  detail: string;
  evidence: string[];
};
export type TextEvaluationResult = {
  status: string;
  verdict: string;
  scores: Record<string, number>;
  issues: EvaluationIssue[];
  [key: string]: unknown;
};

const scoreSchema = (dimensions: readonly string[]) => ({
  type: "object",
  properties: Object.fromEntries(
    dimensions.map((dimension) => [
      dimension,
      { type: "integer", minimum: 1, maximum: 5 },
    ]),
  ),
  required: [...dimensions],
  additionalProperties: false,
});
const issueSchema = (dimensions: readonly string[], withShots = false) => ({
  type: "object",
  properties: {
    dimension: { type: "string", enum: [...dimensions] },
    severity: { type: "string", enum: ["minor", "major", "critical"] },
    ...(withShots
      ? {
          shotSortOrders: {
            type: "array",
            items: { type: "integer", minimum: 0, maximum: 2 },
          },
        }
      : {}),
    detail: { type: "string", minLength: 1, maxLength: 2_000 },
    evidence: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: { type: "string", minLength: 1, maxLength: 2_000 },
    },
  },
  required: [
    "dimension",
    "severity",
    ...(withShots ? ["shotSortOrders"] : []),
    "detail",
    "evidence",
  ],
  additionalProperties: false,
});
const operatorSchema = (visual: boolean) => ({
  type: "object",
  properties: {
    provided: { type: "boolean" },
    [visual ? "visualRequirementsPresent" : "postPlanningRequirementsPresent"]:
      { type: "boolean" },
    assessment: {
      type: "string",
      enum: visual
        ? [
            "not_supplied",
            "no_visual_requirement",
            "fulfilled",
            "partially_fulfilled",
            "unfulfilled",
            "constrained_by_visual_contract",
            "blocked_by_visual_requirement_conflict",
            "not_assessed_due_input_block",
            "not_assessed_due_invalid_plan_status",
          ]
        : [
            "not_supplied",
            "no_post_planning_requirement",
            "fulfilled",
            "partially_fulfilled",
            "unfulfilled",
            "constrained_by_character_contract",
            "blocked_by_requirement_conflict",
          ],
    },
    reason: { type: "string", minLength: 1, maxLength: 2_000 },
  },
  required: [
    "provided",
    visual ? "visualRequirementsPresent" : "postPlanningRequirementsPresent",
    "assessment",
    "reason",
  ],
  additionalProperties: false,
});

export class PostEvaluationAgentV3 {
  constructor(private readonly client: StrictJsonAgentClient) {}
  async evaluate(
    input: { planningInput: unknown; postPlan: unknown },
    context?: LlmLogContext,
  ) {
    const status = isRecord(input.postPlan) ? input.postPlan.status : null;
    const dimensions =
      status === "conflict"
        ? POST_EVALUATOR_CONFLICT_DIMENSIONS
        : POST_EVALUATOR_READY_DIMENSIONS;
    const verdicts =
      status === "conflict"
        ? ["valid_conflict", "invalid_conflict", "incomplete_conflict"]
        : ["pass", "issues_found"];
    return this.run(input, dimensions, String(status), verdicts, context);
  }
  private async run(
    input: unknown,
    dimensions: readonly string[],
    evaluatedStatus: string,
    verdicts: string[],
    context?: LlmLogContext,
  ): Promise<TextEvaluationResult> {
    const schema = {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: [
            evaluatedStatus === "conflict"
              ? "evaluated_conflict"
              : "evaluated_ready",
          ],
        },
        operatorRequestEvaluation: operatorSchema(false),
        scores: scoreSchema(dimensions),
        issues: { type: "array", items: issueSchema(dimensions) },
        verdict: { type: "string", enum: verdicts },
      },
      required: [
        "status",
        "operatorRequestEvaluation",
        "scores",
        "issues",
        "verdict",
      ],
      additionalProperties: false,
    };
    const result = await this.client.run({
      logType: "admin.plan.evaluate",
      schemaName: "opod_post_evaluation_v1",
      schema,
      systemPrompt: POST_EVALUATOR_SYSTEM_PROMPT,
      input,
      context,
    });
    const parsed = parseTextEvaluation(result.value, dimensions, verdicts);
    if (evaluatedStatus === "conflict") {
      validateQualificationVerdict(
        parsed,
        "conflict_qualification",
        ["conflict_grounding", "conflict_completeness"],
        "valid_conflict",
        "incomplete_conflict",
        "invalid_conflict",
      );
    }
    return parsed;
  }
}

export class ImagePlanEvaluationAgentV3 {
  constructor(private readonly client: StrictJsonAgentClient) {}
  async evaluate(
    input: { planningInput: unknown; imagePlan: unknown },
    context?: LlmLogContext,
  ) {
    const blocked =
      isRecord(input.imagePlan) && input.imagePlan.status === "blocked";
    const dimensions = blocked
      ? IMAGE_PLAN_BLOCKED_DIMENSIONS
      : IMAGE_PLAN_READY_DIMENSIONS;
    const verdicts = blocked
      ? ["valid_block", "incomplete_block", "invalid_block"]
      : ["pass", "issues_found"];
    const schema = {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: [blocked ? "evaluated_blocked" : "evaluated_ready"],
        },
        operatorVisualRequestEvaluation: operatorSchema(true),
        scores: scoreSchema(dimensions),
        issues: { type: "array", items: issueSchema(dimensions) },
        verdict: { type: "string", enum: verdicts },
      },
      required: [
        "status",
        "operatorVisualRequestEvaluation",
        "scores",
        "issues",
        "verdict",
      ],
      additionalProperties: false,
    };
    const result = await this.client.run({
      logType: "admin.plan.evaluate",
      schemaName: "opod_image_plan_evaluation_v1",
      schema,
      systemPrompt: IMAGE_PLAN_EVALUATOR_SYSTEM_PROMPT,
      input,
      context,
    });
    const parsed = parseTextEvaluation(result.value, dimensions, verdicts);
    if (blocked) {
      validateQualificationVerdict(
        parsed,
        "block_qualification",
        ["block_grounding", "block_completeness"],
        "valid_block",
        "incomplete_block",
        "invalid_block",
      );
    }
    return parsed;
  }
}

export class ImagePromptEvaluationAgentV3 {
  constructor(private readonly client: StrictJsonAgentClient) {}
  async evaluate(
    input: {
      promptBuildPackage: unknown;
      promptResult: unknown;
      lint: unknown;
    },
    context?: LlmLogContext,
  ) {
    const schema = {
      type: "object",
      properties: {
        status: { type: "string", enum: ["evaluated_prompt_result"] },
        scores: scoreSchema(IMAGE_PROMPT_DIMENSIONS),
        issues: {
          type: "array",
          items: issueSchema(IMAGE_PROMPT_DIMENSIONS, true),
        },
        verdict: { type: "string", enum: ["pass", "issues_found"] },
      },
      required: ["status", "scores", "issues", "verdict"],
      additionalProperties: false,
    };
    const result = await this.client.run({
      logType: "admin.prompt.evaluate",
      schemaName: "opod_image_prompt_evaluation_v1",
      schema,
      systemPrompt: IMAGE_PROMPT_EVALUATOR_SYSTEM_PROMPT,
      input,
      context,
    });
    return parseTextEvaluation(result.value, IMAGE_PROMPT_DIMENSIONS, [
      "pass",
      "issues_found",
    ]);
  }
}

const nullableDimensionSchema = (dimensions: readonly string[]) => ({
  type: "object",
  properties: Object.fromEntries(
    dimensions.map((dimension) => [
      dimension,
      {
        type: "object",
        properties: {
          applicable: { type: "boolean" },
          score: {
            anyOf: [
              { type: "integer", minimum: 1, maximum: 5 },
              { type: "null" },
            ],
          },
        },
        required: ["applicable", "score"],
        additionalProperties: false,
      },
    ]),
  ),
  required: [...dimensions],
  additionalProperties: false,
});

export class GeneratedImageEvaluationAgentV3 {
  constructor(private readonly client: StrictJsonAgentClient) {}
  async evaluate(
    input: unknown,
    context?: LlmLogContext,
    userContent?: unknown,
  ) {
    const shotIssue = {
      type: "object",
      properties: {
        dimension: { type: "string", enum: [...GENERATED_SHOT_DIMENSIONS] },
        severity: { type: "string", enum: ["minor", "major", "critical"] },
        generatedEvidence: { type: "string", minLength: 1, maxLength: 2_000 },
        contractEvidence: { type: "string", minLength: 1, maxLength: 2_000 },
        referenceBindingId: {
          anyOf: [
            { type: "string", minLength: 1, maxLength: 200 },
            { type: "null" },
          ],
        },
        detail: { type: "string", minLength: 1, maxLength: 2_000 },
      },
      required: [
        "dimension",
        "severity",
        "generatedEvidence",
        "contractEvidence",
        "referenceBindingId",
        "detail",
      ],
      additionalProperties: false,
    };
    const setIssue = {
      type: "object",
      properties: {
        dimension: { type: "string", enum: [...GENERATED_SET_DIMENSIONS] },
        severity: { type: "string", enum: ["minor", "major", "critical"] },
        sortOrders: {
          type: "array",
          minItems: 2,
          items: { type: "integer", minimum: 0, maximum: 2 },
        },
        generatedEvidence: { type: "string", minLength: 1, maxLength: 2_000 },
        contractEvidence: { type: "string", minLength: 1, maxLength: 2_000 },
        detail: { type: "string", minLength: 1, maxLength: 2_000 },
      },
      required: [
        "dimension",
        "severity",
        "sortOrders",
        "generatedEvidence",
        "contractEvidence",
        "detail",
      ],
      additionalProperties: false,
    };
    const schema = {
      type: "object",
      properties: {
        status: { type: "string", enum: ["evaluated_generated_images"] },
        shots: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          items: {
            type: "object",
            properties: {
              sortOrder: { type: "integer", minimum: 0, maximum: 2 },
              dimensions: nullableDimensionSchema(GENERATED_SHOT_DIMENSIONS),
              issues: { type: "array", items: shotIssue },
            },
            required: ["sortOrder", "dimensions", "issues"],
            additionalProperties: false,
          },
        },
        setDimensions: nullableDimensionSchema(GENERATED_SET_DIMENSIONS),
        setIssues: { type: "array", items: setIssue },
        verdict: { type: "string", enum: ["pass", "issues_found"] },
      },
      required: ["status", "shots", "setDimensions", "setIssues", "verdict"],
      additionalProperties: false,
    };
    const result = await this.client.run({
      logType: "admin.image.evaluate",
      schemaName: "opod_generated_image_evaluation_v1",
      schema,
      systemPrompt: GENERATED_IMAGE_EVALUATOR_SYSTEM_PROMPT,
      input,
      userContent,
      context,
    });
    return parseGeneratedEvaluation(result.value);
  }
}

export function parseTextEvaluation(
  value: unknown,
  dimensions: readonly string[],
  verdicts: readonly string[],
): TextEvaluationResult {
  if (
    !isRecord(value) ||
    !isRecord(value.scores) ||
    !Array.isArray(value.issues) ||
    typeof value.status !== "string" ||
    typeof value.verdict !== "string" ||
    !verdicts.includes(value.verdict)
  )
    throw new Error("evaluation result is invalid");
  const scoreKeys = Object.keys(value.scores).sort();
  if (scoreKeys.join("|") !== [...dimensions].sort().join("|"))
    throw new Error("evaluation score keys are invalid");
  const scores: Record<string, number> = {};
  for (const dimension of dimensions) {
    const score = value.scores[dimension];
    if (
      !Number.isInteger(score) ||
      (score as number) < 1 ||
      (score as number) > 5
    )
      throw new Error(`evaluation score ${dimension} is invalid`);
    scores[dimension] = score as number;
  }
  const issues = value.issues.map((issue, index) => {
    if (
      !isRecord(issue) ||
      typeof issue.dimension !== "string" ||
      !dimensions.includes(issue.dimension) ||
      !["minor", "major", "critical"].includes(String(issue.severity)) ||
      typeof issue.detail !== "string" ||
      !issue.detail.trim() ||
      !Array.isArray(issue.evidence) ||
      issue.evidence.length === 0 ||
      issue.evidence.some((item) => typeof item !== "string" || !item.trim())
    )
      throw new Error(`evaluation issue ${index} is invalid`);
    return {
      dimension: issue.dimension,
      severity: issue.severity as EvaluationIssue["severity"],
      detail: issue.detail.trim(),
      evidence: issue.evidence as string[],
    };
  });
  for (const dimension of dimensions) {
    if (
      scores[dimension] < 5 !==
      issues.some((issue) => issue.dimension === dimension)
    )
      throw new Error(`evaluation score/issue mismatch for ${dimension}`);
  }
  const passes =
    Object.values(scores).every((score) => score >= 4) &&
    issues.every((issue) => issue.severity === "minor");
  if ((value.verdict === "pass") !== passes && verdicts.includes("pass"))
    throw new Error("evaluation verdict is inconsistent");
  return { ...value, scores, issues } as TextEvaluationResult;
}

function validateQualificationVerdict(
  result: TextEvaluationResult,
  qualification: string,
  detailDimensions: string[],
  valid: string,
  incomplete: string,
  invalid: string,
): void {
  const expected =
    result.scores[qualification] <= 3
      ? invalid
      : detailDimensions.some((dimension) => result.scores[dimension] <= 3)
        ? incomplete
        : result.issues.some((issue) => issue.severity !== "minor")
          ? incomplete
          : valid;
  if (result.verdict !== expected) {
    throw new Error("evaluation qualification verdict is inconsistent");
  }
}

function parseGeneratedEvaluation(value: unknown) {
  if (
    !isRecord(value) ||
    !Array.isArray(value.shots) ||
    !isRecord(value.setDimensions) ||
    !Array.isArray(value.setIssues) ||
    (value.verdict !== "pass" && value.verdict !== "issues_found")
  )
    throw new Error("generated image evaluation is invalid");
  const allIssues: { dimension: string; severity: string }[] = [];
  value.shots.forEach((shot, index) => {
    if (
      !isRecord(shot) ||
      shot.sortOrder !== index ||
      !isRecord(shot.dimensions) ||
      !Array.isArray(shot.issues)
    )
      throw new Error(`generated evaluation shot ${index} is invalid`);
    validateNullableDimensions(
      shot.dimensions,
      GENERATED_SHOT_DIMENSIONS,
      shot.issues,
    );
    for (const issue of shot.issues)
      if (isRecord(issue))
        allIssues.push({
          dimension: String(issue.dimension),
          severity: String(issue.severity),
        });
  });
  validateNullableDimensions(
    value.setDimensions,
    GENERATED_SET_DIMENSIONS,
    value.setIssues,
  );
  for (const issue of value.setIssues)
    if (isRecord(issue))
      allIssues.push({
        dimension: String(issue.dimension),
        severity: String(issue.severity),
      });
  const scores = [
    ...value.shots.flatMap((shot) =>
      isRecord(shot) && isRecord(shot.dimensions)
        ? Object.values(shot.dimensions).flatMap((dimension) =>
            isRecord(dimension) && typeof dimension.score === "number"
              ? [dimension.score]
              : [],
          )
        : [],
    ),
    ...Object.values(value.setDimensions).flatMap((dimension) =>
      isRecord(dimension) && typeof dimension.score === "number"
        ? [dimension.score]
        : [],
    ),
  ];
  const passes =
    scores.every((score) => score >= 4) &&
    allIssues.every((issue) => issue.severity === "minor");
  if ((value.verdict === "pass") !== passes)
    throw new Error("generated image evaluation verdict is inconsistent");
  return value;
}

function validateNullableDimensions(
  value: Record<string, unknown>,
  dimensions: readonly string[],
  issues: unknown[],
): void {
  if (Object.keys(value).sort().join("|") !== [...dimensions].sort().join("|"))
    throw new Error("generated evaluation dimension keys are invalid");
  for (const dimension of dimensions) {
    const entry = value[dimension];
    if (
      !isRecord(entry) ||
      typeof entry.applicable !== "boolean" ||
      !(
        entry.score === null ||
        (Number.isInteger(entry.score) &&
          (entry.score as number) >= 1 &&
          (entry.score as number) <= 5)
      )
    )
      throw new Error(`generated evaluation ${dimension} is invalid`);
    const hasIssue = issues.some(
      (issue) => isRecord(issue) && issue.dimension === dimension,
    );
    if (
      (!entry.applicable && (entry.score !== null || hasIssue)) ||
      (entry.applicable &&
        (typeof entry.score !== "number" ||
          (entry.score as number) < 5 !== hasIssue))
    )
      throw new Error(
        `generated evaluation applicability mismatch for ${dimension}`,
      );
  }
}
