import {
  IMAGE_PLAN_JSON_SCHEMA,
  IMAGE_PLANNER_SYSTEM_PROMPT,
} from "../../prompts/image-planner";
import {
  LLM_LOG_TYPE,
  LlmLogContext,
} from "../domain/llm-logs/llm-log.service";
import { StrictJsonAgentClient } from "./strict-json-agent";
import { isRecord } from "./value-utils";

export type ImagePlannerInput = {
  postPlan: {
    intent: {
      premise: string;
      primaryPurpose: string;
      secondaryPurpose: string | null;
    };
    caption: string;
  };
  imageCount: number;
  characterVisualContext: {
    name: string;
    appearance: string;
    visualStyle: string;
    boundaries: string[];
    relevantContext: string[];
  };
  operatorRequest?: string;
  identityReferences: { id: string; description: string }[];
  locations: {
    id: string;
    name: string;
    description: string;
    references: { id: string; description: string }[];
  }[];
};

export type ReferenceBinding = {
  bindingId: string;
  id: string;
  source: "identity" | "environment";
  semanticPurposes: ("identity" | "wardrobe" | "framing" | "environment")[];
  preserve: string[];
  avoidCopying: string[];
};
export type ImagePlanReady = {
  status: "ready";
  locationId: string | null;
  continuity: {
    lockedElements: {
      category: "identity" | "wardrobe" | "environment" | "prop" | "lighting";
      description: string;
      appliesToShots: number[];
    }[];
  };
  shots: {
    sortOrder: number;
    visualPurpose: string;
    scene: string;
    captureSetup: string;
    characterPresentation: {
      mode: "none" | "full" | "partial" | "reflection" | "silhouette";
      visibleParts: string[];
      faceVisible: boolean;
      identityPreservationRequired: boolean;
    };
    referenceBindings: ReferenceBinding[];
  }[];
};
export type ImagePlanBlocked = {
  status: "blocked";
  reasons: {
    code:
      | "visual_constraint_conflict"
      | "unsupported_multi_location"
      | "unsupported_secondary_identity"
      | "missing_identity_reference"
      | "insufficient_distinct_shots";
    detail: string;
  }[];
};
export type ImagePlan = ImagePlanReady | ImagePlanBlocked;

const MODES = new Set(["none", "full", "partial", "reflection", "silhouette"]);
const CATEGORIES = new Set([
  "identity",
  "wardrobe",
  "environment",
  "prop",
  "lighting",
]);
const PURPOSES = new Set(["identity", "wardrobe", "framing", "environment"]);
const BLOCK_CODES = new Set([
  "visual_constraint_conflict",
  "unsupported_multi_location",
  "unsupported_secondary_identity",
  "missing_identity_reference",
  "insufficient_distinct_shots",
]);

export class ImagePlanningAgent {
  constructor(private readonly client: StrictJsonAgentClient) {}
  async plan(
    input: ImagePlannerInput,
    context?: LlmLogContext,
  ): Promise<{ output: ImagePlan; producerLogId: string | null }> {
    const result = await this.client.run({
      logType: LLM_LOG_TYPE.imagePlanV3,
      schemaName: "opod_image_plan_v1",
      schema: IMAGE_PLAN_JSON_SCHEMA as unknown as Record<string, unknown>,
      systemPrompt: IMAGE_PLANNER_SYSTEM_PROMPT,
      input,
      context,
    });
    return {
      output: parseImagePlan(result.value, input),
      producerLogId: result.producerLogId,
    };
  }
}

