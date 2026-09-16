# 07. Codebase Guide

> 현재 repository 증거에 기반한 탐색 인덱스다. 승인된 목표 구조와 현재
> 코드가 다르면 현재 코드를 사실로 보고 별도 변경으로 계획한다.

## How to Use

1. 요청과 관련된 module row를 찾는다.
2. target, direct caller/callee, relevant test와 canonical example을 읽는다.
3. evidence path가 현재 코드와 맞는지 확인한다.
4. 소유권이 없거나 증거가 충돌할 때만 탐색 범위를 넓힌다.

## Current Module Map

| 영역           | 현재 경로                                                                                                                          | 현재 책임                                                                       | 주요 진입점                                                                                  | 테스트·증거                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Bootstrap/HTTP | `src/main.ts`, `src/app.module.ts`, `src/common/`                                                                                  | Nest 시작, static UI, validation, exception, HTTP log                           | `bootstrap`, `AppModule`                                                                     | `src/main.ts`, `src/app.module.ts`, `src/common/`           |
| Admin auth     | `src/admin/auth/`                                                                                                                  | login, admin 생성, cookie 세션, CSRF/JWT guard                                  | `AdminAuthController`, `AdminAuthService`, `AdminJwtGuard`                                   | `src/admin/auth/*.spec.ts`, `test/admin-auth.e2e-spec.ts`   |
| General admin  | `src/admin/admin.controller.ts`, `src/admin/admin.service.ts`, `src/admin/admin-*.repository.ts`, `src/admin/dto/`                 | user/content/credit/payment/report/analytics                                    | `AdminController`, `AdminService`                                                            | colocated specs, `test/admin-analytics.e2e-spec.ts`         |
| Drafts         | `src/admin/drafts/`                                                                                                                | draft CRUD, planning, generation, approval, publish, 수동 memory candidate 선택 | `DraftsController`, `DraftsService`                                                          | `drafts.service.spec.ts`, generation E2E                    |
| Post workspace | `src/admin/post-workspace/`                                                                                                        | draft/Post 통합 운영 큐, legacy/V3 단계와 paused next-action read model         | `PostWorkspaceController`, `PostWorkspaceService`                                            | `post-workspace.service.spec.ts`                            |
| Generation     | `src/admin/generation/`, `src/worker/`, `prompts/post-planner.ts`, `prompts/image-planner.ts`, `prompts/image-prompt-generator.ts` | job/provider/lease/publish와 V3 생성 Agent 오케스트레이션                       | `GenerationService`, `GenerationWorkerService`, `DraftWorkerService`, `PostPipelineV3Runner` | colocated specs, `test/generation.e2e-spec.ts`              |
| Evaluations    | `src/admin/evaluations/`, `src/worker/evaluation*`, `src/worker/v3-evaluators.ts`, `prompts/v3-evaluators.ts`                      | legacy 3종과 V3 4종의 비차단 평가·이력                                          | `EvaluationWorkerService`, `EvaluationsService`                                              | evaluator/worker/evaluations specs                          |
| Characters     | `src/characters/`                                                                                                                  | character/persona/memory/profile image/posting policy/visual profile            | `CharactersController`, feature services와 repositories                                      | colocated specs, `test/character-profile-image.e2e-spec.ts` |
| Locations      | `src/admin/locations/`                                                                                                             | global/character location CRUD, filtering, ordered references                   | `LocationsController`, `LocationsService`, `LocationsRepository`                             | `locations.service.spec.ts`, `test/locations.e2e-spec.ts`   |
| Media          | `src/admin/media/`, `src/worker/generated-media-store.ts`, `src/worker/film-finish.ts`                                             | upload, signing, generated media persistence                                    | `MediaService`, store factories                                                              | media/film specs                                            |
| Settings       | `src/admin/settings/`, `src/domain/settings/`                                                                                      | provider 설정과 audit                                                           | `GenerationSettingsService`                                                                  | settings specs, `docs/api/admin-settings.md`                |
| LLM logs       | `src/admin/llm-logs/`, `src/domain/llm-logs/`                                                                                      | LLM 실행 기록·조회와 토큰 사용량 집계                                           | `LlmLogService`, `LlmLogsController`, `TokenUsageService`                                    | LLM log specs, `token-usage.service.spec.ts`                |
| Prompt code    | `prompts/`, `src/worker/*prompt*`                                                                                                  | pure prompt 구성과 worker orchestration                                         | exported builders                                                                            | prompt/worker specs                                         |
| Config         | `src/domain/config/`                                                                                                               | 부팅 설정 로드·검증과 typed 주입                                                | `AppConfigService`, `loadAppConfig`, `ConfigModule`                                          | `admin-auth.service.spec.ts`가 주입 경로 사용               |
| Health         | `src/health/`                                                                                                                      | 인증 없는 liveness/readiness와 DB 도달성 확인                                   | `HealthController`, `HealthService`, `HealthRepository`                                      | `health.controller.spec.ts`                                 |
| Drizzle/schema | `src/domain/database/`, `drizzle.config.ts`, `scripts/check-schema-sync.mjs`                                                       | canonical `schema.ts`와 admin mirror                                            | `DatabaseModule`, `DatabaseService`                                                          | schema check, E2E setup                                     |
| Admin UI       | `packages/admin/src/`, `packages/admin/index.html`                                                                                 | React admin과 `/api/admin/v1/*` 호출                                            | `main.tsx`, `app/`, `features/`                                                              | `src/**/*.test.tsx`, `npm run admin:check`                  |
| E2E            | `test/`                                                                                                                            | Testcontainers PostgreSQL와 API contract                                        | Jest global setup                                                                            | `test/jest-e2e.json`, `test/e2e-global-setup.ts`            |

