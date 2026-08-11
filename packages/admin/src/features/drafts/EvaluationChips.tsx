import { Badge, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import { useState } from "react";
import type { DraftEvaluation } from "./api";

const LABELS: Record<string, string> = {
  persona_fit: "페르소나",
  voice_tone_fit: "말투",
  ai_tell_free: "AI 티",
  memory_continuity: "메모리",
  location_coherence: "장소",
  shot_composition: "컷 구성",
  reference_usage: "레퍼런스",
  caption_quality: "캡션",
  scene_capture_separation: "장면/촬영 분리",
  physical_consistency: "물리 일관성",
  model_family_rules: "모델 규칙",
  plan_fidelity: "기획 충실도",
  reference_alignment: "레퍼런스 정렬",
  cross_shot_consistency: "컷 간 일관성",
  capture_fidelity: "촬영 충실도",
  identity_preservation: "정체성 보존",
  outfit_continuity: "의상 일관성",
  environment_continuity: "공간 일관성",
  photorealism: "사진 현실감",
  artifact_free: "생성 결함",
};

const HARD_FAILURE_LABELS: Record<string, string> = {
  face_visibility_mismatch: "얼굴 노출 불일치",
  crop_or_pose_mismatch: "크롭·포즈 불일치",
  phone_orientation_mismatch: "휴대폰 방향 불일치",
  outfit_changed: "의상 변경",
  identity_or_body_proportion_drift: "정체성·신체 비율 변화",
  environment_changed: "공간 변경",
  reflection_or_hand_physics_error: "반사·손 물리 오류",
  severe_ai_artifact: "심각한 AI 생성 결함",
  cross_shot_continuity_break: "컷 간 연속성 붕괴",
};

type ScoreEntry = { dimension: string; score: number; reason?: string };

export function EvaluationChips({
  evaluation,
  shotSortOrder,
  candidateIndex,
}: {
  evaluation?: DraftEvaluation;
  shotSortOrder?: number;
  candidateIndex?: number;
}) {
  const [expanded, setExpanded] = useState<string>();
  if (!evaluation) return null;

  if (evaluation.status !== "completed") {
    return (
      <Badge color={evaluation.status === "failed" ? "red" : "gray"}>
        평가 {evaluation.status === "failed" ? "실패" : "대기"}
      </Badge>
    );
  }

  const entries = scoreEntries(evaluation, shotSortOrder, candidateIndex);
  const lint = lintEntries(evaluation, shotSortOrder);
  const hardFailures = hardFailureEntries(
    evaluation,
    shotSortOrder,
    candidateIndex,
  );
  const verdict = candidateVerdict(evaluation, shotSortOrder, candidateIndex);
  if (entries.length === 0 && lint.length === 0 && hardFailures.length === 0)
    return null;

  const prefix =
    shotSortOrder === undefined
      ? evaluation.kind
      : `shot-${shotSortOrder}-candidate-${candidateIndex ?? "all"}`;
  return (
    <Stack gap={6}>
      <Group gap={6} wrap="wrap">
        {shotSortOrder === undefined && evaluation.overallScore != null ? (
          <Badge variant="filled" color={scoreColor(evaluation.overallScore)}>
            {evaluation.kind === "image" ? "이미지 심사" : "LLM 심사"}{" "}
            {evaluation.overallScore.toFixed(1)}/5
          </Badge>
        ) : null}
        {verdict ? (
          <Badge color={verdict === "pass" ? "teal" : "red"}>
            {verdict === "pass" ? "통과" : "반려"}
          </Badge>
        ) : null}
        {entries.map((entry) => {
          const key = `${prefix}:${entry.dimension}`;
          const open = expanded === key;
          return (
            <UnstyledButton
              key={key}
              aria-expanded={open}
              aria-label={`${LABELS[entry.dimension] ?? entry.dimension} ${entry.score}점 사유`}
              onClick={() => setExpanded(open ? undefined : key)}
            >
              <Badge variant="light" color={scoreColor(entry.score)}>
                {LABELS[entry.dimension] ?? entry.dimension} {entry.score}/5
              </Badge>
            </UnstyledButton>
          );
        })}
        {lint.length > 0 ? (
          <UnstyledButton
            aria-expanded={expanded === `${prefix}:lint`}
            aria-label={`정적 검사 ${lint.length}건 내용`}
            onClick={() =>
              setExpanded(
                expanded === `${prefix}:lint` ? undefined : `${prefix}:lint`,
              )
            }
          >
            <Badge variant="outline" color="orange">
              정적 검사 {lint.length}건
            </Badge>
          </UnstyledButton>
        ) : null}
        {hardFailures.length > 0 ? (
          <UnstyledButton
            aria-expanded={expanded === `${prefix}:hard-failures`}
            aria-label={`하드 실패 ${hardFailures.length}건 내용`}
            onClick={() =>
              setExpanded(
                expanded === `${prefix}:hard-failures`
                  ? undefined
                  : `${prefix}:hard-failures`,
              )
            }
          >
            <Badge variant="filled" color="red">
              하드 실패 {hardFailures.length}건
            </Badge>
          </UnstyledButton>
        ) : null}
      </Group>

      {entries.map((entry) => {
        const key = `${prefix}:${entry.dimension}`;
        return expanded === key && entry.reason ? (
          <Text key={key} size="xs" c="dimmed">
            {LABELS[entry.dimension] ?? entry.dimension} · {entry.reason}
          </Text>
        ) : null;
      })}
      {expanded === `${prefix}:lint` ? (
        <Stack gap={2}>
          {lint.map((detail, index) => (
            <Text key={`${detail}:${index}`} size="xs" c="orange">
              {detail}
            </Text>
          ))}
        </Stack>
      ) : null}
      {expanded === `${prefix}:hard-failures` ? (
        <Stack gap={2}>
          {hardFailures.map((detail) => (
            <Text key={detail} size="xs" c="red">
              {HARD_FAILURE_LABELS[detail] ?? detail}
            </Text>
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}

function scoreEntries(
  evaluation: DraftEvaluation,
  shotSortOrder?: number,
  candidateIndex?: number,
): ScoreEntry[] {
  const scores = asRecord(evaluation.scoresJson);
  if (!scores) return [];
  if (evaluation.kind === "plan") {
    return entriesFromRecord(asRecord(scores.scores));
  }
  if (shotSortOrder !== undefined) {
    const shot = array(scores.shots).find(
      (value) => asRecord(value)?.sortOrder === shotSortOrder,
    );
    if (evaluation.kind === "image" && candidateIndex !== undefined) {
      const candidate = array(asRecord(shot)?.candidates).find(
        (value) => asRecord(value)?.candidateIndex === candidateIndex,
      );
      return entriesFromRecord(asRecord(asRecord(candidate)?.scores));
    }
    return entriesFromRecord(asRecord(asRecord(shot)?.scores));
  }
  const crossShot = asRecord(scores.crossShot);
  return typeof crossShot?.score === "number"
    ? [
        {
          dimension: "cross_shot_consistency",
          score: crossShot.score,
          reason: stringArray(crossShot.issues).join(" · ") || undefined,
        },
      ]
    : [];
}

function imageCandidate(
  evaluation: DraftEvaluation,
  shotSortOrder?: number,
  candidateIndex?: number,
) {
  if (
    evaluation.kind !== "image" ||
    shotSortOrder === undefined ||
    candidateIndex === undefined
  )
    return undefined;
  const scores = asRecord(evaluation.scoresJson);
  const shot = array(scores?.shots).find(
    (value) => asRecord(value)?.sortOrder === shotSortOrder,
  );
  return asRecord(
    array(asRecord(shot)?.candidates).find(
      (value) => asRecord(value)?.candidateIndex === candidateIndex,
    ),
  );
}

function candidateVerdict(
  evaluation: DraftEvaluation,
  shotSortOrder?: number,
  candidateIndex?: number,
) {
  const verdict = imageCandidate(
    evaluation,
    shotSortOrder,
    candidateIndex,
  )?.verdict;
  return verdict === "pass" || verdict === "reject" ? verdict : undefined;
}

function hardFailureEntries(
  evaluation: DraftEvaluation,
  shotSortOrder?: number,
  candidateIndex?: number,
) {
  if (evaluation.kind !== "image") return [];
  if (shotSortOrder === undefined) {
    const crossShot = asRecord(asRecord(evaluation.scoresJson)?.crossShot);
    return stringArray(crossShot?.hardFailures);
  }
  return stringArray(
    imageCandidate(evaluation, shotSortOrder, candidateIndex)?.hardFailures,
  );
}

function lintEntries(evaluation: DraftEvaluation, shotSortOrder?: number) {
  if (evaluation.kind !== "prompt" || shotSortOrder === undefined) return [];
  const scores = asRecord(evaluation.scoresJson);
  const shot = array(scores?.shots).find(
    (value) => asRecord(value)?.sortOrder === shotSortOrder,
  );
  return array(asRecord(shot)?.lint).flatMap((value) => {
    if (typeof value === "string") return [value];
    const record = asRecord(value);
    return typeof record?.detail === "string" ? [record.detail] : [];
  });
}

function entriesFromRecord(value?: Record<string, unknown>): ScoreEntry[] {
  if (!value) return [];
  return Object.entries(value).flatMap(([dimension, raw]) => {
    const entry = asRecord(raw);
    return typeof entry?.score === "number"
      ? [
          {
            dimension,
            score: entry.score,
            ...(typeof entry.reason === "string"
              ? { reason: entry.reason }
              : {}),
          },
        ]
      : [];
  });
}

function scoreColor(score: number) {
  if (score >= 4) return "teal";
  if (score <= 2) return "red";
  return "yellow";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown) {
  return array(value).filter(
    (entry): entry is string => typeof entry === "string",
  );
}
