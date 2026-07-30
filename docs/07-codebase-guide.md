# 07. Codebase Guide

> 현재 repository 증거에 기반한 탐색 인덱스다. 승인된 목표 구조와 현재
> 코드가 다르면 현재 코드를 사실로 보고 별도 변경으로 계획한다.

## How to Use

1. 요청과 관련된 module row를 찾는다.
2. target, direct caller/callee, relevant test와 canonical example을 읽는다.
3. evidence path가 현재 코드와 맞는지 확인한다.
4. 소유권이 없거나 증거가 충돌할 때만 탐색 범위를 넓힌다.

## Current Module Map

| 영역              | 현재 경로                                                                              | 현재 책임                                                            | 주요 진입점                                                          | 테스트·증거                                                 |
| ----------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| Bootstrap/HTTP    | `src/main.ts`, `src/app.module.ts`, `src/common/`                                      | Nest 시작, static UI, validation, exception, HTTP log                | `bootstrap`, `AppModule`                                             | `src/main.ts`, `src/app.module.ts`, `src/common/`           |
| Admin auth        | `src/admin/auth/`                                                                      | login, admin 생성, cookie 세션, CSRF/JWT guard                       | `AdminAuthController`, `AdminAuthService`, `AdminJwtGuard`           | `src/admin/auth/*.spec.ts`, `test/admin-auth.e2e-spec.ts`   |
| General admin     | `src/admin/admin.controller.ts`, `src/admin/admin.service.ts`, `src/admin/dto/`        | user/content/credit/payment/report/analytics                         | `AdminController`, `AdminService`                                    | colocated specs, `test/admin-analytics.e2e-spec.ts`         |
| Drafts            | `src/admin/drafts/`                                                                    | draft CRUD, planning, generation, approval, publish                  | `DraftsController`, `DraftsService`                                  | `drafts.service.spec.ts`, generation E2E                    |
| Generation        | `src/admin/generation/`, `src/worker/`                                                 | job 생성, provider 호출, lease/retry, planning, publish              | `GenerationService`, `GenerationWorkerService`, `DraftWorkerService` | colocated specs, `test/generation.e2e-spec.ts`              |
| Characters        | `src/characters/`                                                                      | character/persona/memory/profile image/posting policy/visual profile | `CharactersController`, feature services와 repositories              | colocated specs, `test/character-profile-image.e2e-spec.ts` |
| Media             | `src/admin/media/`, `src/worker/generated-media-store.ts`, `src/worker/film-finish.ts` | upload, signing, generated media persistence                         | `MediaService`, store factories                                      | media/film specs                                            |
| Settings          | `src/admin/settings/`, `src/domain/settings/`                                          | provider 설정과 audit                                                | `GenerationSettingsService`                                          | settings specs, `docs/api/admin-settings.md`                |
| LLM logs          | `src/admin/llm-logs/`, `src/domain/llm-logs/`                                          | LLM 실행 기록·조회와 토큰 사용량 집계                                | `LlmLogService`, `LlmLogsController`, `TokenUsageService`            | LLM log specs, `token-usage.service.spec.ts`                |
| Prompt code       | `prompts/`, `src/worker/*prompt*`                                                      | pure prompt 구성과 worker orchestration                              | exported builders                                                    | prompt/worker specs                                         |
| Config            | `src/domain/config/`                                                                   | 부팅 설정 로드·검증과 typed 주입                                     | `AppConfigService`, `loadAppConfig`, `ConfigModule`                  | `admin-auth.service.spec.ts`가 주입 경로 사용               |
| Health            | `src/health/`                                                                          | 인증 없는 liveness/readiness와 DB 도달성 확인                        | `HealthController`, `HealthService`, `HealthRepository`              | `health.controller.spec.ts`                                 |
| Prisma/schema     | `src/domain/database/`, `prisma/`, `scripts/check-schema-sync.mjs`                     | Prisma client와 admin schema mirror                                  | `PrismaModule`, `PrismaService`                                      | schema check, E2E setup                                     |
| Admin UI (legacy) | `packages/admin/`                                                                      | 정적 SPA shell과 `/api/admin/v1/*` 호출                              | `index.html`, `main.js`                                              | `packages/admin/test/*.test.mjs`                            |
| Admin UI (React)  | `packages/admin/src/`                                                                  | 전환 중인 React 앱                                                   | `main.tsx`, `app/`, `features/`                                      | `src/**/*.test.tsx`, `npm run admin:check`                  |
| E2E               | `test/`                                                                                | Testcontainers PostgreSQL와 API contract                             | Jest global setup                                                    | `test/jest-e2e.json`, `test/e2e-global-setup.ts`            |