## Shared Capability Catalog

| 기능                      | 현재 canonical owner                                                      | 제약                                                                                                                                                                                                                                                                                                                                                                                 | 주요 사용처                                           |
| ------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Drizzle connection        | `DatabaseModule`, `DatabaseService`                                       | migration 소유권 없음                                                                                                                                                                                                                                                                                                                                                                | admin, characters, worker                             |
| Admin auth                | `AdminJwtGuard`, `AdminCsrfGuard`, `AdminAuthService`                     | `__Host-` cookie 세션, 상태 변경 시 고정 헤더                                                                                                                                                                                                                                                                                                                                        | protected controllers/UI                              |
| Pagination                | `src/domain/database/page.ts`                                             | active filter 안에서 cursor 검증                                                                                                                                                                                                                                                                                                                                                     | list endpoints                                        |
| Provider settings         | `GenerationSettingsService`                                               | secret response masking                                                                                                                                                                                                                                                                                                                                                              | worker, settings, generation                          |
| LLM logging               | `LlmLogService`                                                           | 현재 구현과 목표 4-table 구조 구분                                                                                                                                                                                                                                                                                                                                                   | planners/providers/admin                              |
| Image provider resolution | `resolveImageGenerationProviders`                                         | `GenerationSettingsService`의 명시적 `fal`/`opod-flux` 선택을 현재 잡마다 해석. opod-flux는 v1 named profile·idempotency·POST SSE 계약을 사용하고, `accepted` 이후 stream 단절·재시작만 status polling으로 복구. API key가 있을 때만 Bearer 전송. 진행 이벤트는 `GenerationJobRepository.recordProviderProgress`가 `paramsJson._providerProgress`에 저장하고 생성 상세 API/UI가 읽음 | generation worker, `docs/opod-flux-v1-integration.md` |
| Generated media storage   | `createGeneratedMediaStore`, `createReferenceUrlSigner`                   | provider 임시 결과를 owned storage에 보존. opod-flux SSE image base64 또는 복구 polling의 same-origin output을 SHA-256 확인한 뒤 저장                                                                                                                                                                                                                                                | worker, draft publish                                 |
| Prompt construction       | exports under `prompts/`                                                  | pure construction; network/DB 없음                                                                                                                                                                                                                                                                                                                                                   | planner, prompt builder                               |
| V3 post pipeline          | `PostPipelineV3Runner` + `DraftWorkerRepository`                          | 신규 draft version pin; stage별 attempt reset와 failed 수동 복구, 구조화 `pipeline.failure`, PostPlan → ImagePlan → PromptSet artifact revision/hash/CAS. 게시에는 15분 lease/CAS·오류 backoff, scheduler에는 캐릭터 advisory lock을 적용. ③은 최근 ready ImagePlan을 반복 ledger로 사용                                                                                             | V3 runner/agent/repository specs                      |
| V3 model policy           | `src/worker/image-model-policy.ts`                                        | exact model ID의 capability, 모델별 reference slot 표기/order와 prompt 문법만 소유; scene 의미나 generation parameter를 만들지 않음. Nano는 `Image N`, FLUX.1 Kontext-dev는 `Reference image N`을 쓰며 identity/person과 environment 계약을 각각 적용. identity reference는 정체성 또는 요청된 의상 속성만 보존하고 pose/crop/background/camera geometry는 ImagePlan이 소유          | prompt Agent, generation worker                       |
| Shot generation contract  | `ContentPlanShot`, `paramsJson._shot`                                     | `scene`과 `captureSetup` 분리, 인물 노출 샷은 업로드 완료 identity reference 필수. 장소는 게시물당 하나를 선택하며 environment reference는 별도 선별하고 인물 비노출 샷에도 사용 가능. provider 제출 사실은 `_shot.execution`에 기록하며 기획·실행 불일치는 검수 경고일 뿐 승인을 차단하지 않음                                                                                      | planner, draft/generation worker, retry/regeneration  |
| Runtime config            | `AppConfigService` (`ConfigModule`은 `@Global`)                           | database/auth/TLS/S3/worker의 부팅 고정값 소유. DB 우선 provider 설정과 워커 자동 루프 on/off는 `GenerationSettingsService`가 유지                                                                                                                                                                                                                                                   | `app-config.spec.ts`, module factories                |
| Worker 자동 루프 on/off   | `GenerationSettingsService.resolveWorkerToggles`                          | `admin_settings`의 `worker.enabled`(생성+draft), `evaluator.workerEnabled`(평가). 워커가 tick마다 재해석하므로 재시작 불필요. env는 DB 미설정 시 초기 기본값. 수동 실행 경로는 게이트하지 않는다                                                                                                                                                                                     | 세 워커 spec의 "loop switched off" 케이스             |
| Validation/error boundary | `ValidationPipe`, `AllExceptionsFilter`                                   | whitelist+transform, common error response                                                                                                                                                                                                                                                                                                                                           | all HTTP routes                                       |
| Admin shell navigation    | `packages/admin/src/app/AppLayout.tsx`                                    | 현재 route 활성 표시, mobile 메뉴 닫기와 본문 바로가기 제공                                                                                                                                                                                                                                                                                                                          | all admin UI routes                                   |
| List status feedback      | `packages/admin/src/shared/ui/DataPage.tsx`                               | 목록의 loading·empty 상태를 보이는 문구와 `role="status"`로 공지                                                                                                                                                                                                                                                                                                                     | list pages                                            |
| Post lifecycle workspace  | `packages/admin/src/features/posts/`, `shared/ui/OperationErrorAlert.tsx` | 통합 운영 큐, V3/V4 단계 실행, 수동 memory 선택. 오류는 문제 → 발생 이유 → 다음 행동과 접힌 기술 상세로 표시하고 완료한 이전 단계의 가짜 재실행을 제공하지 않음                                                                                                                                                                                                                      | posts routes, workspace service spec, UI check        |
| Long table text           | `packages/admin/src/shared/ui/TableText.tsx`                              | 긴 셀 내용을 줄 수로 제한하고 단일 문자열도 셀 안에서 줄바꿈하며 전체 문자열을 보존                                                                                                                                                                                                                                                                                                  | prose/file/prompt table cells                         |

