# Plan: admin 현대화 (project-init 결정사항 이행)

작성 2026-07-30, 갱신 2026-07-31. 다른 세션이 이어받기 위한 인계 문서다.

## Goal

`docs/00-overview.md` ~ `docs/07-codebase-guide.md`에 승인된 결정사항을
실제 코드에 반영한다.

## 현재 상태

- 2026-07-31에 체크리스트 1~4를 구현했다. 아직 커밋하지 않은 작업트리이므로
  이어받을 때는 아래 Verification을 먼저 다시 실행한다.
- React admin이 유일한 frontend다. legacy entry와 정적 자산은 삭제했고
  root `npm run build`가 React bundle을 먼저 만든다.
- 제품 정책이 필요한 5번, 운영 방식을 정해야 하는 6번, sibling canonical
  schema 변경이 먼저 필요한 4-table logging은 이 migration 구현 범위에서
  진행하지 않았다.

## Historical Baseline

- 이 계획 이전 상태는 커밋 `737495a`(project-init)다. 이후 이 계획으로
  27개 커밋이 쌓였고, 이번 체크리스트 1~4 결과는 아직 커밋하지 않았다.
- 앞서 병행하던 게시물 생성 품질 작업의 결과
  (`assertVisibleCharacterHasReference` 등)는 현재 코드에 반영돼 있다.

## 완료

- 설정 누락 시 환경 구분 없이 실패(local placeholder provider 제거)
- Swagger/OpenAPI 제거
- bootstrap 환경변수 최초 관리자(`ADMIN_BOOTSTRAP_EMAIL`/`_PASSWORD`)
- Helmet 전역 적용 + CSP 활성화
- `GET /api/health` — repository 구조 canonical example
- `AppConfigService` — 부팅 설정 typed 주입
- `/api/admin/v1/*` 이관 + `__Host-` cookie 세션 + 전역 CSRF guard
- entity repository 분리: health, admin auth, media, settings audit,
  posting policy
- `GET /api/admin/v1/llm-logs/usage` 토큰 사용량 집계
- React 전환 시작: Vite/React/TS/Router/TanStack Query/Mantine/Vitest+RTL+MSW,
  Mantine Theme token, 화면 6개(characters, posts, users, credits,
  moderation, events)
- React 화면 나머지 9개 이관 완료 — home, analytics, payments, logs,
  llm-logs(토큰 사용량 대시보드 포함), media, settings, drafts, generation.
  `routes.tsx`의 `MIGRATED`가 nav 15개를 모두 덮는다. 좌측 네비게이션 대기
  배지도 붙였다(`shared/api/usePendingCounts`)

React 이관에서 지켜야 했던 것 두 가지 (반복하지 않도록 기록):

- 폴링 화면(drafts 3초, generation 2초)의 단계 component는 **module 레벨**에
  둔다. 부모 안에 정의하면 렌더마다 새 component type이 만들어져 매 폴링에
  하위 트리가 remount되고, 입력 중이던 캡션·프롬프트가 사라진다.
- 다른 초안·잡으로 바꿔 열 때는 `key={id}`로 새로 mount시킨다. `@mantine/form`
  uncontrolled는 mount 시점의 `initialValues`만 쓰므로 key가 없으면 이전
  대상의 값이 남는다.

## Checklist

### [x] 1. 이관 누락된 쓰기 화면 복구

2026-07-31 발견. React 이관은 조회 화면과 초안·생성·설정·미디어 워크플로는
덮었지만 몇몇 작성 기능이 빠졌다. legacy `main.js`에는 있고 React에는 없다.

**완료 — 캐릭터 관리.** React에서 `characters.controller.ts`의 쓰기 endpoint
20개를 모두 사용할 수 있다. 생성, 프로필·상태·프로필 이미지, 페르소나·메모리
단건/일괄/순서 관리, 비주얼 프롬프트·레퍼런스·캡션·테스트 생성, 포스팅 정책을
이관했다. 프로필 이미지와 비주얼 레퍼런스는 파일 선택 시 presign → S3 PUT →
confirm을 거쳐 바로 연결한다. `CharactersPage.test.tsx`와
`features/media/upload.test.ts`가 주요 입력→API 계약과 업로드 단계 순서를
보호한다.

**완료 — 크레딧 지급.** React 크레딧 원장에서 최근 사용자 50명을 이름과
이메일로 검색·선택해 양의 정수 금액, 사유, 선택 외부 참조를 지급할 수 있다.
성공 시 크레딧 원장과 사용자 목록 query를 무효화해 잔액과 원장을 갱신한다.
`CreditsPage.test.tsx`가 빈 원장에서도 지급 modal을 열 수 있는지, 정확한
payload와 지급 후 원장 refresh를 보호한다.

**완료 — 게시물과 생성 작업.** 게시물 생성은 media 순서를 보존하며
presign → PUT → confirm 후 정확한 payload로 등록한다. 댓글·반응 작성과
영상 generation job 등록/실행/완료/재시도도 React에서 가능하다. 서버 오류를
화면에 표시하고 pending 중 modal 닫기·중복 제출을 막는다.

