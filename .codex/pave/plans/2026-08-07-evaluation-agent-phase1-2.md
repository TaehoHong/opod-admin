# 평가 Agent 1~2차 구현 계획

- 날짜: 2026-08-07
- 설계: `docs/plan-prompt-evaluation-agent.md`, `docs/image-prompt-evaluation-agent.md`
- 결정: 콘텐츠 언어는 `Character.contentLanguage`(기본 `ko`), 범위는 1~2차 전부
  (기획 평가 + 프롬프트 정적 린트 + 프롬프트 LLM 배치 심사 + 휴먼 시그널 조인
  + 수동 트리거 집계 리포트). 3차(LLM 개선 제안 생성)는 제외.

## 설계 리뷰 반영 사항 (구현 전 설계 문서 수정)

1. 예산·서킷브레이커 "공유" → 평가 워커 자체 게이트(tick당 kind별 1건,
   연속 실패 시 지수 백오프)로 변경. 기존 인프라는 이미지 비용 전용이라 공유 불가.
2. LlmLog 연결은 플래너 관례(`requestId = draft.id`) 재사용. 로그 타입은
   TS 유니언 추가만(`admin.plan.evaluate`, `admin.prompt.evaluate`).
3. 평가 클레임 조건: `conceptJson ? 'plan'` + 해당 kind 평가 부재 +
   캐릭터 active + (prompt kind는) 빈 프롬프트 제외. 수동 모드 draft는
   프롬프트 빌드 완료 후에만 prompt 평가 대상.
4. 신규 env: `EVALUATION_WORKER_ENABLED`(기본 false),
   `EVALUATION_POLL_INTERVAL_MS`, `EVALUATION_LEASE_SECONDS`,
   `EVALUATION_MAX_ATTEMPTS`. lease 단위는 기존 관례대로 초.
5. `schema:check`는 기존 드리프트 13건으로 현재도 red — 신규 블록만 diff로 검증.
6. 재생성 경합: scoresJson.shots[].jobId 기록으로 평가 시점 잡을 고정,
   집계는 최신 잡 기준으로 stale 평가를 attempt 구분.

## 스키마 (opod-service-backend 선행 → opod-admin 미러)

- `Character.contentLanguage String @default("ko")` — 기존 데이터 행동 보존.
- `DraftEvaluation`: id(uuid7), draftId(FK), kind(enum plan|prompt), attempt,
  status(enum pending|completed|failed), evaluatorName, rubricVersion,
  contentLanguage, overallScore(Float?), scoresJson, issuesJson,
  suggestionsJson, leaseExpiresAt, errorMessage, createdAt, completedAt.
  `@@unique([draftId, kind, attempt])`, `@@index([status, leaseExpiresAt])`.
- `EvaluationReport`: id(uuid7), periodStart/End, rubricVersion, summaryJson,
  failurePatternsJson?, promptSuggestionsJson?(3차용 예약), createdAt.
- 마이그레이션 `<ts>_add_draft_evaluations_and_content_language` 1건.

## opod-admin 파일 계획

