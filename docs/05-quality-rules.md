# 05. Quality Rules

## Definition of Done

작업은 실제 변경 위험에 비례한 검증이 통과해야 완료다. 실행할 수 없는
검증이 있으면 이유, 확인한 범위와 잔여 위험을 보고한다.

## Test Value Gate

새 테스트는 다음 질문에 답할 수 있어야 한다.

> 이 테스트가 실패하면 어떤 실제 사용자 행동, API contract, permission,
> data state, error path 또는 business rule이 깨진 것인가?

다음 테스트는 만들지 않는다.

- coverage 수치만 높이는 테스트
- mock 또는 private implementation 호출만 확인하는 테스트
- 기존 보장을 중복하는 테스트
- framework/library 자체 동작을 확인하는 테스트
- 명확한 동작 계약이 없는 snapshot

숫자 coverage threshold는 두지 않는다. 테스트 수보다 의미 있는 회귀
보호를 우선한다.

## Fast Feedback

- 기본 개발 검증은 최대한 빠르게 실행되게 구성한다.
- 먼저 관련 focused test를 실행하고 필요할 때 범위를 넓힌다.
- 순수 함수 테스트는 DB, network, jsdom을 사용하지 않는다.
- 실제 DB가 필요한 invariant와 transaction만 Testcontainers E2E로
  검증한다.
- 외부 provider는 기본 테스트에서 실제 호출하지 않는다.

## Backend Tests

- Jest를 유지한다.
- service/application logic은 observable outcome과 state transition을
  검증한다.
- controller test는 validation, auth, status와 response contract를
  검증한다.
- DB constraint, transaction, permission과 cross-module API contract는
  가치가 있을 때 E2E로 검증한다.
- E2E는 Docker가 필요한 느린 경로이므로 모든 변경의 기본 검증으로
  사용하지 않는다.

## Frontend Target Tests

전환이 시작돼 아래 구성이 `packages/admin`에 적용돼 있다:

- test runner: Vitest
- pure logic: Node environment
- React component: React Testing Library + jsdom
- interaction: `@testing-library/user-event`
- HTTP 경계: MSW Node
- callback와 순수 unit: `vi.fn`
- Mantine: `MantineProvider env="test"`
- TanStack Query retry: test에서 비활성

브라우저 MSW, Vitest Browser Mode와 실제 backend 연결을 기본 경로에
두지 않는다.

## Explicitly Not Used

- Playwright
- frontend browser E2E
- GitHub Actions CI
- 자동 coverage gate

필요성이 생기면 해당 기능 구현 시 새 결정으로 검토한다.

## Current Verification Map

| 변경 영역 | 좁은 검증 | 넓은 검증 |
| --- | --- | --- |
| Admin UI (legacy/React) | `npm run admin:check` | `npm run format` |
| Backend logic | 관련 `*.spec.ts` | `npm run test` |
| API/worker | 관련 spec | `npm run lint`, `npm run test`, `npm run build` |
| Auth/payment/refund/permission/transaction | 관련 unit | `npm run test:e2e` |
| Prisma mirror | `npm run schema:check` | `npm run db:generate`, `npm run build` |
| PAVE/docs | link/path review | PAVE doctor, `git diff --check` |

React 전환 후에도 `npm run admin:check`처럼 하나의 빠른 UI 검증 진입점을
유지하되 내부 command 구성은 전환 작업에서 정한다.

## High-risk Regression Areas

- 인증과 cookie/CSRF 경계
- 결제, 환불, 크레딧 중복 처리와 idempotency
- 관리자 permission과 감사 로그
- 생성 job lease, 중복 provider 제출과 자동 게시
- secret masking과 원문 LLM 로그
- canonical schema와 admin mirror drift
- mobile에서 핵심 상태와 자동화 중단 접근

## Current Gaps

- `npm run schema:check`는 현재 통과하며 canonical schema mirror의
  회귀 방지 경로로 유지한다.
- `GET /api/health`가 인증 없이 DB 도달성을 보고한다. production smoke
  automation은 아직 없다.
- CI, staging과 automatic rollback은 의도적으로 초기 필수 경로가 아니다.
- 환불 실행, 사용자 제재, 자동 상호작용 중단과 목표 frontend stack은
  아직 완전히 구현되지 않았다.