**완료 — legacy 상세 parity.** 사용자 상세(원장·이벤트·사용자 사전 선택 지급),
게시물 상세(media·댓글·반응·action log), 캐릭터 관리 게시글·활동 탭을
복구했다. 관련 MSW interaction test가 요청 filter와 화면 결과를 보호한다.

- Verification: `npm run admin:check` — 9 files, 23 tests 통과

### [x] 2. React 전환 마무리

- legacy `main.js`, `styles.css`, `index.react.html`, legacy node:test를
  삭제하고 `index.html`을 React entry로 통합했다.
- `src/main.ts`는 `packages/admin/dist/index.html`만 서빙한다. root
  `npm run build`는 `admin:build` 후 Nest build를 실행하므로 Docker build도
  같은 산출물을 포함한다.
- character API source ownership guard는 삭제하지 않고 정상 Jest suite의
  `src/admin/admin-source-boundary.spec.ts`로 옮겼다.
- legacy payload test 중 현재 계약 가치가 있는 부분은 React
  Vitest/RTL/MSW interaction test가 보호한다.

**완료** (`065fcc2`) — Helmet CSP 활성화와 라우트 단위 lazy import는 legacy
삭제와 무관해서 먼저 끝냈다. 엔트리 청크 654kB → 329kB(gzip 195 → 103),
Vite 크기 경고 해소. CSP는 `script-src 'self'`가 실질 이득이고
`style-src`에는 `'unsafe-inline'`이 남는다(Mantine이 런타임에 CSS 변수
`<style>`을 주입한다). legacy가 서빙되는 경우에도 깨지지 않는 것을 확인했다
— 양쪽 다 inline `<script>`·`eval`·`onclick=`이 없다.

- Verification: `npm run admin:check`, `npm run build`, Docker image content
  smoke. 인증된 live browser 수동 확인은 별도 운영 환경에서 수행한다.

### [x] 3. E2E 실패 1건 수정

- `test/generation.e2e-spec.ts:337` — 레퍼런스 없는 캐릭터로 이미지 draft를
  만들면 201을 기대하는데 400이 온다.
- 원인은 버그가 아니라 의도된 정책이다. `generation.service.ts:273`이
  `assertVisibleCharacterHasReference`로 "인물이 보이는 샷은 신원 레퍼런스가
  있어야 한다"를 강제한다(`content-planner.ts:44`). 픽스처가 그 정책보다 먼저
  작성돼 낡았다.
- 테스트 캐릭터에 업로드 완료된 비주얼 프로필 레퍼런스를 API로 연결했다.
  외부 provider/storage만 deterministic fake로 교체하고 실제 worker,
  PostgreSQL, repository, transaction, HTTP endpoint는 유지했다.
- 3개 후보 저장, 동시 동일 output 선택, 단일 selected 후보와 단일
  `GENERATION_OUTPUT_SELECTED` audit log, regeneration을 검증한다.
- Verification: focused generation E2E 7건 통과. 전체 E2E는 Final
  Verification 결과를 따른다.

### [x] 4. repository 분리

목표는 `docs/02-development-rules.md` "Module and Repository Rules"의
"PrismaService는 repository에서만" 이다.

**끝난 것** (서비스 하나 = 커밋 하나):

| 서비스              | 커밋      |
| ------------------- | --------- |
| `llm-log`           | `4b36c05` |
| `visual-profile`    | `9a218df` |
| `generation-worker` | `110a35d` |
| `characters`        | `a17a883` |

**2026-07-31 완료** (착수 전 `this.prisma.`/`tx.` 호출 수):

| 서비스                                       | 호출 | 서비스 | spec |
| -------------------------------------------- | ---- | ------ | ---- |
| `src/domain/settings/generation-settings.service.ts` | 3    | 407    | 219 |
| `src/admin/drafts/drafts.service.ts`         | 30   | 744    | 538  |
| `src/admin/generation/generation.service.ts` | 30   | 952    | 1532 |
| `src/worker/draft-worker.service.ts`         | 43   | 1302   | 1486 |
| `src/admin/admin.service.ts`                 | 71   | 2036   | 1856 |

다섯 service 모두 직접 Prisma 호출이 0이다. `admin.service.ts`는
user/content/credit-payment/moderation/analytics의 다섯 repository로
분리했다. 나머지는 feature별 repository를 사용한다. validation, mapping,
오류와 상태 결정은 service에 남고 query, transaction, raw SQL claim은
repository가 소유한다.

#### 절차 (앞의 4개에서 매번 같았다)

1. `grep -n "this\.prisma\.\|tx\." <service>` 로 호출 지점을 뽑는다.
2. 옆에 `<entity>.repository.ts`를 만든다. `@Injectable()`, 생성자에
   `PrismaService` 하나. 서비스가 Prisma 타입을 몰라도 되도록 입력 타입을
   직접 선언하고, 행 타입은 `Prisma.XGetPayload<{ select: typeof fields }>`로
   export 한다.
3. 서비스 생성자를 repository로 바꾸고 호출을 옮긴다. 검증·변환·오류
   메시지는 서비스에 남긴다 — repository는 질의만 한다.