export function parseImagePlan(
  value: unknown,
  input: ImagePlannerInput,
): ImagePlan {
  if (
    !isRecord(value) ||
    (value.status !== "ready" && value.status !== "blocked")
  )
    throw new Error("image plan has invalid status");
  if (value.status === "blocked") {
    exactKeys(value, ["status", "reasons"], "blocked image plan");
    if (
      !Array.isArray(value.reasons) ||
      value.reasons.length === 0 ||
      value.reasons.length > 10
    )
      throw new Error("blocked image plan requires reasons");
    return {
      status: "blocked",
      reasons: value.reasons.map((reason, index) => {
        if (!isRecord(reason))
          throw new Error(`blocked reason ${index} is invalid`);
        exactKeys(reason, ["code", "detail"], `blocked reason ${index}`);
        if (typeof reason.code !== "string" || !BLOCK_CODES.has(reason.code))
          throw new Error(`blocked reason ${index} has invalid code`);
        return {
          code: reason.code as ImagePlanBlocked["reasons"][number]["code"],
          detail: text(reason.detail, 2_000, `blocked reason ${index}`),
        };
      }),
    };
  }
  exactKeys(
    value,
    ["status", "locationId", "continuity", "shots"],
    "ready image plan",
  );
  const locationIds = new Set(input.locations.map((location) => location.id));
  const locationId =
    value.locationId === null
      ? null
      : text(value.locationId, 200, "locationId");
  if (locationId !== null && !locationIds.has(locationId))
    throw new Error("image plan selected an unknown location");
  if (!Array.isArray(value.shots) || value.shots.length !== input.imageCount)
    throw new Error("image plan shot count does not match imageCount");
  const identityIds = new Set(
    input.identityReferences.map((reference) => reference.id),
  );
  const environmentIds = new Set(
    input.locations
      .find((location) => location.id === locationId)
      ?.references.map((reference) => reference.id) ?? [],
  );
  const bindingIds = new Set<string>();
  const shots = value.shots.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`image plan shot ${index} is invalid`);
    exactKeys(
      raw,
      [
        "sortOrder",
        "visualPurpose",
        "scene",
        "captureSetup",
        "characterPresentation",
        "referenceBindings",
      ],
      `image plan shot ${index}`,
    );
    if (raw.sortOrder !== index)
      throw new Error(`image plan shot ${index} has invalid sortOrder`);
    if (!isRecord(raw.characterPresentation))
      throw new Error(`image plan shot ${index} presentation is invalid`);
    const cp = raw.characterPresentation;
    exactKeys(
      cp,
      ["mode", "visibleParts", "faceVisible", "identityPreservationRequired"],
      `image plan shot ${index} presentation`,
    );
    if (
      typeof cp.mode !== "string" ||
      !MODES.has(cp.mode) ||
      typeof cp.faceVisible !== "boolean" ||
      typeof cp.identityPreservationRequired !== "boolean"
    )
      throw new Error(`image plan shot ${index} presentation is invalid`);
    const visibleParts = textArray(
      cp.visibleParts,
      0,
      20,
      200,
      `shot ${index} visibleParts`,
    );
    if (
      cp.mode === "none" &&
      (visibleParts.length || cp.faceVisible || cp.identityPreservationRequired)
    )
      throw new Error(
        `image plan shot ${index} none presentation is contradictory`,
      );
    if (cp.faceVisible && !cp.identityPreservationRequired)
      throw new Error(
        `image plan shot ${index} visible face requires identity preservation`,
      );
    if (
      !Array.isArray(raw.referenceBindings) ||
      raw.referenceBindings.length > 5
    )
      throw new Error(`image plan shot ${index} bindings are invalid`);
    const referenceBindings = raw.referenceBindings.map(
      (binding, bindingIndex) =>
        parseBinding(
          binding,
          index,
          bindingIndex,
          identityIds,
          environmentIds,
          bindingIds,
        ),
    );
    if (
      cp.identityPreservationRequired &&
      !referenceBindings.some(
        (binding) =>
          binding.source === "identity" &&
          binding.semanticPurposes.includes("identity"),
      )
    )
      throw new Error(`image plan shot ${index} lacks an identity binding`);
    return {
      sortOrder: index,
      visualPurpose: text(
        raw.visualPurpose,
        1_000,
        `shot ${index} visualPurpose`,
      ),
      scene: text(raw.scene, 4_000, `shot ${index} scene`),
      captureSetup: text(raw.captureSetup, 2_000, `shot ${index} captureSetup`),
      characterPresentation: {
        mode: cp.mode as ImagePlanReady["shots"][number]["characterPresentation"]["mode"],
        visibleParts,
        faceVisible: cp.faceVisible,
        identityPreservationRequired: cp.identityPreservationRequired,
      },
      referenceBindings,
    };
  });
  if (!isRecord(value.continuity))
    throw new Error("image plan continuity is invalid");
  exactKeys(value.continuity, ["lockedElements"], "image plan continuity");
  if (
    !Array.isArray(value.continuity.lockedElements) ||
    value.continuity.lockedElements.length > 30
  )
    throw new Error("lockedElements is invalid");
  const lockedElements = value.continuity.lockedElements.map((lock, index) => {
    if (!isRecord(lock)) throw new Error(`locked element ${index} is invalid`);
    exactKeys(
      lock,
      ["category", "description", "appliesToShots"],
      `locked element ${index}`,
    );
    if (typeof lock.category !== "string" || !CATEGORIES.has(lock.category))
      throw new Error(`locked element ${index} has invalid category`);
    const applies = numberArray(lock.appliesToShots, `locked element ${index}`);
    if (
      applies.length < 2 ||
      applies.some((shot) => shot < 0 || shot >= input.imageCount)
    )
      throw new Error(`locked element ${index} has invalid shot scope`);
    return {
      category:
        lock.category as ImagePlanReady["continuity"]["lockedElements"][number]["category"],
      description: text(lock.description, 2_000, `locked element ${index}`),
      appliesToShots: applies,
    };
  });
  return { status: "ready", locationId, continuity: { lockedElements }, shots };
}

