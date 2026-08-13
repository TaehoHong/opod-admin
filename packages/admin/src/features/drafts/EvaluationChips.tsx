import { Badge, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import { useState } from "react";
import type { DraftEvaluation } from "./api";

const LABELS: Record<string, string> = {
  // V2 차원
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
  // V3 게시글 기획 평가
  status_validity: "상태 타당성",
  character_grounding: "캐릭터 근거",
  intent_quality: "의도 품질",
  continuity_and_novelty: "연속성·새로움",
  content_style_fit: "콘텐츠 스타일",
  voice_fit: "말투",
  hashtag_fit: "해시태그",
  memory_discipline: "메모리 절제",
  scope_compliance: "범위 준수",
  conflict_qualification: "충돌 성립",
  conflict_grounding: "충돌 근거",
  conflict_completeness: "충돌 완전성",
  // V3 이미지 기획 평가
  post_intent_fidelity: "게시 의도 보존",
  visual_story_coverage: "시각 서사 포괄",
  shot_distinctness: "컷 구별성",
  capture_plausibility: "촬영 개연성",
  character_presentation: "인물 노출",
  character_visual_grounding: "인물 시각 근거",
  reference_contract: "레퍼런스 계약",
  location_contract: "장소 계약",
  continuity_contract: "연속성 계약",
  block_qualification: "차단 성립",
  block_grounding: "차단 근거",
  block_completeness: "차단 완전성",
  // V3 생성 이미지 평가
  scene_fidelity: "장면 충실도",
  capture_and_composition: "촬영·구도",
  identity_and_appearance: "정체성·외모",
  reference_adherence: "레퍼런스 준수",
  style_fidelity: "화풍 충실도",
  text_fidelity: "텍스트 정확도",
  visual_integrity: "시각 무결성",
  set_continuity: "세트 연속성",
  set_distinctness: "세트 구별성",
  // V3 프롬프트 평가
  shot_contract_fidelity: "컷 계약 충실도",
  character_contract_fidelity: "인물 계약 충실도",
  continuity_encoding: "연속성 반영",
  reference_contract_fidelity: "레퍼런스 계약 충실도",
  model_policy_compliance: "모델 정책 준수",
  negative_prompt_safety: "네거티브 안전성",
  data_boundary: "데이터 경계",
};

// 텍스트 평가 3종의 판정 어휘. V3는 kind마다 다른 verdict를 쓴다.
const VERDICT_LABELS: Record<string, { label: string; ok: boolean }> = {
  pass: { label: "통과", ok: true },
  issues_found: { label: "지적 있음", ok: false },
  valid_conflict: { label: "충돌 확인", ok: true },
  incomplete_conflict: { label: "충돌 불완전", ok: false },
  invalid_conflict: { label: "충돌 무효", ok: false },
  valid_block: { label: "차단 타당", ok: true },
  incomplete_block: { label: "차단 불완전", ok: false },
  invalid_block: { label: "차단 무효", ok: false },
  reject: { label: "반려", ok: false },
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

  // V3 이미지 평가는 후보가 아니라 컷의 선택된 한 장을 본다. 후보 카드에
  // 붙이면 후보별 품질 차이로 오독된다.
  if (v3ImageShots(evaluation) && candidateIndex !== undefined) return null;

  const entries = scoreEntries(evaluation, shotSortOrder, candidateIndex);
  const lint = lintEntries(evaluation, shotSortOrder);
  const hardFailures = hardFailureEntries(
    evaluation,
    shotSortOrder,
    candidateIndex,
  );
  const severe = severeEntries(evaluation, shotSortOrder);
  const verdict = candidateVerdict(evaluation, shotSortOrder, candidateIndex);
  const overall =
    shotSortOrder === undefined ? evaluation.overallScore : undefined;
  // 총점·판정만 있고 차원 점수가 없는 평가도 있다. 점수 배열이 비었다고 해서
  // 블록 전체를 지우면 완료된 평가가 화면에서 사라진다.
  if (
    entries.length === 0 &&
    lint.length === 0 &&
    hardFailures.length === 0 &&
    severe.length === 0 &&
    overall == null &&
    !verdict
  )
    return null;

  const prefix =
    shotSortOrder === undefined
      ? evaluation.kind
      : `shot-${shotSortOrder}-candidate-${candidateIndex ?? "all"}`;
  return (
    <Stack gap={6}>
      <Group gap={6} wrap="wrap">
        {overall != null ? (
          <Badge variant="filled" color={scoreColor(overall)}>
            {evaluation.kind === "image" ? "이미지 심사" : "LLM 심사"}{" "}
            {overall.toFixed(1)}/5
          </Badge>
        ) : null}
        {verdict ? (
          <Badge color={VERDICT_LABELS[verdict]?.ok ? "teal" : "red"}>
            {VERDICT_LABELS[verdict]?.label ?? verdict}
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
        {severe.length > 0 ? (
          <UnstyledButton
            aria-expanded={expanded === `${prefix}:severe`}
            aria-label={`중대 이상 지적 ${severe.length}건 내용`}
            onClick={() =>
              setExpanded(
                expanded === `${prefix}:severe`
                  ? undefined
                  : `${prefix}:severe`,
              )
            }
          >
            <Badge variant="filled" color="red">
              중대 지적 {severe.length}건
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
      {expanded === `${prefix}:severe` ? (
        <Stack gap={2}>
          {severe.map((detail, index) => (
            <Text key={`${detail}:${index}`} size="xs" c="red">
              {detail}
            </Text>
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}

// V3는 평가 본문을 scoresJson.result 아래에 두고 차원 점수를 숫자로 저장한다.
// V2는 scoresJson 최상위에 두고 차원마다 { score, reason }을 저장한다.
// 두 세대의 초안이 함께 살아 있으므로 양쪽을 모두 읽는다.
function v3Result(
  evaluation: DraftEvaluation,
): Record<string, unknown> | undefined {
  return asRecord(asRecord(evaluation.scoresJson)?.result);
}

// V3에는 차원별 reason이 없다. 사유는 issues[]에 dimension으로 붙어 온다.
function reasonsFromIssues(value: unknown): Map<string, string> {
  const reasons = new Map<string, string>();
  for (const issue of array(value)) {
    const record = asRecord(issue);
    const dimension = record?.dimension;
    const detail = record?.detail;
    if (typeof dimension !== "string" || typeof detail !== "string") continue;
    const previous = reasons.get(dimension);
    reasons.set(dimension, previous ? `${previous} · ${detail}` : detail);
  }
  return reasons;
}

// V3 생성 이미지 평가는 컷마다 **선택된 한 장**을 본다(evaluator input의
// selectedImages). 후보 단위 점수가 아니므로 후보 카드에는 붙이지 않는다 —
// 같은 점수를 후보마다 반복하면 후보 간 품질 차이로 오독된다.
function v3ImageShots(evaluation: DraftEvaluation): unknown[] | undefined {
  const result = v3Result(evaluation);
  return result && Array.isArray(result.shots) ? result.shots : undefined;
}

function v3ImageShot(evaluation: DraftEvaluation, shotSortOrder: number) {
  return asRecord(
    array(v3ImageShots(evaluation)).find(
      (value) => asRecord(value)?.sortOrder === shotSortOrder,
    ),
  );
}

// V3 이미지 차원은 { applicable, score } 형태다. 계약이 없어 평가 대상이
// 아닌 차원(applicable: false)과 낮은 점수를 받은 차원은 다르다.
function dimensionEntries(
  value?: Record<string, unknown>,
  reasons?: Map<string, string>,
): ScoreEntry[] {
  if (!value) return [];
  return Object.entries(value).flatMap(([dimension, raw]) => {
    const entry = asRecord(raw);
    if (!entry || entry.applicable === false) return [];
    if (typeof entry.score !== "number") return [];
    const reason = reasons?.get(dimension);
    return [{ dimension, score: entry.score, ...(reason ? { reason } : {}) }];
  });
}

// V3에는 hardFailures 배열이 없고 issue마다 심각도가 붙는다. 심각도를 버리면
// "지적 있음"과 "치명적 결함"이 화면에서 같아 보인다.
function severeEntries(
  evaluation: DraftEvaluation,
  shotSortOrder?: number,
): string[] {
  const result = v3Result(evaluation);
  if (!result || !v3ImageShots(evaluation)) return [];
  const issues =
    shotSortOrder === undefined
      ? array(result.setIssues)
      : array(v3ImageShot(evaluation, shotSortOrder)?.issues);
  return issues.flatMap((raw) => {
    const issue = asRecord(raw);
    if (!issue || (issue.severity !== "major" && issue.severity !== "critical"))
      return [];
    const dimension = String(issue.dimension);
    const label = LABELS[dimension] ?? dimension;
    return [
      `${issue.severity === "critical" ? "치명" : "중대"} · ${label} · ${String(issue.detail)}`,
    ];
  });
}

function scoreEntries(
  evaluation: DraftEvaluation,
  shotSortOrder?: number,
  candidateIndex?: number,
): ScoreEntry[] {
  const scores = asRecord(evaluation.scoresJson);
  if (!scores) return [];
  const result = v3Result(evaluation);
  const v3 = asRecord(result?.scores);
  if (v3) {
    return entriesFromRecord(v3, reasonsFromIssues(result?.issues));
  }
  if (v3ImageShots(evaluation)) {
    // 컷 단위는 그 컷의 차원, 세트 단위는 setDimensions를 본다.
    if (shotSortOrder === undefined) {
      return dimensionEntries(
        asRecord(result?.setDimensions),
        reasonsFromIssues(result?.setIssues),
      );
    }
    const shot = v3ImageShot(evaluation, shotSortOrder);
    return dimensionEntries(
      asRecord(shot?.dimensions),
      reasonsFromIssues(shot?.issues),
    );
  }
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
  // 컷·후보 단위 판정(V2 이미지 평가).
  const candidate = imageCandidate(
    evaluation,
    shotSortOrder,
    candidateIndex,
  )?.verdict;
  if (typeof candidate === "string" && candidate in VERDICT_LABELS) {
    return candidate;
  }
  // 산출물 전체 판정(V3 텍스트 평가). 컷 단위 표시에는 붙이지 않는다.
  if (shotSortOrder !== undefined) return undefined;
  const overall = v3Result(evaluation)?.verdict;
  return typeof overall === "string" && overall in VERDICT_LABELS
    ? overall
    : undefined;
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

function entriesFromRecord(
  value?: Record<string, unknown>,
  reasons?: Map<string, string>,
): ScoreEntry[] {
  if (!value) return [];
  return Object.entries(value).flatMap(([dimension, raw]) => {
    // V3는 숫자, V2는 { score, reason } 레코드.
    if (typeof raw === "number") {
      const reason = reasons?.get(dimension);
      return [{ dimension, score: raw, ...(reason ? { reason } : {}) }];
    }
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
