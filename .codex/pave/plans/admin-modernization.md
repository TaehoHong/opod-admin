# Plan: admin 현대화 (project-init 결정사항 이행)

작성 2026-07-30. 다른 로컬 기기에서 이어받기 위한 인계 문서다.

## Goal

`docs/00-overview.md` ~ `docs/07-codebase-guide.md`에 승인된 결정사항을
실제 코드에 반영한다.

## Current Context

- 이 계획 이전 상태는 커밋 `737495a`(project-init)다. 이후 이 계획으로
  16개 커밋이 쌓였다.
- **병행 세션 주의**: 게시물 생성 품질 작업(`docs/media-generation-quality-improvements.md`)은
  다른 세션이 소유한다. 아래 파일은 건드리지 않는다 —
  `prompts/*`, `src/worker/*`, `src/admin/drafts/drafts.service.ts`,
  `src/admin/generation/generation.service.ts`, `src/admin/admin.service.ts`,
  `src/characters/visual-profile.service.ts`, `src/admin/admin.module.ts`.
- **알려진 실패 1건**: `test/generation.e2e-spec.ts:337`이 400을 받는다.
  원인은 위 병행 세션의 `assertVisibleCharacterHasReference`이며 이 계획의
  책임이 아니다. 나머지 E2E 3개는 통과한다.

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
- React 화면 7개 추가 이관: home, analytics, payments, logs, llm-logs(토큰
  사용량 대시보드 포함), media, settings. 좌측 네비게이션 대기 배지도 함께
  붙였다(`shared/api/usePendingCounts`)

## Checklist

### [ ] 1. React 화면 2개 이관 — 병행 세션 종료 후

- 남은 화면: drafts, generation. 둘 다 **지금 착수하면 안 된다** —
  `docs/media-generation-quality-improvements.md:74`가 `packages/admin/main.js`를
  병행 세션의 변경 대상으로 명시하고 `:257-258`이 초안·생성 화면의 구체적
  위치를 가리킨다. 그 세션이 끝나고 legacy 화면이 확정된 뒤에 옮긴다.
- generation은 위저드라 가장 크다. drafts를 먼저 옮긴다.
- 패턴: `src/features/characters/`를 본뜬다. 목록은
  `shared/api/useCursorList` + `shared/ui/DataPage`, 폼은 `@mantine/form`
  uncontrolled + built-in `validate`. 상세는 목록 아래 `Paper` 패널로
  펼치고(payments, media, llm-logs 참고) 행 클릭 대신 버튼을 쓴다
- 색상·spacing은 `src/app/theme.ts` token만 사용한다. legacy `styles.css`
  값을 복사하지 않는다 (`docs/04-design-rules.md:25-26`)
- 화면을 옮길 때마다 `src/app/routes.tsx`의 `MIGRATED`에 등록한다
- Verification: `npm run admin:check`, `npm run admin:build`

### [ ] 2. React 전환 마무리 — 1번 이후

- `index.react.html`을 `index.html`로 합치고 legacy `main.js`,
  `styles.css`, `test/*.test.mjs` 제거
- `src/main.ts`의 legacy/React 분기 제거 (현재는 `dist/index.react.html`
  존재 여부가 전환 스위치)
- Helmet CSP 활성화 — `docs/06-architecture.md:129`가 "실제 asset에 맞춘다"
  로 미뤄둔 항목. 현재 `contentSecurityPolicy: false`
- 라우트 단위 lazy import — 빌드 산출물이 610kB로 Vite 경고 중
- legacy `main.js`를 지울 때 거기 있던 payload 단위 테스트도 함께 사라진다.
  값이 있는 것만 React 쪽으로 옮긴다 — 지금까지 옮긴 것은
  `features/settings/payload.test.ts` 하나다(빈 값의 의미가 필드마다 달라
  조용히 키를 지울 수 있는 부분)
- Verification: `npm run admin:check`, `npm run build`, 수동 로그인 확인

### [ ] 3. repository 분리 (지금 가능한 것)

- `src/characters/characters.service.ts` (Prisma 호출 26곳)
- `src/domain/llm-logs/llm-log.service.ts` (8곳)
- 위 둘은 병행 세션 소유가 아니라 지금 착수 가능하다
- 패턴: `src/health/`, `src/admin/auth/admin.repository.ts` 참고. spec은
  Prisma mock 대신 repository fake로 바꾼다
- Verification: 관련 spec, `npm test`

### [ ] 4. repository 분리 (병행 세션 종료 후)

- `admin.service.ts`(54곳), `draft-worker.service.ts`(32),
  `drafts.service.ts`(23), `generation.service.ts`(18),
  `generation-worker.service.ts`(14), `visual-profile.service.ts`(9)
- 함께 처리: queue claim/lock의 Raw SQL을 repository 안으로 옮긴다
  (`docs/02-development-rules.md:90`). 현재 tagged template이라 안전 규칙은
  지키고 배치만 어긋난다
- 함께 처리: worker/provider 함수의 `env` 파라미터(기본값 `process.env`)를
  `AppConfigService` 주입으로 교체. 단 `GenerationSettingsService`는 DB 설정이
  env보다 우선하므로 런타임 재해석을 유지해야 한다

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
- Integration/E2E: `npm run test:e2e` (Docker 필요, 위 알려진 실패 1건 제외)
- Build: `npm run build`
