# 07. Codebase Guide

> 현재 repository 증거에 기반한 탐색 인덱스다. 승인된 목표 구조와 현재
> 코드가 다르면 현재 코드를 사실로 보고 별도 변경으로 계획한다.

## How to Use

1. 요청과 관련된 module row를 찾는다.
2. target, direct caller/callee, relevant test와 canonical example을 읽는다.
3. evidence path가 현재 코드와 맞는지 확인한다.
4. 소유권이 없거나 증거가 충돌할 때만 탐색 범위를 넓힌다.

## Current Module Map

| 영역           | 현재 경로                                                                                                          | 현재 책임                                                            | 주요 진입점                                                          | 테스트·증거                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| Bootstrap/HTTP | `src/main.ts`, `src/app.module.ts`, `src/common/`                                                                  | Nest 시작, static UI, validation, exception, HTTP log                | `bootstrap`, `AppModule`                                             | `src/main.ts`, `src/app.module.ts`, `src/common/`           |
| Admin auth     | `src/admin/auth/`                                                                                                  | login, admin 생성, cookie 세션, CSRF/JWT guard                       | `AdminAuthController`, `AdminAuthService`, `AdminJwtGuard`           | `src/admin/auth/*.spec.ts`, `test/admin-auth.e2e-spec.ts`   |
| General admin  | `src/admin/admin.controller.ts`, `src/admin/admin.service.ts`, `src/admin/admin-*.repository.ts`, `src/admin/dto/` | user/content/credit/payment/report/analytics                         | `AdminController`, `AdminService`                                    | colocated specs, `test/admin-analytics.e2e-spec.ts`         |
| Drafts         | `src/admin/drafts/`                                                                                                | draft CRUD, planning, generation, approval, publish                  | `DraftsController`, `DraftsService`                                  | `drafts.service.spec.ts`, generation E2E                    |
| Generation     | `src/admin/generation/`, `src/worker/`                                                                             | job 생성, provider 호출, lease/retry, planning, publish              | `GenerationService`, `GenerationWorkerService`, `DraftWorkerService` | colocated specs, `test/generation.e2e-spec.ts`              |
| Characters     | `src/characters/`                                                                                                  | character/persona/memory/profile image/posting policy/visual profile | `CharactersController`, feature services와 repositories              | colocated specs, `test/character-profile-image.e2e-spec.ts` |
| Media          | `src/admin/media/`, `src/worker/generated-media-store.ts`, `src/worker/film-finish.ts`                             | upload, signing, generated media persistence                         | `MediaService`, store factories                                      | media/film specs                                            |
| Settings       | `src/admin/settings/`, `src/domain/settings/`                                                                      | provider 설정과 audit                                                | `GenerationSettingsService`                                          | settings specs, `docs/api/admin-settings.md`                |
| LLM logs       | `src/admin/llm-logs/`, `src/domain/llm-logs/`                                                                      | LLM 실행 기록·조회와 토큰 사용량 집계                                | `LlmLogService`, `LlmLogsController`, `TokenUsageService`            | LLM log specs, `token-usage.service.spec.ts`                |
| Prompt code    | `prompts/`, `src/worker/*prompt*`                                                                                  | pure prompt 구성과 worker orchestration                              | exported builders                                                    | prompt/worker specs                                         |
| Config         | `src/domain/config/`                                                                                               | 부팅 설정 로드·검증과 typed 주입                                     | `AppConfigService`, `loadAppConfig`, `ConfigModule`                  | `admin-auth.service.spec.ts`가 주입 경로 사용               |
| Health         | `src/health/`                                                                                                      | 인증 없는 liveness/readiness와 DB 도달성 확인                        | `HealthController`, `HealthService`, `HealthRepository`              | `health.controller.spec.ts`                                 |
| Prisma/schema  | `src/domain/database/`, `prisma/`, `scripts/check-schema-sync.mjs`                                                 | Prisma client와 admin schema mirror                                  | `PrismaModule`, `PrismaService`                                      | schema check, E2E setup                                     |
| Admin UI       | `packages/admin/src/`, `packages/admin/index.html`                                                                 | React admin과 `/api/admin/v1/*` 호출                                 | `main.tsx`, `app/`, `features/`                                      | `src/**/*.test.tsx`, `npm run admin:check`                  |
| E2E            | `test/`                                                                                                            | Testcontainers PostgreSQL와 API contract                             | Jest global setup                                                    | `test/jest-e2e.json`, `test/e2e-global-setup.ts`            |

## Shared Capability Catalog

