import { rootUnionSchema } from "./strict-schema";

export const IMAGE_PLANNER_PROMPT_VERSION = "image-planner-v10";
export const IMAGE_PLAN_CONTRACT_VERSION = "image-plan-v4";

const text = (maxLength: number) => ({
  type: "string",
  minLength: 1,
  maxLength,
});
const binding = {
  type: "object",
  properties: {
    bindingId: text(200),
    id: text(200),
    source: { type: "string", enum: ["identity", "environment"] },
    semanticPurposes: {
      type: "array",
      minItems: 1,
      items: {
        type: "string",
        enum: ["identity", "wardrobe", "framing", "environment"],
      },
    },
    preserve: { type: "array", minItems: 1, items: text(2_000) },
    avoidCopying: { type: "array", items: text(2_000) },
  },
  required: [
    "bindingId",
    "id",
    "source",
    "semanticPurposes",
    "preserve",
    "avoidCopying",
  ],
  additionalProperties: false,
};

// 배열 중복 금지(semanticPurposes·preserve·avoidCopying·visibleParts·
// appliesToShots)는 스키마가 아니라 parseImagePlan이 강제한다 — structured
// outputs가 uniqueItems를 받지 않는다.
export const IMAGE_PLAN_JSON_SCHEMA = rootUnionSchema([
  {
    type: "object",
    properties: {
      status: { type: "string", enum: ["ready"] },
      locationId: { anyOf: [text(200), { type: "null" }] },
      continuity: {
        type: "object",
        properties: {
          lockedElements: {
            type: "array",
            maxItems: 30,
            items: {
              type: "object",
              properties: {
                category: {
                  type: "string",
                  enum: [
                    "identity",
                    "wardrobe",
                    "environment",
                    "prop",
                    "lighting",
                  ],
                },
                description: text(2_000),
                appliesToShots: {
                  type: "array",
                  minItems: 2,
                  items: { type: "integer", minimum: 0, maximum: 2 },
                },
              },
              required: ["category", "description", "appliesToShots"],
              additionalProperties: false,
            },
          },
        },
        required: ["lockedElements"],
        additionalProperties: false,
      },
      shots: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            sortOrder: { type: "integer", minimum: 0, maximum: 2 },
            visualPurpose: text(1_000),
            scene: text(4_000),
            captureSetup: text(2_000),
            characterPresentation: {
              type: "object",
              properties: {
                mode: {
                  type: "string",
                  enum: ["none", "full", "partial", "reflection", "silhouette"],
                },
                visibleParts: { type: "array", items: text(200) },
                faceVisible: { type: "boolean" },
                identityPreservationRequired: { type: "boolean" },
              },
              required: [
                "mode",
                "visibleParts",
                "faceVisible",
                "identityPreservationRequired",
              ],
              additionalProperties: false,
            },
            subjectState: { type: "string", maxLength: 1_000 },
            motionEvidence: { type: "string", maxLength: 1_000 },
            notInFrame: {
              type: "array",
              maxItems: 10,
              items: text(300),
            },
            subjectCameraRelation: {
              type: "string",
              enum: [
                "unaware",
                "aware_unposed",
                "deliberately_posed",
                "not_applicable",
              ],
            },
            referenceBindings: { type: "array", maxItems: 5, items: binding },
          },
          required: [
            "sortOrder",
            "visualPurpose",
            "scene",
            "captureSetup",
            "characterPresentation",
            "subjectState",
            "motionEvidence",
            "notInFrame",
            "subjectCameraRelation",
            "referenceBindings",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["status", "locationId", "continuity", "shots"],
    additionalProperties: false,
  },
  {
    type: "object",
    properties: {
      status: { type: "string", enum: ["blocked"] },
      reasons: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            code: {
              type: "string",
              enum: [
                "visual_constraint_conflict",
                "unsupported_multi_location",
                "unsupported_secondary_identity",
                "missing_identity_reference",
                "insufficient_distinct_shots",
              ],
            },
            detail: text(2_000),
            evidence: {
              type: "object",
              properties: {
                requirements: {
                  type: "array",
                  minItems: 1,
                  maxItems: 10,
                  items: {
                    type: "object",
                    properties: { path: text(300), quote: text(2_000) },
                    required: ["path", "quote"],
                    additionalProperties: false,
                  },
                },
                referenceChecks: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: text(200),
                      suitable: { type: "boolean" },
                    },
                    required: ["id", "suitable"],
                    additionalProperties: false,
                  },
                },
                alternatives: {
                  type: "array",
                  minItems: 1,
                  maxItems: 10,
                  items: {
                    type: "object",
                    properties: {
                      description: text(2_000),
                      satisfiesRequirements: { type: "boolean" },
                    },
                    required: ["description", "satisfiesRequirements"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["requirements", "referenceChecks", "alternatives"],
              additionalProperties: false,
            },
          },
          required: ["code", "detail", "evidence"],
          additionalProperties: false,
        },
      },
    },
    required: ["status", "reasons"],
    additionalProperties: false,
  },
]);
