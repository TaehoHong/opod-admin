# Plan: admin 현대화 (project-init 결정사항 이행)

작성 2026-07-30, 갱신 2026-07-31. 다른 세션이 이어받기 위한 인계 문서다.

## Goal

`docs/00-overview.md` ~ `docs/07-codebase-guide.md`에 승인된 결정사항을
실제 코드에 반영한다.

## 어디서부터 시작하나

- 저장소는 `c910cc7` 시점에 origin/main과 동기, 작업트리 깨끗, 전체 검증
  통과 상태다. 반쯤 하다 만 것은 없다.
- **1번(누락 쓰기 화면 복구)이 최우선**이다. 콘솔에서 지금 못 쓰는 기능이
  있다.
- 코드만 만지고 싶으면 **4번(repository 분리)**이 이어받기 가장 쉽다. 같은
  작업을 4번 반복했고 절차와 함정을 그 항목에 적어뒀다.

## Current Context

- 이 계획 이전 상태는 커밋 `737495a`(project-init)다. 이후 이 계획으로
  27개 커밋이 쌓였다.
- **병행 세션 제약은 해소됐다** (2026-07-31 확인). 게시물 생성 품질 작업
  (`docs/media-generation-quality-improvements.md`)을 진행하던 세션은
  종료됐고 결과물은 커밋돼 있다(`content-planner.ts`의
  `assertVisibleCharacterHasReference` 등). 작업트리도 깨끗하다. 이전에
  "건드리지 말 것"으로 묶어뒀던 `prompts/*`, `src/worker/*`,
  `admin.service.ts`, `drafts.service.ts`, `generation.service.ts`,
  `visual-profile.service.ts`, `packages/admin/main.js`는 모두 착수 가능하다.

## 완료

- 설정 누락 시 환경 구분 없이 실패(local placeholder provider 제거)
- Swagger/OpenAPI 제거
- bootstrap 환경변수 최초 관리자(`ADMIN_BOOTSTRAP_EMAIL`/`_PASSWORD`)
- Helmet 전역 적용(CSP는 아직 off)
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

### [ ] 1. 이관 누락된 쓰기 화면 복구 — **최우선**

2026-07-31 발견. React 이관은 조회 화면과 초안·생성·설정·미디어 워크플로는
덮었지만 **캐릭터 관리와 몇몇 작성 기능이 빠졌다**. legacy `main.js`에는
있고 React에는 없다.

빠진 것 (legacy `data-action` 기준):

- 캐릭터: 생성(`dlg-new-char`), 프로필 편집(`char-profile`), 프로필 이미지
  (`profile-image-save`), 페르소나 CRUD(`persona-create|update`), 메모리
  CRUD(`memory-create|update`), 비주얼 프로필·레퍼런스
  (`visual-profile-save`, `visual-ref-add`, `visual-test-gen`), 포스팅 정책
  (`policy-save`). 서버에는 `characters.controller.ts`에 쓰기 endpoint가
  20개 있는데 React가 부르는 것은 0개다.
- 크레딧 지급(`dlg-grant`, `credit-grant-full`)
- 게시물 작성(`dlg-new-post`), 댓글(`dlg-comment`), 반응(`dlg-reaction`)
- 영상 생성 job 등록(`dlg-new-job`)

**이미 영향이 있다.** `src/main.ts:35`가 `dist/index.react.html` 존재 여부로
서빙을 고르므로, `npm run admin:build`를 한 번이라도 돌린 환경에서는 legacy가
아예 서빙되지 않는다. 즉 위 기능은 지금 콘솔에서 접근할 수 없다.

- React 쓰기 endpoint 현황: `/drafts/*`, `/generation/jobs/*`,
  `/media/:id/confirm-upload`, `/moderation/reports/:id`, `/settings/*`,
  `/auth/*` 뿐. 서버 전체 쓰기 endpoint는 58개다.
- 착수 순서: 캐릭터(가장 큼, 탭 7개) → 크레딧 지급 → 게시물·댓글·반응
- Verification: `npm run admin:check`, `npm run admin:build`, 수동 확인

### [ ] 2. React 전환 마무리 — **1번 이후에만**

- legacy `main.js`, `styles.css`, `test/*.test.mjs` 제거와
  `index.react.html`→`index.html` 병합은 **1번을 끝낸 뒤에** 한다. 지금
  지우면 위 기능이 코드에서도 사라진다.
- `src/main.ts`의 legacy/React 분기 제거 (현재는 `dist/index.react.html`
  존재 여부가 전환 스위치)
- legacy `main.js`를 지울 때 거기 있던 payload 단위 테스트도 함께 사라진다.
  값이 있는 것만 React 쪽으로 옮긴다 — 지금까지 옮긴 것은
  `features/settings/payload.test.ts` 하나다(빈 값의 의미가 필드마다 달라
  조용히 키를 지울 수 있는 부분)

