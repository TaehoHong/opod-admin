# 게시물 생성 Agent 통합 작업공간

Date: 2026-08-10
Status: implemented / verified

## 목표

게시글, 초안, draft 소속 생성 작업으로 나뉜 운영 흐름을 `게시물` 하나로
통합한다. 목록은 최근 변경순 테이블 운영 큐이고, 상세는 한 화면에 모든 내용을
쌓지 않는 8개 단계별 route다.

## 사용자 확정 결정

- `게시물`이 게시 전·후 전 생애주기의 단일 상위 메뉴다.
- 단계는 브리프 → 기획 → 프롬프트 → 평가 → 이미지 생성 → 검수 → 게시 →
  메모리 순서다.
- 평가는 선형 단계에 보이지만 실패·지연이 후속 생성을 막지 않는다.
- 각 단계는 별도 화면이며 공통 헤더와 단계 레일만 유지한다.
- 목록은 테이블 기반 운영 큐다. 기본 필터는 전체, 기본 정렬은 최근 변경순이다.
- 별도 상세 버튼 없이 행 클릭과 키보드 Enter로 현재 단계에 들어간다.
- 기본 열은 게시물, 캐릭터, 현재 단계, 상태, 게시 일정, 최근 변경이다.
- 현재 단계는 `⑥ 검수 · 6/8단계`처럼 압축한다.
- 상태는 가장 중요한 운영 신호 하나만 표시한다.
- `게시물 만들기`에서 만든 작업은 수동이다. 스케줄러가 만든 작업은 사람이
  콘텐츠에 개입하기 전까지 자동이다. 둘은 같은 파이프라인을 쓰며 위계가 없다.
- 자동 작업에 콘텐츠 수정·후보 교체·재생성이 발생하면 그 게시물은 수동으로
  전환된다.

## 구현 경계

1. `src/admin/post-workspace/`
   - draft-backed 게시물과 독립 게시물을 중복 없이 합치는 관리자 읽기 모델
   - 최근 변경 cursor, 운영 필터, 현재 단계·대표 상태 계산
   - 스키마 변경 없음
2. `src/admin/drafts/`
   - 관리자 생성 draft는 항상 manual
   - 기획 결과와 draft-state 프롬프트의 안전한 편집 endpoint
   - 콘텐츠 변경 시 conceptJson.mode를 manual로 전환
3. `packages/admin/src/features/posts/`
   - 통합 운영 큐와 URL filter
   - `/posts/new/brief`, `/posts/:workId/:stage`
   - 공통 상세 shell과 한 번에 한 단계만 렌더하는 8개 화면
4. navigation
   - 초안 메뉴 제거, 게시글을 게시물로 변경
   - 생성 메뉴는 독립 이미지 생성만 유지
5. 문서
   - `docs/draft-pipeline-ux.md`와 workflow 문서를 검증된 구현에 맞게 갱신

## 보존·제외

- 독립 이미지 생성 위저드와 API는 보존한다.
- 기존 provider, 평가 worker, 게시 상태 머신과 DB schema는 변경하지 않는다.
- 평가를 blocking gate로 만들지 않는다.
- attempt 전체 이력, 통합 이벤트 로그, 메모리 row의 draft FK 추가는 제외한다.

## 검증

- backend focused specs: 통합 목록 정렬·중복 제거·단계/상태, manual 생성/편집
  및 자동 집계 제외 통과
- frontend RTL: 전체 기본 필터, 행/키보드 이동, 단계별 단일 본문, 수동 생성
  통과 (14 files, 35 tests)
- `npm run lint` 통과
- `npm run test -- --runInBand` 통과 (38 suites, 320 tests)
- `npm run test:e2e` 통과 (5 suites, 11 tests)
- `npm run build` 통과
- 변경 파일 Prettier 검사 및 `git diff --check` 통과
- `npm run schema:check` 통과 (admin 79 blocks canonical 일치)
- 전체 `npm run format`은 이번 범위 밖 기존 워커/설정 파일 12개의 포맷
  드리프트로 실패. 이번 변경 파일은 모두 통과
- 로컬 `opod_admin` 이미지를 재빌드·교체했고 3200의 health(DB up)와 `/posts`
  HTML 200 확인
- 연결 가능한 브라우저가 없어 시각 회귀 검증은 수행하지 못함