| 파일 | 작업 |
|---|---|
| `prompts/plan-evaluator.ts` (신규) | 기획 평가 시스템/유저 프롬프트, 8차원 루브릭, 언어별 AI 티 패턴 팩(en/ko), `EVAL_RUBRIC_VERSION = "eval-rubric-v1"` |
| `prompts/prompt-evaluator.ts` (신규) | 프롬프트 배치 심사 프롬프트, 6차원(+crossShot) |
| `src/worker/prompt-lint.ts` + spec (신규) | 정적 린트: 한글 잔존, 무인 컷 인물 어휘, 컷 간 중복, 촬영 메타 누출, 길이 범위 |
| `src/worker/plan-evaluator.ts` + spec (신규) | resolver closure, runJsonFetch, JSON 파싱·차원/점수 범위 검증 |
| `src/worker/prompt-evaluator.ts` + spec (신규) | 배치 심사 resolver, 컷 수 일치 검증, 린트 결과 병합 |
| `src/worker/evaluation.repository.ts` (신규) | 클레임(SKIP LOCKED+pending 행 삽입), persist, lease 스윕, draft별 조회, 휴먼 시그널 조인 집계 질의 |
| `src/worker/evaluation-worker.service.ts` + spec (신규) | 폴링 루프(기존 패턴 복제), tick: 스윕→plan 평가→prompt 평가, 게이트 |
| `src/worker/worker.module.ts` | EvaluationWorkerService/Repository 배선·export |
| `src/domain/config/app-config.ts` (+app-config.service) | evaluationWorker 설정 블록 |
| `src/domain/llm-logs/llm-log.service.ts` | LLM_LOG_TYPE 2종 추가 |
| `src/domain/settings/generation-settings.service.ts` | evaluator 설정 키 3종 + `resolveEvaluatorSettings()`(플래너 상속, `resolveChatSettings` 선례) |
| `src/admin/evaluations/*` (신규) | controller(GET drafts/:id/evaluations, POST/GET evaluation-reports) + service, AdminModule 등록 |
| `prisma/schema.prisma` | 백엔드 미러 |
| `src/admin/drafts/*` | `GET /drafts/:id/timeline`(ActionLog+LlmLog 병합), getDraft에 게시·메모리 영수증 데이터 추가 |
| `packages/admin/src/features/drafts/api.ts` | 평가·타임라인·영수증 타입/fetch 추가 |
| `packages/admin/src/features/drafts/StageRail.tsx` (신규) | 8단계 칩 레일, 휴먼 게이트 구분 아이콘, 클릭 스크롤 |
| `packages/admin/src/features/drafts/EvaluationChips.tsx` (신규) | 차원별 점수 칩 + 사유 펼침, annotator_kind 배지 |
| `packages/admin/src/features/drafts/StageReceipt.tsx` (신규) | 게시·메모리 영수증 섹션(⑥·⑦) |
| `packages/admin/src/features/drafts/DraftEventLog.tsx` (신규) | 원시 이벤트 로그(시간순, JSON 펼침) |
| `DraftDetailPanel.tsx` / `DraftStage.tsx` / `ShotCard.tsx` | 레일·평가 칩·영수증·로그 조립, awaiting-human tone, 실패/대기 섹션 자동 펼침 + RTL 테스트 |

UI 설계 근거: `docs/draft-pipeline-ux.md` (레퍼런스 조사 포함).
attempt 이력 드롭다운·키보드 검수·목록 미니 파이프라인은 백로그.
| `docs/plan-prompt-evaluation-agent.md`, `docs/image-prompt-evaluation-agent.md` | 리뷰 수정사항·결정 반영 |
| `docs/prompt-research-log.md` | eval-rubric-v1 구현 착수 기록 |

## 테스트 가치 게이트

- prompt-lint: 무인 컷 인물 어휘·한글 잔존·중복·메타 누출 검출 실패 시
  → LLM 낭비·정책 위반 프롬프트가 provider로 감 (행동 보호).
- evaluator 파서: 차원 누락·점수 범위 이탈·컷 수 불일치 거절
  → 오염된 평가가 DB·집계에 유입되는 결함 차단.
- evaluation-worker: 비활성 플래그 no-op, 실패 시 requeue/실패 전이,
  성공 persist 호출 계약 — 상태 머신 회귀 방지.
- UI: 평가 존재 시 배지 렌더 — 검수 화면 계약.
- repository 단위 테스트는 mock 단언만 되는 경우 생략(무의미 테스트 금지 규칙).

## 검증

`npm run lint` / `npm run test` / `npm run build` / `npm run db:generate` /
`npm run schema:check`(신규 블록만 diff 확인) / `npm run admin:check`.
DB 상태 전이 신설이므로 e2e 환경 가용 시 `npm run test:e2e`.

## 잔여 리스크

- 로컬 DB에 마이그레이션 적용 가능 여부(docker 상태)에 따라 런타임 검증 범위 결정.
- 언어별 AI 티 팩은 en/ko 초판만 — 실측 후 루브릭 v2에서 보정.
- 집계 리포트는 수동 트리거 + 요약 JSON까지(화면은 조회 API 수준).

## 구현 결과 (2026-08-10 재구성)

- 완료: backend 선행 migration과 admin schema mirror, 기획·프롬프트 평가
  워커, 정적 린트, draft별 평가 조회, 수동 집계 리포트 생성·조회, 검수 화면
  점수/사유/정적 검사 배지.
- 집계 휴먼 시그널: draft 승인·반려 상태, 캡션 수정, 컷 재생성 계보,
  후보 선택을 사용한다. `CharacterActionLog`는 같은 상태 전이를 중복 표현하고
  별도 신호를 추가하지 않아 집계 조인에서 제외한다.
- 재평가: `DRAFT_PLANNED`, `DRAFT_PROMPTS_BUILT`,
  `DRAFT_SHOT_REGENERATED`가 최신 완료 평가보다 새로우면 다음 attempt를 만든다.
- 후속으로 분리: 8단계 StageRail, 게시·메모리 영수증, 원시 이벤트 타임라인,
  집계 리포트 전용 화면. 평가 수집·검수 노출과 독립적인 UX 확장이다.