## Shared Capability Catalog

| 기능                      | 현재 canonical owner                                    | 제약                                                                                                               | 주요 사용처                                          |
| ------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Prisma connection         | `PrismaModule`, `PrismaService`                         | migration 소유권 없음                                                                                              | admin, characters, worker                            |
| Admin auth                | `AdminJwtGuard`, `AdminCsrfGuard`, `AdminAuthService`   | `__Host-` cookie 세션, 상태 변경 시 고정 헤더                                                                      | protected controllers/UI                             |
| Pagination                | `src/domain/database/page.ts`                           | active filter 안에서 cursor 검증                                                                                   | list endpoints                                       |
| Provider settings         | `GenerationSettingsService`                             | secret response masking                                                                                            | worker, settings, generation                         |
| LLM logging               | `LlmLogService`                                         | 현재 구현과 목표 4-table 구조 구분                                                                                 | planners/providers/admin                             |
| Image provider resolution | `resolveImageGenerationProviders`                       | 현재 provider를 영구 product abstraction으로 간주하지 않음                                                         | generation worker                                    |
| Generated media storage   | `createGeneratedMediaStore`, `createReferenceUrlSigner` | provider 임시 결과를 owned storage에 보존                                                                          | worker, draft publish                                |
| Prompt construction       | exports under `prompts/`                                | pure construction; network/DB 없음                                                                                 | planner, prompt builder                              |
| Shot generation contract  | `ContentPlanShot`, `paramsJson._shot`                   | `scene`과 `captureSetup` 분리, 인물 노출 샷은 업로드 완료 identity reference 필수, 빌드 대상 모델과 실행 모델 일치 | planner, draft/generation worker, retry/regeneration |
| Bootstrap config          | `AppConfigService` (`ConfigModule`은 `@Global`)         | 부팅 필수 값만 소유. DB 우선인 provider 설정은 `GenerationSettingsService`가 유지                                  | `main.ts`, `PrismaService`, `AdminAuthService`       |
| Validation/error boundary | `ValidationPipe`, `AllExceptionsFilter`                 | whitelist+transform, common error response                                                                         | all HTTP routes                                      |

## Current Canonical Examples

현재 존재하는 코드에서만 example을 지정한다.

| 관심사                              | example                         | 이유                                                                                            | 증거                                                              |
| ----------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Nest feature co-location            | character와 draft feature       | controller/service/DTO/spec가 기능 경계에 함께 있음                                             | `src/characters/`, `src/admin/drafts/`                            |
| DTO validation                      | draft DTO                       | HTTP input decorator와 validation 사용                                                          | `src/admin/drafts/dto/`                                           |
| Observable behavior tests           | draft/generation worker specs   | 상태 전이와 결과를 보호                                                                         | `src/admin/drafts/drafts.service.spec.ts`, `src/worker/*.spec.ts` |
| Cross-module DB contract            | auth/generation E2E             | 실제 PostgreSQL과 API 경계 검증                                                                 | `test/admin-auth.e2e-spec.ts`, `test/generation.e2e-spec.ts`      |
| Pure prompt logic                   | prompt builders                 | network/persistence 없이 deterministic 구성                                                     | `prompts/`, 관련 specs                                            |
| Repository/application-service 구조 | health, character profile image | controller → application service → repository 방향이고 `PrismaService`가 repository 안에만 있음 | `src/health/`, `src/characters/character-profile-image.*`         |

health feature가 승인된 repository/application-service 구조의 첫 canonical
example이고 character profile image가 entity mutation 적용 예다. 새 DB 접근은
이 형태를 따른다. 기존 service의 직접 Prisma 접근은 새 규칙의 example로
간주하지 않는다.

## Target Dependency Rules

- 새 DB 접근은 entity repository에 둔다.
- `PrismaService`를 controller, application service 또는 domain service에
  새로 주입하지 않는다.
- controller → application service → repository/external capability 방향을
  따른다.
- application service는 concrete repository를 주입한다.
- worker가 admin module을 역참조하지 않는다.
- public/user-facing controller는 `opod-service-backend`에 둔다.
- canonical schema 변경은 backend에서 먼저 수행한다.
- `prompts/`의 pure code와 `src/`의 orchestration 경계를 유지한다.
- admin API 경로는 `/api/admin/v1/*` 하나만 쓴다. 상태를 바꾸는 요청에는
  세션 cookie와 `x-opod-admin` 헤더가 모두 필요하다.