4. 모듈의 `providers`에 repository를 추가한다. `useFactory`로 만드는
   서비스(`VisualProfileService`, `GenerationWorkerService`,
   `DraftWorkerService`)는 `inject` 배열도 같이 바꿔야 한다.
5. spec을 repository fake로 바꾼다 (아래).
6. `npm run build && npm run lint && npx jest <경로>` → 통과하면 커밋.

#### 걸렸던 것 (반복될 것들)

- **`Prisma.JsonNull` ≠ `DbNull`.** 전자는 컬럼에 JSON null을 쓰고 후자는 SQL
  NULL이다. `llm-log`에서 옮기다 뒤집을 뻔했다. repository 경계에서
  `null`을 그냥 흘리지 말고 어느 쪽인지 정해서 매핑한다.
- **spec이 Prisma 호출 형태를 검증하고 있다.** `updateMany`의 where절,
  `create`의 `{data, select}`, 트랜잭션 콜백을 테이블 목으로 재현한 것 등.
  그건 저장 계층 설명이지 서비스 동작이 아니다. repository fake로 바꾸면서
  "서비스가 무엇을 결정했는가"만 남긴다 — 재큐냐 실패냐, 어떤 값을 다듬어
  넘겼는가, 액션 로그 순서 같은 것. 트랜잭션 내부는 repository 책임이므로
  지운다. 예: `generation-worker.service.spec.ts`(110a35d),
  `characters.service.spec.ts`(a17a883).
- **fake는 `Partial<Repository>` + `as unknown as jest.Mocked<Repository>`**
  형태가 편하다. 기본값을 채운 `repositoryFake(overrides)` 헬퍼를 두면 테스트
  하나가 자기와 상관없는 메서드를 스텁하지 않아도 된다.
- **`findUniqueOrThrow`**를 쓸 자리가 있다. 방금 upsert한 행을 다시 읽는
  경우 `| null`을 서비스로 흘리고 캐스팅으로 지우는 것보다 낫다
  (`visual-profile.repository.ts` `replaceReferences`).
- **schema enum을 추측하지 않는다.** `CharacterStatus`는 `active|inactive`
  둘뿐인데 `paused`가 있다고 넘겨짚어 빌드가 깨졌다. `prisma/schema.prisma`를
  본다.

#### 같이 처리할 것

- **완료 — Raw SQL.** generation/draft worker claim과 lock은 repository
  안에 있고 tagged template binding을 유지한다.
- **완료 — media assertion.** generation repository 조회 +
  `assertUploadedMediaRow` 순수 검증을 사용하고, Prisma를 받던 미사용 호환
  wrapper를 삭제했다.
- **완료 — typed runtime config.** S3, generation worker, draft worker
  설정은 `AppConfigService`가 소유하며 service/module에 주입된다. 네 파일의
  기본 `process.env`/env parameter와 env-only planner entry를 제거했다.
  character reference captioning도 같은 typed S3 config로 private object를
  읽는다.
  DB 설정이 env보다 우선하는 `GenerationSettingsService`의 요청별 재해석은
  그대로 유지한다.

- Verification: 전체 unit 30 suites, 274 tests 통과.

### [ ] 5. 제품 기능 (요구사항 확정 필요)

- 환불 시작 · 사용자 정지·해제 · 콘텐츠 숨김·삭제 control surface
- 자동 댓글·캐릭터 상호작용 이력과 중단 제어
- 둘 다 `docs/01-roadmap.md`에 한 줄씩만 있어 화면과 정책을 먼저 정해야 한다

### [ ] 6. 운영

- automated smoke와 rollback 절차 (`docs/05-quality-rules.md` Current Gaps).
  GitHub Actions CI는 명시적 비목표(`docs/01-roadmap.md`)이므로 로컬/서버
  스크립트 형태로 정한다

## 차단됨

- **4-table 로깅 분리** (일반/LLM/결제·환불/크레딧): 새 테이블이 필요한데
  canonical schema와 migration은 `opod-service-backend` 소유다
  (`docs/02-development-rules.md:99-101`). 이 저장소에서 시작할 수 없다.
  현재 `LlmLog`만 승인된 형태에 가깝고 `ConsoleLog`/`ServiceLog`는 다르다.

## Final Verification

- [x] Format: `npm run format`
- [x] Lint: `npm run lint`
- [x] Unit tests: `npm run test -- --runInBand` — 30 suites, 274 tests
- [x] Admin UI: `npm run admin:check` — 9 files, 23 tests
- [x] Integration/E2E: `npm run test:e2e` — 4 suites, 10 tests
- [x] Schema mirror: `npm run schema:check` — admin 64 blocks 일치
- [x] Build: `npm run build` — React production bundle + Nest
- [x] Image build: `docker build -f docker/Dockerfile -t opod-admin:admin-modernization .`
- [x] Image content smoke: React `dist/index.html`/assets 존재, legacy
      `main.js` 없음
- [x] Whitespace: `git diff --check`

Docker의 production dependency prune 단계가 기존 lockfile에서
11 moderate/4 high 취약점을 보고했다. migration 완료를 막지는 않지만 merge
전 dependency audit 결과를 검토한다.
