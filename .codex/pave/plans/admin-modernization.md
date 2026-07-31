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

### [ ] 1. React 전환 마무리

- `index.react.html`을 `index.html`로 합치고 legacy `main.js`,
  `styles.css`, `test/*.test.mjs` 제거
- `src/main.ts`의 legacy/React 분기 제거 (현재는 `dist/index.react.html`
  존재 여부가 전환 스위치)
- Helmet CSP 활성화 — `docs/06-architecture.md:129`가 "실제 asset에 맞춘다"
  로 미뤄둔 항목. 현재 `contentSecurityPolicy: false`
- 라우트 단위 lazy import — 빌드 산출물이 654kB로 Vite 경고 중
- legacy `main.js`를 지울 때 거기 있던 payload 단위 테스트도 함께 사라진다.
  값이 있는 것만 React 쪽으로 옮긴다 — 지금까지 옮긴 것은
  `features/settings/payload.test.ts` 하나다(빈 값의 의미가 필드마다 달라
  조용히 키를 지울 수 있는 부분)
- Verification: `npm run admin:check`, `npm run build`, 수동 로그인 확인

### [ ] 2. E2E 실패 1건 수정

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

### [ ] 3. repository 분리

- 지금 전부 착수 가능하다 (병행 세션 제약 해소).
- 규모 순: `admin.service.ts`(Prisma 호출 54곳),
  `draft-worker.service.ts`(32), `characters.service.ts`(26),
  `drafts.service.ts`(23), `generation.service.ts`(18),
  `generation-worker.service.ts`(14), `visual-profile.service.ts`(9),
  `llm-log.service.ts`(8)
- 착수 순서는 작은 것부터를 권한다 — `llm-log.service.ts` →
  `characters.service.ts` → 나머지. 큰 것을 먼저 하면 리뷰 단위가 커진다.
- 패턴: `src/health/`, `src/admin/auth/admin.repository.ts` 참고. spec은
  Prisma mock 대신 repository fake로 바꾼다
- 함께 처리: queue claim/lock의 Raw SQL을 repository 안으로 옮긴다
  (`docs/02-development-rules.md:90`). 현재 tagged template이라 안전 규칙은
  지키고 배치만 어긋난다
- 함께 처리: worker/provider 함수의 `env` 파라미터(기본값 `process.env`)를
  `AppConfigService` 주입으로 교체. 단 `GenerationSettingsService`는 DB 설정이
  env보다 우선하므로 런타임 재해석을 유지해야 한다
- Verification: 관련 spec, `npm test`

### [ ] 4. 제품 기능 (요구사항 확정 필요)

- 환불 시작 · 사용자 정지·해제 · 콘텐츠 숨김·삭제 control surface
- 자동 댓글·캐릭터 상호작용 이력과 중단 제어
- 둘 다 `docs/01-roadmap.md`에 한 줄씩만 있어 화면과 정책을 먼저 정해야 한다

### [ ] 5. 운영

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
- Integration/E2E: `npm run test:e2e` (Docker 필요. 체크리스트 2번을 끝내기
  전에는 `generation.e2e-spec.ts` 1건이 실패한다)
- Build: `npm run build`