function parseBinding(
  value: unknown,
  shot: number,
  index: number,
  identityIds: Set<string>,
  environmentIds: Set<string>,
  bindingIds: Set<string>,
): ReferenceBinding {
  if (!isRecord(value))
    throw new Error(`shot ${shot} binding ${index} is invalid`);
  exactKeys(
    value,
    [
      "bindingId",
      "id",
      "source",
      "semanticPurposes",
      "preserve",
      "avoidCopying",
    ],
    `shot ${shot} binding ${index}`,
  );
  const bindingId = text(value.bindingId, 200, `shot ${shot} bindingId`);
  if (bindingIds.has(bindingId))
    throw new Error(`duplicate bindingId ${bindingId}`);
  bindingIds.add(bindingId);
  if (value.source !== "identity" && value.source !== "environment")
    throw new Error(`shot ${shot} binding ${index} has invalid source`);
  const id = text(value.id, 200, `shot ${shot} binding id`);
  if (!(value.source === "identity" ? identityIds : environmentIds).has(id))
    throw new Error(
      `shot ${shot} binding ${index} selected an unavailable reference`,
    );
  const semanticPurposes = textArray(
    value.semanticPurposes,
    1,
    4,
    30,
    `shot ${shot} binding purposes`,
  );
  if (semanticPurposes.some((purpose) => !PURPOSES.has(purpose)))
    throw new Error(`shot ${shot} binding ${index} has invalid purpose`);
  if (
    value.source === "environment" &&
    semanticPurposes.some(
      (purpose) => purpose !== "environment" && purpose !== "framing",
    )
  )
    throw new Error(`shot ${shot} environment binding has character purpose`);
  return {
    bindingId,
    id,
    source: value.source,
    semanticPurposes: semanticPurposes as ReferenceBinding["semanticPurposes"],
    preserve: textArray(
      value.preserve,
      1,
      20,
      2_000,
      `shot ${shot} binding preserve`,
    ),
    avoidCopying: textArray(
      value.avoidCopying,
      0,
      20,
      2_000,
      `shot ${shot} binding avoidCopying`,
    ),
  };
}

function text(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`${label} is invalid`);
  return value.trim();
}
function textArray(
  value: unknown,
  min: number,
  max: number,
  itemMax: number,
  label: string,
): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    throw new Error(`${label} is invalid`);
  const result = value.map((item) => text(item, itemMax, label));
  if (new Set(result).size !== result.length)
    throw new Error(`${label} has duplicates`);
  return result;
}
function numberArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.some((item) => !Number.isInteger(item)))
    throw new Error(`${label} is invalid`);
  const result = value as number[];
  if (new Set(result).size !== result.length)
    throw new Error(`${label} has duplicates`);
  return result;
}
function exactKeys(
  value: Record<string, unknown>,
  keys: string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    throw new Error(`${label} has invalid fields`);
}
