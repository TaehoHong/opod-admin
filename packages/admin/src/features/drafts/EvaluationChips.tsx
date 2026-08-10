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
};

type ScoreEntry = { dimension: string; score: number; reason?: string };

export function EvaluationChips({
  evaluation,
  shotSortOrder,
}: {
  evaluation?: DraftEvaluation;
  shotSortOrder?: number;
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

  const entries = scoreEntries(evaluation, shotSortOrder);
  const lint = lintEntries(evaluation, shotSortOrder);
  if (entries.length === 0 && lint.length === 0) return null;

  const prefix =
    shotSortOrder === undefined ? evaluation.kind : `shot-${shotSortOrder}`;
  return (
    <Stack gap={6}>
      <Group gap={6} wrap="wrap">
        {shotSortOrder === undefined && evaluation.overallScore != null ? (
          <Badge variant="filled" color={scoreColor(evaluation.overallScore)}>
            LLM 심사 {evaluation.overallScore.toFixed(1)}/5
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
    </Stack>
  );
}

function scoreEntries(
  evaluation: DraftEvaluation,
  shotSortOrder?: number,
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
