import { createHash } from "node:crypto";
import { isRecord } from "./value-utils";

export const POST_PIPELINE_V3 = "post-pipeline-v3" as const;
// V4 (2026-08-15): 같은 실행 기계 위에서 ⑥ 검수 대신 ⑥ 캡션 단계를 돈다 —
// 후보 없음(프롬프트당 1장), 승인 없음(자동은 예약 시각 게시, 수동은 게시 버튼).
// 배포 전 존재하던 v3 draft는 v3 경로(검수 화면)로 완주하므로 버전으로 가른다.
// 설계 정본 docs/post-creation-agent-architecture-v3.md §20.
export const POST_PIPELINE_V4 = "post-pipeline-v4" as const;

export type PostPipelineV3ArtifactKey =
  "postPlanning" | "imagePlanning" | "promptBuild" | "captionBuild";

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
    pipelineVersion: POST_PIPELINE_V4,
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

// v3와 v4는 같은 오케스트레이터·CAS·lease를 쓴다. "V3 계열인가"는 이 함수,
// "검수 없는 v4 흐름인가"는 isPostPipelineV4로 묻는다.
export function isPostPipelineV3(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.pipelineVersion === POST_PIPELINE_V3 ||
      value.pipelineVersion === POST_PIPELINE_V4)
  );
}

export function isPostPipelineV4(value: unknown): boolean {
  return isRecord(value) && value.pipelineVersion === POST_PIPELINE_V4;
}

// 컷별 게시 이미지 집합의 해시. 캡션 artifact의 source, 생성 이미지 평가의
// targetHash, read model의 stale 판정이 전부 이 한 함수를 써야 한다 — 구현이
// 둘이면 "항상 stale" 또는 "절대 stale 아님"이 된다.
export function generationSetHash(
  items: { sortOrder: number; jobId: string; mediaId: string | undefined }[],
): string {
  return canonicalJsonHash(
    [...items]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => ({
        sortOrder: item.sortOrder,
        jobId: item.jobId,
        mediaId: item.mediaId,
      })),
  );
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