## Current and Target Frontend

| 항목         | 현재                                      | 목표                                   |
| ------------ | ----------------------------------------- | -------------------------------------- |
| Framework    | 전환 중 — legacy 정적 SPA + React/TS/Vite | React + TypeScript + Vite              |
| Routing      | legacy custom routing / React Router      | React Router                           |
| Server state | legacy fetch helper / TanStack Query      | TanStack Query                         |
| UI/form      | legacy custom CSS / Mantine uncontrolled  | Mantine + `@mantine/form` uncontrolled |
| Tests        | legacy `node:test` + Vitest/RTL/MSW       | Vitest + RTL/jsdom, MSW Node           |

전환 전략: React 앱은 `packages/admin/src/`에서 병행 개발하고
`npm run admin:build` 산출물(`packages/admin/dist/`)이 있을 때만 Nest가
서빙한다. 빌드 여부가 곧 전환 스위치이므로 되돌릴 때 코드를 고치지 않는다.
legacy UI test는 화면을 다 옮길 때까지 유지한다.

canonical example: auth feature(`src/features/auth/`)가 apiClient, TanStack
Query, Mantine form과 MSW 테스트를 한 번에 보여준다. characters feature가
목록 조회와 cursor 페이지네이션의 canonical example이다.

옮긴 화면: characters. 나머지 라우트는 `PendingMigrationPage`로 전환 중임을
표시한다.

## Verification Paths

| 영역            | 좁은 명령                            | 넓은 명령                                       | 필요한 환경            |
| --------------- | ------------------------------------ | ----------------------------------------------- | ---------------------- |
| Current UI      | `npm run admin:check`                | `npm run format`                                | Node                   |
| Focused backend | `npm run test -- <spec> --runInBand` | `npm run test`                                  | Node                   |
| API/worker      | 관련 spec                            | `npm run lint`, `npm run test`, `npm run build` | Node                   |
| DB/API boundary | 관련 E2E spec                        | `npm run test:e2e`                              | Docker                 |
| Prisma mirror   | `npm run schema:check`               | `npm run db:generate`, `npm run build`          | sibling backend/DB URL |
| PAVE/docs       | path/link review                     | PAVE doctor, `git diff --check`                 | repository             |

## Excluded and Generated Paths

| 경로                             | 이유                   | source of truth        |
| -------------------------------- | ---------------------- | ---------------------- |
| `node_modules/`                  | installed dependency   | `package-lock.json`    |
| `dist/`                          | Nest build output      | `src/`, `prompts/`     |
| `coverage/`                      | generated coverage     | source specs           |
| `test/.tmp/`                     | E2E runtime metadata   | E2E setup              |
| `.env`, `.env.*` except examples | secret                 | runtime environment    |
| server-local compose             | production host config | 운영 서버              |
| backend migration files          | 다른 repository 소유   | `opod-service-backend` |

## Known Gaps

- admin API는 `/api/admin/v1/*`이고 `/api/health`만 그 밖에 있다.
- auth는 `__Host-` HttpOnly cookie 세션이다. 최초 관리자는
  `ADMIN_BOOTSTRAP_EMAIL`과 `ADMIN_BOOTSTRAP_PASSWORD`로만 생성된다.
- repository 분리 완료: health, admin auth, media, settings audit,
  posting policy, character profile image.
- repository 분리 대기: `admin.service.ts`, `drafts.service.ts`,
  `generation.service.ts`, `characters.service.ts`, `visual-profile.service.ts`,
  `llm-log.service.ts`, worker service들. 대부분 병행 세션이 편집 중이라
  충돌을 피해 미뤘다.
- 부팅 설정은 `AppConfigService`로 주입한다. worker와 provider 설정 함수는
  아직 `env` 파라미터(기본값 `process.env`)를 받는다.
- frontend가 목표 React stack으로 전환되지 않았다.
- 토큰 사용량 집계는 `GET /api/admin/v1/llm-logs/usage`로 제공한다(UI 미연결).
- approved 4-table logging은 새 테이블이 필요해 `opod-service-backend`의
  canonical schema 변경이 선행돼야 한다.
- Raw SQL이 queue claim과 lock에 남아 있다.
- 실제 provider refund, 사용자 제재와 자동 상호작용 중단 기능이
  완성되지 않았다.
- `GET /api/health`가 DB 도달성을 확인한다. automated smoke와 rollback
  절차는 아직 없다.
