# 기능별 폴더 구조 정리

- 사용자 요청: Encore NestJS 구조 가이드에 맞춰 두 백엔드 폴더 재배치.
- 범위: src 파일 이동, DTO 분리, import/Drizzle/schema mirror 경로, 기존 경계 테스트와 정본 문서.
- 유지: HTTP 계약, DI provider/import/export 관계, Repository 소유권, 스키마 내용, 프런트엔드 구조.
- 제외: 비즈니스 로직 개선, 모듈 통합, 신규 추상화, DDL 생성/수정, 개발 DB 변경, 배포.
- 소유자 확인: owner-found — 기존 기능 모듈·DatabaseModule·공통 헬퍼를 이동하며 중복 구현을 만들지 않는다.
- 차단 결정: 0. 직접 구조 변경 요청 범위로 실행한다.

## 체크리스트

- [x] 글과 기존 모듈/호출자/테스트/구조 지침 확인.
- [x] src/<feature>, core, shared로 파일 이동 및 import·Drizzle 경로 갱신.
- [x] 기존 구조·소유권 테스트와 README/AGENTS/개발 규칙/아키텍처/코드 가이드 갱신.
- [x] build, lint, format, unit, E2E와 admin schema:check/admin:check 결과 확인.
- [x] 이동 전후 import 대상·실행 코드·스키마 내용 보존 검토.

기존 테스트를 활용한다. 신규 기능이 없으므로 형식적인 동작 테스트는 추가하지 않는다.
E2E는 Testcontainers 일회용 테스트 DB에서만 실행한다.

## 검증 결과

- build/lint/format/schema:check/admin:check 통과. 단위 52 suites/527 tests, E2E 11 suites/38 tests 통과.
- admin UI 20 files/83 tests 통과.
- 실행 코드 173개 파일의 token/import 대상 보존 확인. 스키마 내용은 이동 전과 바이트 단위 동일.
- Nest 빌드의 deleteOutDir 설정으로 이전 경로의 산출물이 남지 않는 것을 확인했다.
- 정본 README/AGENTS/개발 규칙/아키텍처/코드 가이드에 검증된 새 경로를 반영했다. 과거 연구 기록과 기존 사용자 변경은 보존했다.
- 병합 전 검토: HTTP/런타임 모듈 wiring과 스키마 정본 경로.