## Current Canonical Examples

현재 존재하는 코드에서만 example을 지정한다.

| 관심사                              | example                       | 이유                                                                                              | 증거                                                                |
| ----------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Nest feature co-location            | character와 draft feature     | controller/service/DTO/spec가 기능 경계에 함께 있음                                               | `src/characters/`, `src/admin/drafts/`                              |
| DTO validation                      | draft DTO                     | HTTP input decorator와 validation 사용                                                            | `src/admin/drafts/dto/`                                             |
| Observable behavior tests           | draft/generation worker specs | 상태 전이와 결과를 보호                                                                           | `src/admin/drafts/drafts.service.spec.ts`, `src/worker/*.spec.ts`   |
| Cross-module DB contract            | auth/generation E2E           | 실제 PostgreSQL과 API 경계 검증                                                                   | `test/admin-auth.e2e-spec.ts`, `test/generation.e2e-spec.ts`        |
| Pure prompt logic                   | prompt builders               | network/persistence 없이 deterministic 구성                                                       | `prompts/`, 관련 specs                                              |
| Repository/application-service 구조 | health, characters, admin     | controller → application service → repository 방향이고 `DatabaseService`가 repository 안에만 있음 | `src/health/`, `src/characters/`, `src/admin/admin-*.repository.ts` |