| 기능                      | 현재 canonical owner                                    | 제약                                                                                                                                                                                        | 주요 사용처                                          |
| ------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Prisma connection         | `PrismaModule`, `PrismaService`                         | migration 소유권 없음                                                                                                                                                                       | admin, characters, worker                            |
| Admin auth                | `AdminJwtGuard`, `AdminCsrfGuard`, `AdminAuthService`   | `__Host-` cookie 세션, 상태 변경 시 고정 헤더                                                                                                                                               | protected controllers/UI                             |
| Pagination                | `src/domain/database/page.ts`                           | active filter 안에서 cursor 검증                                                                                                                                                            | list endpoints                                       |
| Provider settings         | `GenerationSettingsService`                             | secret response masking                                                                                                                                                                     | worker, settings, generation                         |
| LLM logging               | `LlmLogService`                                         | 현재 구현과 목표 4-table 구조 구분                                                                                                                                                          | planners/providers/admin                             |
| Image provider resolution | `resolveImageGenerationProviders`                       | 현재 provider를 영구 product abstraction으로 간주하지 않음                                                                                                                                  | generation worker                                    |
| Generated media storage   | `createGeneratedMediaStore`, `createReferenceUrlSigner` | provider 임시 결과를 owned storage에 보존                                                                                                                                                   | worker, draft publish                                |
| Prompt construction       | exports under `prompts/`                                | pure construction; network/DB 없음                                                                                                                                                          | planner, prompt builder                              |
| Shot generation contract  | `ContentPlanShot`, `paramsJson._shot`                   | `scene`과 `captureSetup` 분리, 인물 노출 샷은 업로드 완료 identity reference 필수. 장소는 게시물당 하나를 선택하며 environment reference는 별도 선별하고 인물 비노출 샷에도 사용 가능. provider 제출 사실은 `_shot.execution`에 기록하며 기획·실행 불일치는 검수 경고일 뿐 승인을 차단하지 않음 | planner, draft/generation worker, retry/regeneration |
| Runtime config            | `AppConfigService` (`ConfigModule`은 `@Global`)         | database/auth/TLS/S3/worker의 부팅 고정값 소유. DB 우선 provider 설정은 `GenerationSettingsService`가 유지                                                                                  | `app-config.spec.ts`, module factories               |
| Validation/error boundary | `ValidationPipe`, `AllExceptionsFilter`                 | whitelist+transform, common error response                                                                                                                                                  | all HTTP routes                                      |
| Admin shell navigation    | `packages/admin/src/app/AppLayout.tsx`                  | 현재 route 활성 표시, mobile 메뉴 닫기와 본문 바로가기 제공                                                                                                                                 | all admin UI routes                                  |
| List status feedback      | `packages/admin/src/shared/ui/DataPage.tsx`             | 목록의 loading·empty 상태를 보이는 문구와 `role="status"`로 공지                                                                                                                            | list pages                                           |
| Long table text           | `packages/admin/src/shared/ui/TableText.tsx`            | 긴 셀 내용을 줄 수로 제한하고 단일 문자열도 셀 안에서 줄바꿈하며 전체 문자열을 보존                                                                                                         | prose/file/prompt table cells                        |

## Current Canonical Examples

현재 존재하는 코드에서만 example을 지정한다.

| 관심사                              | example                       | 이유                                                                                            | 증거                                                                |
| ----------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Nest feature co-location            | character와 draft feature     | controller/service/DTO/spec가 기능 경계에 함께 있음                                             | `src/characters/`, `src/admin/drafts/`                              |
| DTO validation                      | draft DTO                     | HTTP input decorator와 validation 사용                                                          | `src/admin/drafts/dto/`                                             |
| Observable behavior tests           | draft/generation worker specs | 상태 전이와 결과를 보호                                                                         | `src/admin/drafts/drafts.service.spec.ts`, `src/worker/*.spec.ts`   |
| Cross-module DB contract            | auth/generation E2E           | 실제 PostgreSQL과 API 경계 검증                                                                 | `test/admin-auth.e2e-spec.ts`, `test/generation.e2e-spec.ts`        |
| Pure prompt logic                   | prompt builders               | network/persistence 없이 deterministic 구성                                                     | `prompts/`, 관련 specs                                              |
| Repository/application-service 구조 | health, characters, admin     | controller → application service → repository 방향이고 `PrismaService`가 repository 안에만 있음 | `src/health/`, `src/characters/`, `src/admin/admin-*.repository.ts` |

