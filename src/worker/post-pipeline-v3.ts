import { createHash } from "node:crypto";
import { isRecord } from "./value-utils";

export const POST_PIPELINE_V3 = "post-pipeline-v3" as const;

export type PostPipelineV3ArtifactKey =
  "postPlanning" | "imagePlanning" | "promptBuild";

export type ArtifactRef = { revision: number; hash: string };

export type ArtifactWithSources = {
  sourceArtifacts: Record<string, ArtifactRef>;
};

export function createPostPipelineV3Concept(input: {
  source: "manual" | "scheduler";
  mode?: "manual" | "auto";
  operatorRequest?: string;
}) {
  const operatorRequest = input.operatorRequest?.trim() || null;
  return {
    pipelineVersion: POST_PIPELINE_V3,
    source: input.source,
    ...(input.mode ? { mode: input.mode } : {}),
    operatorRequest,
    pipeline: {
      stage: "post_plan" as const,
      state: "pending" as const,
      imageCount: null,
      reasonCodes: [] as string[],
    },
  };
}

export function isPostPipelineV3(value: unknown): boolean {
  return isRecord(value) && value.pipelineVersion === POST_PIPELINE_V3;
}

export function canonicalJsonHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function isArtifactStale(
  artifact: ArtifactWithSources,
  currentSources: Record<string, ArtifactRef>,
): boolean {
  return Object.entries(artifact.sourceArtifacts).some(([name, expected]) => {
    const current = currentSources[name];
    return (
      !current ||
      current.revision !== expected.revision ||
      current.hash !== expected.hash
    );
  });
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonical JSON cannot contain a non-finite number");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("canonical JSON accepts only JSON-compatible values");
}
