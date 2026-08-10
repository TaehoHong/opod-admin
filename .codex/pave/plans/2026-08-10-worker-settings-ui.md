# 워커 토글·평가 LLM 설정 UI 이관

Date: 2026-08-10
Status: implemented / verified (라이브 UI 클릭 검증만 미실시 — 아래 검증 절)

## 목표

워커 자동 루프 on/off와 평가 LLM 설정을 `.env`에서 admin 설정 화면으로 옮긴다.
운영자가 프로세스 재시작 없이 UI에서 워커를 켜고 끄고, LLM 키를 `.env`로
관리하지 않는 것이 목적이다.

## 사용자 확정 결정

- 생성 워커(`WORKER_ENABLED`)와 평가 워커(`EVALUATION_WORKER_ENABLED`) 토글을
  모두 UI로 옮긴다.
- 평가도 수동 실행 버튼을 넣는다. 자동 루프가 꺼져 있어도 대기 1건을 처리한다.
- 평가 LLM(`EVALUATOR_LLM_*`)의 env 폴백은 제거한다. DB 전용이다.
- `WORKER_ENABLED` / `EVALUATION_WORKER_ENABLED` env는 DB에 값이 없을 때만 쓰는
  초기 기본값으로 존치한다 (기존 배포 동작 보존, admin UI 장애 시 비상 경로).

## 설계 결정

### D1. 워커 on/off 소유권 이동 (AppConfigService → GenerationSettingsService)

세 워커 모두 `onModuleInit`에서 플래그를 한 번만 읽어 부팅 시점에 고정됐다.
타이머는 항상 돌리고 tick 진입 시 플래그를 재해석하도록 바꾼다.

- 대안 A(채택): tick마다 재해석. 이미 provider·planner·evaluator를 실행 시마다
  재해석하는 관례와 같은 패턴이라 새 개념이 없다. 비용은 꺼져 있을 때 폴링
  간격당 `admin_settings` 조회 1회.
- 대안 B(기각): 설정 저장 시 워커에 이벤트를 쏴서 타이머를 시작/중지. 워커가
  admin을 역참조하거나 이벤트 버스를 새로 들여야 해서 D1 경계를 깬다.
- 대안 C(기각): env 유지 + UI는 상태 표시만. 요청을 만족하지 못한다.

트레이드오프: 꺼진 상태에서도 폴링 타이머가 살아 있다. 실제 부하는 15초당
인덱스 조회 1건이라 무시할 수준이고, 대신 "UI에서 켜면 즉시 돈다"는 성질을
얻는다.

`WORKER_ENABLED`는 생성 워커와 draft 워커를 함께 게이트하므로 토글 하나가 두
서비스를 제어한다. `DRAFT_SCHEDULER_ENABLED`(자동 초안 생성)는 별개 플래그이며
이번 범위 밖이다.

### D2. 평가 LLM은 DB 전용

`ENV_KEYS`에서 `EVALUATOR_LLM_*` 3개를 제거한다. 미설정 필드가 기획 LLM을
상속하는 규칙은 유지한다 — 이건 env 폴백이 아니라 상속이므로 화면 설명이
오히려 단순해진다(`resolveChatSettings`와 동일한 구조).

### D3. 평가 수동 실행은 동기 응답

생성 워커의 `runJobNow`는 이미지 생성이 분 단위라 백그라운드로 넘기지만, 평가는
단발 LLM 호출이라 수동 실행의 가치가 "지금 결과를 본다"에 있다. 응답을 기다려
실행한 종류(`plan`/`prompt`)를 돌려준다. 프록시 타임아웃이 문제가 되면 그때
백그라운드로 옮긴다.

## 구현 경계

- `src/domain/settings/generation-settings.service.ts` — 설정 키 2종 추가,
  evaluator env 폴백 제거, `resolveWorkerToggles`, evaluator 해석 확장
- `src/admin/settings/` — DTO 2종, 컨트롤러 응답/저장 경로
- `src/worker/` — 세 워커의 enable 게이트, `EvaluationWorkerService.runOnce`
- `src/domain/config/app-config.ts` — 워커 config에서 `enabled` 제거
- `src/admin/evaluations/evaluations.controller.ts` — 수동 실행 라우트
- `packages/admin/src/features/settings/` — 평가 LLM 섹션, 워커 카드 토글
- 문서: `docs/plan-prompt-evaluation-agent.md`, `docs/api/admin-settings.md`,
  `docs/api/admin-evaluations.md`, `docs/07-codebase-guide.md`, `.env` 예시 2종

## 범위 밖

- `DRAFT_SCHEDULER_ENABLED` UI 이관
- 설정 키 암호화 (docs/provider-settings-plan.md P4)
- 용도별 모델 분리 (같은 문서 P6)

## 검증 (2026-08-10)

| 명령 | 결과 |
|---|---|
| `npm run lint` | pass |
| `npm run test` | 38 suites / 329 tests pass |
| `npm run admin:check` | 15 files / 39 tests pass |
| `npm run test:e2e` | 5 suites / 11 tests pass (Docker) |
| `npm run build` | pass |
| `npx prettier --check <touched>` | pass |

부팅 검증: `npm run start`로 Nest DI 그래프가 모두 초기화되고
`POST /api/admin/v1/evaluations/worker/run`이 매핑되는 것을 확인했다. 워커 3종의
생성자 인자가 늘었으므로 DI 해석이 이번 변경의 주요 런타임 위험이었다.

미실시: 브라우저에서 설정 화면을 직접 클릭하는 검증. 로컬 DB에 관리자 행이 없고
`.env`에 `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD`가 없어 앱이
부팅을 마치지 못한다(2026-08-08 개발서버 재구축 이후 빈 DB). 대신
`SettingsPage.test.tsx`가 토글 저장 payload(`{ evaluationWorkerEnabled: true }`),
저장 후 상태 반영, `env 기본값` 배지 소멸, 수동 실행 결과 문구(실행함/대기 없음)를
RTL+MSW로 검증한다.

## 후속 후보

- `DRAFT_SCHEDULER_ENABLED`도 같은 방식으로 UI 이관 (지금은 env 전용)
- 설정 키 암호화 (`docs/provider-settings-plan.md` P4)
- 평가 수동 실행이 프록시 타임아웃에 걸리면 백그라운드 방식으로 전환
