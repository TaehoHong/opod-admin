# Plan: admin 현대화 (project-init 결정사항 이행)

작성 2026-07-30. 다른 로컬 기기에서 이어받기 위한 인계 문서다.

## Goal

`docs/00-overview.md` ~ `docs/07-codebase-guide.md`에 승인된 결정사항을
실제 코드에 반영한다.

## Current Context

- 이 계획 이전 상태는 커밋 `737495a`(project-init)다. 이후 이 계획으로
  18개 커밋이 쌓였다.
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

지금 해도 되는 것 (legacy 삭제와 무관):

- Helmet CSP 활성화 — `docs/06-architecture.md:129`가 "실제 asset에 맞춘다"
  로 미뤄둔 항목. 현재 `contentSecurityPolicy: false`. Mantine이 런타임에
  `<style>`을 주입하고 화면 4곳이 inline `style` 속성을 쓰므로 `style-src`에
  `'unsafe-inline'`이 필요하다. 미디어는 외부 호스트라 `img-src`는
  `S3_PUBLIC_BASE_URL`(있으면)과 `https:`를 허용한다.
- 라우트 단위 lazy import — 빌드 산출물이 654kB로 Vite 경고 중
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

### [ ] 4. repository 분리

- 지금 전부 착수 가능하다 (병행 세션 제약 해소).
- 규모 (2026-07-31 실측, `this.prisma.`/`tx.` 호출 수 · 파일 줄 수):
  `admin.service.ts` 71 · 2036, `draft-worker.service.ts` 43 · 1302,
  `drafts.service.ts` 30 · 744, `generation.service.ts` 30 · 952,
  `characters.service.ts` 25 · 869, `generation-worker.service.ts` 19 · 775,
  `visual-profile.service.ts` 12 · 347, `llm-log.service.ts` 7 · 596.
  합계 237곳 / 약 7600줄이라 한 번에 끝내는 작업이 아니다.
- 서비스 하나 = 커밋 하나로 나눈다. 작은 것부터:
  `llm-log` → `visual-profile` → `generation-worker` → `characters` →
  `drafts` → `generation` → `draft-worker` → `admin`.
- 진행: `llm-log`(4b36c05), `visual-profile`(9a218df),
  `generation-worker`(110a35d), `characters`(a17a883) 완료.
  남은 4개 = `drafts`(30) · `generation`(30) · `draft-worker`(43) ·
  `admin`(71), 합계 호출 174곳.
- 매번 함께 나오는 두 가지:
  - spec이 Prisma 호출 형태를 검증하고 있으면 repository fake로 바꾸면서
    "무엇을 결정했는가"만 남긴다. 트랜잭션 콜백을 테이블 목으로 재현하던
    부분은 repository 책임이라 지운다.
  - `Prisma.JsonNull`(컬럼의 JSON null)과 `DbNull`(SQL NULL)을 바꿔 쓰지
    않는다. repository 경계를 넘길 때 조용히 뒤집히기 쉽다.
- 패턴: `src/health/`, `src/admin/auth/admin.repository.ts` 참고. spec은
  Prisma mock 대신 repository fake로 바꾼다
- 함께 처리: queue claim/lock의 Raw SQL을 repository 안으로 옮긴다
  (`docs/02-development-rules.md:90`). 현재 tagged template이라 안전 규칙은
  지키고 배치만 어긋난다
- 함께 처리: worker/provider 함수의 `env` 파라미터(기본값 `process.env`)를
  `AppConfigService` 주입으로 교체. 단 `GenerationSettingsService`는 DB 설정이
  env보다 우선하므로 런타임 재해석을 유지해야 한다
- Verification: 관련 spec, `npm test`

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