health feature가 승인된 repository/application-service 구조의 첫 canonical
example이고 character profile image가 entity mutation 적용 예다. 새 DB 접근은
이 형태를 따른다. 기존 service의 직접 Prisma 접근은 새 규칙의 example로
간주하지 않는다.

규모가 있는 적용 예로는 `src/characters/character.repository.ts`(엔티티 셋을
한 애그리게이트로 묶은 경우)와 `src/worker/generation-job.repository.ts`
(조건부 갱신·트랜잭션·raw SQL claim을 담은 경우)를 본다. 두 spec
(`characters.service.spec.ts`, `generation-worker.service.spec.ts`)이
repository fake로 서비스 판단만 검증하는 형태의 예다.

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

| 항목         | 현재                                   |
| ------------ | -------------------------------------- |
| Framework    | React + TypeScript + Vite              |
| Routing      | React Router                           |
| Server state | TanStack Query                         |
| UI/form      | Mantine + `@mantine/form` uncontrolled |
| Tests        | Vitest + RTL/jsdom + MSW Node          |

React 앱은 `packages/admin/src/`가 소유하고 `npm run admin:build`가
`packages/admin/dist/index.html`을 만든다. Nest는 이 entry만 서빙한다.
root `npm run build`가 admin bundle 후 Nest를 빌드하므로 application과
Docker build가 동일한 frontend 계약을 사용한다.

canonical example: auth feature(`src/features/auth/`)가 apiClient, TanStack
Query, Mantine form과 MSW 테스트를 한 번에 보여준다. characters feature가
목록 조회·cursor 페이지네이션과 route/tab 기반 entity 쓰기 관리의 canonical
example이다. `features/media/api.ts`의 `uploadMediaFile`은 한 화면에서 파일
선택부터 연결까지 끝내야 할 때 쓰는 presign → PUT → confirm owner다.

nav 15개 화면이 모두 React로 렌더된다. 라우트와 화면은 `app/routes.tsx`의
`NAV_ITEMS` 한 배열이 소유하고, 각 화면은 `lazy()`로 라우트 단위로 받는다.

캐릭터 관리 쓰기 endpoint, 게시물·댓글·반응 작성, 크레딧 지급, 영상 생성
job 등록/실행/완료/재시도가 모두 React에 있다. 사용자·게시물 상세와 캐릭터
게시글·활동 탭도 React 화면에서 접근한다. mutation modal은 pending 중 닫기와
중복 제출을 막는다.

색상·typography·radius는 `src/app/theme.ts`의 Mantine Theme token이
소유한다. 삭제된 legacy stylesheet에서 승인된 palette만 옮겼고 새 화면은
그 값을 직접 복사하지 않는다
(docs/04-design-rules.md:25-26). 목록 화면의 반복(제목·로딩·오류·빈
상태·더 보기)은 `shared/ui/DataPage`와 `shared/api/useCursorList`로
공통화했다. application shell의 route 위치와 keyboard 우회 동작은
`app/AppLayout`이, 긴 table 셀의 줄바꿈·말줄임은 `shared/ui/TableText`가
공통으로 소유한다.

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
  posting policy, character profile image, llm-log, visual-profile,
  generation-worker(queue), characters, generation settings, drafts,
  generation, draft-worker, general admin. application service는 직접
  `PrismaService`나 raw SQL을 사용하지 않는다.
- 부팅 고정 설정은 `AppConfigService`로 주입한다. media upload, reference
  captioning과 worker service는 같은 typed S3/worker config를 사용하고
  `process.env`를 직접 읽지 않는다. DB 우선 provider/planner 설정은
  `GenerationSettingsService`가 요청마다 재해석한다.
- frontend는 nav 15개 화면과 admin 쓰기·상세 workflow를 React로 렌더한다.
  legacy entry, script, stylesheet, node:test suite는 제거했다.
- Helmet CSP는 켜져 있다. `style-src`에 `'unsafe-inline'`이 남아 있고
  (Mantine이 런타임에 CSS 변수 `<style>`을 주입한다) `img-src`는 저장된
  미디어 URL 호스트가 고정돼 있지 않아 `https:`를 허용한다.
- approved 4-table logging은 새 테이블이 필요해 `opod-service-backend`의
  canonical schema 변경이 선행돼야 한다.
- generation/draft worker의 raw SQL claim과 lock은 각각 repository가
  소유한다.
- 실제 provider refund, 사용자 제재와 자동 상호작용 중단 기능이
  완성되지 않았다.
- `GET /api/health`가 DB 도달성을 확인한다. automated smoke와 rollback
  절차는 아직 없다.
