import { isRecord } from "../utils/value-utils";

export const COMPOSITION_VERSION = "person-composition-v1";
export const COMPOSITION_FIELDS = [
  "personCount",
  "framing",
  "faceDirection",
  "bodyDirection",
  "pose",
  "hands",
  "gaze",
  "camera",
  "placement",
  "occlusion",
] as const;
export type ImageComposition = {
  personCount: number;
} & Record<
  Exclude<(typeof COMPOSITION_FIELDS)[number], "personCount">,
  string | null
>;
export type CompositionAnalysis = {
  version: typeof COMPOSITION_VERSION;
  model: string;
  content: ImageComposition;
};

export function readCompositionAnalysis(
  value: unknown,
): CompositionAnalysis | null {
  if (
    !isRecord(value) ||
    value.version !== COMPOSITION_VERSION ||
    typeof value.model !== "string" ||
    !value.model.trim()
  )
    return null;
  try {
    return {
      version: COMPOSITION_VERSION,
      model: value.model,
      content: parseComposition(value.content),
    };
  } catch {
    return null;
  }
}

export function parseComposition(value: unknown): ImageComposition {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== COMPOSITION_FIELDS.length ||
    !Number.isInteger(value.personCount) ||
    (value.personCount as number) < 0 ||
    (value.personCount as number) > 100 ||
    COMPOSITION_FIELDS.slice(1).some(
      (key) =>
        value[key] !== null &&
        (typeof value[key] !== "string" ||
          !(value[key] as string).trim() ||
          (value[key] as string).length > 1000),
    )
  )
    throw new Error("invalid_image_composition");
  return value as ImageComposition;
}

// Shared by SNS indexing, character indexing and source-to-character queries.
// Identity, clothes, background and lighting must not affect pose similarity.
export function compositionText(content: Record<string, unknown>): string {
  const parts = COMPOSITION_FIELDS.filter(
    (key) =>
      content[key] !== null &&
      content[key] !== undefined &&
      content[key] !== "",
  ).map((key) => `${key}: ${String(content[key])}`);
  return parts.length ? parts.join("\n") : String(content.description ?? "");
}