health feature가 승인된 repository/application-service 구조의 첫 canonical
example이고 character profile image가 entity mutation 적용 예다. 새 DB 접근은
이 형태를 따른다. 기존 service의 직접 Drizzle 접근은 새 규칙의 example로
간주하지 않는다.

규모가 있는 적용 예로는 `src/characters/character.repository.ts`(엔티티 셋을
한 애그리게이트로 묶은 경우)와 `src/worker/generation-job.repository.ts`
(조건부 갱신·트랜잭션·raw SQL claim을 담은 경우)를 본다. 두 spec
(`characters.service.spec.ts`, `generation-worker.service.spec.ts`)이
repository fake로 서비스 판단만 검증하는 형태의 예다.

## Target Dependency Rules

- 새 DB 접근은 entity repository에 둔다.
- `DatabaseService`를 controller, application service 또는 domain service에
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

상위 navigation과 화면은 `app/routes.tsx`의 `NAV_ITEMS` 한 배열이 소유하고,
각 화면은 `lazy()`로 라우트 단위로 받는다. 게시 전 draft와 게시 완료 Post는
`게시물` 메뉴의 최근 변경순 운영 큐에서 함께 보고, 상세는
`/posts/:workId/:stage`의 8단계 화면으로 이동한다. 독립 이미지 생성만 `이미지
생성` 메뉴에 남는다. 그 밖의 목록 상세 경로는 같은 파일의 `DETAIL_ROUTES`가
소유하고(`/generation/:jobId`, `/payments/:paymentId` 등), 화면은
선택 상태를 useState가 아니라 `shared/routing/useDetailSelection`으로 URL에
둔다. 상세의 표현(인라인 패널 또는 modal)은 화면이 그대로 정한다. 캐릭터와
장소처럼 상세가 독립 페이지인 화면은 `CharacterManagerPage`,
`LocationManagerPage`를 별도 route로 건다. 라우터를 쓰는 화면 테스트는
`src/test/renderPage.tsx`(또는 화면별 render helper)로 라우트 패턴과 함께
렌더한다.

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
공통으로 소유한다. `DataPage`는 빈 목록일 때 children을 통째로 감추므로 목록 외
컨트롤(생성 폼, 상세 패널)을 children에 두는 화면은 빈 상태를 직접 그린다.

이미지 확대(라이트박스)는 `shared/ui/ZoomableImage`가 소유한다. 이미지
클릭이 다른 뜻을 갖지 않는 자리에서는 `ZoomableImage`로 감싸고, 클릭이 이미
선택인 생성 화면 후보 그리드는 `ImageLightbox`를 별도 버튼으로 연다. 마감
프리셋이 걸린 초안 후보는 `compare`로 원본/마감 비교 슬라이더를 연다.
독립 이미지 생성의 running 상세는 `features/generation/ImageWizard.tsx`가
opod-flux phase·stage·실제 progress를 기존 2초 job polling으로 표시하며,
숫자 progress가 없으면 진행 막대를 렌더하지 않는다.

목록이 참조하는 캐릭터·사용자는 `shared/ui/EntityName`의 `CharacterName` /
`UserName`으로 이름을 표시한다(못 찾으면 8자 축약 + title에 전체 ID). mutation
결과는 `shared/ui/MutationAlert` 하나로 성공(role=status)·실패(role=alert)를
같은 모양으로 알린다. 실패 상세의 canonical owner는
`shared/ui/OperationErrorAlert`이며 문제·발생 이유·다음 행동을 먼저, 원문을
접힌 기술 상세로 표시한다. 유실 기능 대조 기록은
`docs/react-migration-gaps.md`에 있다.

## Verification Paths

| 영역                  | 좁은 명령                            | 넓은 명령                                       | 필요한 환경     |
| --------------------- | ------------------------------------ | ----------------------------------------------- | --------------- |
| Current UI            | `npm run admin:check`                | `npm run format`                                | Node            |
| Focused backend       | `npm run test -- <spec> --runInBand` | `npm run test`                                  | Node            |
| API/worker            | 관련 spec                            | `npm run lint`, `npm run test`, `npm run build` | Node            |
| DB/API boundary       | 관련 E2E spec                        | `npm run test:e2e`                              | Docker          |
| Drizzle schema mirror | `npm run schema:check`               | `npm run build`                                 | sibling backend |
| PAVE/docs             | path/link review                     | PAVE doctor, `git diff --check`                 | repository      |