**완료** (`065fcc2`) — Helmet CSP 활성화와 라우트 단위 lazy import는 legacy
삭제와 무관해서 먼저 끝냈다. 엔트리 청크 654kB → 329kB(gzip 195 → 103),
Vite 크기 경고 해소. CSP는 `script-src 'self'`가 실질 이득이고
`style-src`에는 `'unsafe-inline'`이 남는다(Mantine이 런타임에 CSS 변수
`<style>`을 주입한다). legacy가 서빙되는 경우에도 깨지지 않는 것을 확인했다
— 양쪽 다 inline `<script>`·`eval`·`onclick=`이 없다.

- Verification: `npm run admin:check`, `npm run build`, 수동 로그인 확인

### [ ] 3. E2E 실패 1건 수정

- `test/generation.e2e-spec.ts:337` — 레퍼런스 없는 캐릭터로 이미지 draft를
  만들면 201을 기대하는데 400이 온다.
- 원인은 버그가 아니라 의도된 정책이다. `generation.service.ts:273`이
  `assertVisibleCharacterHasReference`로 "인물이 보이는 샷은 신원 레퍼런스가
  있어야 한다"를 강제한다(`content-planner.ts:44`). 픽스처가 그 정책보다 먼저
  작성돼 낡았다.
- 고칠 방향: 테스트 캐릭터에 비주얼 프로필 레퍼런스를 하나 붙이거나,
  `characterVisible: false` 경로로 케이스를 나눈다. 정책 자체를 완화하지
  않는다 — 그러면 개선 작업이 되돌아간다.
- Verification: `npm run test:e2e` (Docker 필요)

### [ ] 4. repository 분리 — 5개 남음

목표는 `docs/02-development-rules.md` "Module and Repository Rules"의
"PrismaService는 repository에서만" 이다.

**끝난 것** (서비스 하나 = 커밋 하나):

| 서비스              | 커밋      |
| ------------------- | --------- |
| `llm-log`           | `4b36c05` |
| `visual-profile`    | `9a218df` |
| `generation-worker` | `110a35d` |
| `characters`        | `a17a883` |

**남은 것** (2026-07-31 실측, `this.prisma.`/`tx.` 호출 수 · 서비스 줄 수 ·
spec 줄 수). 작은 것부터 하는 편이 리뷰 단위가 작다:

| 서비스                                       | 호출 | 서비스 | spec |
| -------------------------------------------- | ---- | ------ | ---- |
| `src/domain/settings/generation-settings.ts` | 3    | 407    | —    |
| `src/admin/drafts/drafts.service.ts`         | 30   | 744    | 538  |
| `src/admin/generation/generation.service.ts` | 30   | 952    | 1532 |
| `src/worker/draft-worker.service.ts`         | 43   | 1302   | 1486 |
| `src/admin/admin.service.ts`                 | 71   | 2036   | 1856 |

`admin.service.ts`는 엔티티가 여러 개(post, user, media, credit, payment,
moderation, event, analytics)라 repository도 엔티티별로 나눠야 한다. 한
파일에 71개를 몰아넣지 않는다. 이건 다른 넷과 달리 커밋을 더 쪼개는 게 낫다.

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

- **Raw SQL**은 repository 안으로 (`docs/02-development-rules.md:90`).
  생성 워커 claim은 `110a35d`에서 옮겼다. `draft-worker.service.ts`의 claim/
  lock도 같은 방식으로 옮긴다. tagged template은 유지한다.
- **`assertUploadedMedia(this.prisma, ...)`** 잔여 호출이 하나 있다
  (`generation.service.ts:718`). `9a218df`에서 순수 함수
  `assertUploadedMediaRow(row, type)`와 prisma를 받는 래퍼로 갈라놨으니,
  generation 차례에 repository 조회 + 순수 함수로 바꾸고 래퍼를 지운다.
- **`env` 파라미터**(기본값 `process.env`)를 `AppConfigService` 주입으로
  교체. 남은 파일: `media.service.ts`, `content-planner.ts`,
  `draft-worker.service.ts`, `generation-worker.service.ts`.
  단 `GenerationSettingsService`는 **제외** — DB 설정이 env보다 우선해서
  호출마다 재해석해야 한다.

- Verification: `npm run build`, `npm run lint`, `npm test`

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

- Format: `npm run format`
- Lint: `npm run lint`
- Unit tests: `npm test`
- Admin UI: `npm run admin:check` (legacy node:test + tsc + vitest)
- Admin UI build: `npm run admin:build`
- Integration/E2E: `npm run test:e2e` (Docker 필요. 체크리스트 3번을 끝내기
  전에는 `generation.e2e-spec.ts` 1건이 실패한다)
- Build: `npm run build`