## Excluded and Generated Paths

| 경로                               | 이유                   | source of truth          |
| ---------------------------------- | ---------------------- | ------------------------ |
| `node_modules/`                    | installed dependency   | `package-lock.json`      |
| `dist/`                            | Nest build output      | `src/`, `prompts/`       |
| `coverage/`                        | generated coverage     | source specs             |
| `test/.tmp/`                       | E2E runtime metadata   | E2E setup                |
| `test/fixtures/legacy-migrations/` | phase-1 test DB DDL    | 기존 운영 migration 이력 |
| `.env`, `.env.*` except examples   | secret                 | runtime environment      |
| server-local compose               | production host config | 운영 서버                |
| backend migration files            | 다른 repository 소유   | `opod-service-backend`   |

## Known Gaps

- admin API는 `/api/admin/v1/*`이고 `/api/health`만 그 밖에 있다.
- auth는 `__Host-` HttpOnly cookie 세션이다. 최초 관리자는
  `ADMIN_BOOTSTRAP_EMAIL`과 `ADMIN_BOOTSTRAP_PASSWORD`로만 생성된다.
- repository 분리 완료: health, admin auth, media, settings audit,
  posting policy, character profile image, llm-log, visual-profile,
  generation-worker(queue), characters, generation settings, drafts,
  generation, draft-worker, general admin. application service는 직접
  `DatabaseService`나 raw SQL을 사용하지 않는다.
- 부팅 고정 설정은 `AppConfigService`로 주입한다. media upload, reference
  captioning과 worker service는 같은 typed S3/worker config를 사용하고
  `process.env`를 직접 읽지 않는다. DB 우선 provider/planner 설정은
  `GenerationSettingsService`가 요청마다 재해석한다. 워커 자동 루프 on/off도
  같은 서비스가 소유하고 워커가 tick마다 재해석한다 — `AppConfigService`에는
  `enabled` 필드가 없다.
- 평가 LLM(`evaluator.*`)과 채팅 LLM(`agent.*`)은 env 폴백이 없다. DB 값이
  없으면 planner 실효값을 필드 단위로 상속한다.
- frontend는 nav 16개 화면과 admin 쓰기·상세 workflow를 React로 렌더한다.
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

## Persona response and post policy normalization — 2026-09-16 verified

- `CharactersService.toCharacterPersona`가 persona 목록·상세·생성·수정 응답의 공통 mapper다. repository가
  선택한 `schemaVersion`을 응답에 그대로 포함하며 `src/characters/characters.service.spec.ts`가 이 API
  field 계약을 보호한다. 좁은 명령은
  `npm run test -- src/characters/characters.service.spec.ts --runInBand`다.
- `PostPipelineV3Runner`가 V3/V4의 `content_style`/`content_guidance` alias를 LLM 호출 전에 하나의
  `content_style` owner로 정규화한다. trim 후 내용이 같으면 하나로 합치고 다르면 `conflict`와
  `persona_content_policy_conflict`로 pause한다. 둘 다 없을 때의 `missing_content_style` pause는 유지한다.
  정규화된 persona 집합은 post planning, image planning, caption에 공통으로 전달한다. 좁은 회귀 명령은
  `npm run test -- src/worker/post-pipeline-v3.runner.spec.ts --runInBand`다.

## Authored character context — 2026-09-08 verified boundary

### 2026-09-16 persona schema v2 검증

- 구조 API는 선택 `schemaVersion`을 받아 source와 fragment를 같은 트랜잭션에서 저장한다. 신규
  `motivation`/`judgment`/`tension`/`relationship`/`boundary` kind는 v2에서만 저장할 수 있고,
  v2의 `creator_note`는 `never_prompt`, `greeting`은 `start_only`만 허용한다. v1 요청과 기존
  `behavior`/`lore` 자료는 계속 읽고 저장한다.
- UI의 기존 읽기 전용 처리 정책 패널은 schema version과 v2 역할명을 표시한다. E2E setup은 backend
  정본 `20260916062345_persona_schema_v2` migration을 직접 적용하며 별도 SQL 사본을 두지 않는다.
  `test/character-context.e2e-spec.ts` 10개와 전체 admin E2E 21개가 일회용 DB에서 통과했다.

### 2026-09-11 추가 검증

- 정본 연결 확장은 `canonIds`가 있는 조각을 `never_prompt`로 제한하고, 같은 캐릭터의 활성 memory만
  연결한다. 연결 전후 구조 편집은 `structureSha256`, 연결된 memory 편집은 `memorySha256` CAS를 요구한다.
  memory PATCH는 persona/post 출처의 소유권·인용문 UTF-8 바이트 범위·SHA와 사건 시점 정밀도를 검증하며,
  연결된 memory/persona의 기존 삭제 API는 연결 해제 전 409를 반환한다.
- `manual` source ref는 검증 가능한 승인 기록 owner가 아직 없으므로 UUID만 신뢰하지 않고 400으로
  거부한다. 승인 기록 테이블/서비스가 별도 설계될 때까지 지원하지 않는다.
- E2E setup은 backend 소유 `20260911074900_character_canon_sources` migration도 직접 적용한다.

- backend 정본 `20260911063302_character_chat_context`를 미러링한다. E2E setup은 이 migration을
  backend 파일에서 직접 읽으며 새로운 SQL 사본을 만들지 않는다.
- `CharacterRepository.updateMemory`는 canon 본문이 실제로 변경된 경우만 embedding/model/
  source SHA/embeddedAt을 같은 UPDATE에서 초기화한다. 동일 본문·라우팅 변경은 유지한다.
- `replacePersonaStructure`는 원문 CAS/트랜잭션과 새 fragment 행 ID를 유지한다. 지워진 조각의
  ID로 늦게 도착한 색인 쓰기는 새 조각을 갱신할 수 없다. 구조 API는 embedding 필드를 노출하지 않는다.
- 회귀 증거: `test/character-context.e2e-spec.ts` 9개, 단위445개, build/lint/schema:check 통과.
  최신 정본 이관은55433 원본에서 만든 격리 복제본에서만 리허설하고 API로 논리 복구했다.
  개발 DB와55433 원본에 이번 DDL/내용을 적용한 기록이 아니다.

- schema 정본은 backend의 `20260908093302_persist_character_context` migration이며 admin은
  동일한 `schema.ts`를 미러링한다. 테스트용 SQL 사본은 `test/fixtures/legacy-migrations/`에 있다.
  새 schema 없이 변경된 reader/admin을 먼저 배포하지 않는다.
- 기존 CharactersController → CharactersService → CharacterRepository에 구조 API를 추가했다.
  `GET/PUT /api/admin/v1/characters/:id/personas/:personaId/structure`는 원문+조각을 읽고 저장한다.
  PUT의 `sourceSha256`은 원문 버전 검증, 선택 `content`는 새 원문, `fragments`는 순서대로
  저장하는 content/kind/injection/recallKeys다. 원문과 조각 연결이 정확히 같아야 한다.
- CharacterRepository가 행 잠금, 원문 SHA 확인, 조각 교체와 action log의 트랜잭션을 소유한다.
  SHA가 다른 오래된 본문 수정 또는 구조화 원문에 대한 기존 본문-only PATCH는409다.
  분류-only 수정은 원문 timestamp를 보존한다. `structureSha256`이 있으면 분류 간 충돌도409다.
  연결이 없고 새 토큰도 없는 구버전 요청만 정책 last-write-wins 호환을 유지한다.
- `PUT /api/admin/v1/characters/:id/memory/:memoryId/routing`은 canon kind/injection/recallKeys를
  저장한다. 명시적 event는 retrieved만 허용하며 목록 응답에서도 정책을 읽을 수 있다.
  JWT/CSRF 경계를 유지하고 경로UUID/DTO/캐릭터 소유권을 검사한다. 새 시각적 편집기는 없다.
- `test/character-context.e2e-spec.ts`가 실제 DB 저장/새 앱 재조회/원자 수정/충돌/오류 rollback/
  인증/캐릭터 격리/DB event 제약을 검증한다. 좁은 명령은
  `npm run test:e2e -- --runTestsByPath test/character-context.e2e-spec.ts`.
  전체 단위445/E2E16/build/lint/schema check를 확인했다. 개발 DB에는 적용하지 않았다.
