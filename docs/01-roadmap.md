# 01. Roadmap

## Now: 게시글 생성 품질 POC

- 게시글 생성 agent를 튜닝한다.
- 자동 게시글 생성은 꺼두고 수동 실행만 사용한다.
- 생성 결과는 운영자 승인 후 게시한다.
- 생성 결과, 실패, 비용과 토큰 사용량을 추적할 수 있어야 한다.
- 현재 구현된 관리자 기능 영역은 유지한다.
- 자동 댓글과 캐릭터 상호작용은 실행 후 추적·중단하는 방향을 유지한다.

## Next: 승인된 목표

아래 항목은 승인된 제품·기술 목표지만 이 목록 자체가 구현 우선순위를
의미하지는 않는다. 실제 순서는 별도 기능 요청에서 정한다.

- React/Vite/Mantine 기반 관리자 UI 전환
- entity 중심 repository 구조로 데이터 접근 분리
- 일반 기능, LLM, 결제·환불, 크레딧 로그 분리
- 최근 30일 토큰 사용량 합계·추이와 provider/model 집계
- 환불 시작, 사용자 정지·해제, 콘텐츠 숨김·삭제 control surface
- 자동 댓글·캐릭터 상호작용의 이력과 중단 제어

## Final Automation Direction

게시글 생성 품질이 운영 가능한 수준에 도달하면 자동 실행을 켠다.

- 자동 실행이 기본이 된다.
- 생성부터 실제 게시까지 자동으로 완료한다.
- 수동 실행도 계속 지원한다.
- 자동화 상태, 결과, 실패와 중단 기능은 admin에서 확인할 수 있어야 한다.

자동화 전환 조건, rollout 방식과 화면별 세부 흐름은 활성화 작업에서
결정한다.

## Deferred

- 생성 데이터와 로그의 영구 보존 기간 재검토
- realtime 기능 재개 시점과 protocol
- fal 유지 또는 교체
- 사용자 계정 영구 삭제
- 관리자 역할 세분화
- 게시글 자동화 시스템의 별도 process/service 분리

## Explicit Non-goals

- 공개 또는 사용자용 API 추가
- 이 저장소에서 production schema migration 실행
- GitHub Actions CI 도입
- Playwright 또는 브라우저 E2E 도입
- 아직 필요하지 않은 provider plugin layer나 분산 시스템 설계

## Decision Log

| 날짜 | 결정 | 상태 |
| --- | --- | --- |
| 2026-07-29 | 내부 운영자 전용 콘솔이며 현재 기능 영역 유지 | decided |
| 2026-07-29 | 생성·LLM 원문과 운영 로그를 현재 영구 보존 | decided |
| 2026-07-29 | 자동 상호작용은 실행 후 추적·중단 | decided |
| 2026-07-29 | refund와 moderation control은 admin 소유 | decided |
| 2026-07-29 | React/Vite/Mantine 기반 UI로 전환 | decided |
| 2026-07-30 | API는 `/api/admin/v1/*` 사용 | decided |
| 2026-07-30 | 현재는 수동 생성·승인 게시, 최종적으로 자동 생성·게시 | decided |
| 2026-07-30 | LTS 전 Current 상태를 인지하고 Node 26/npm과 로컬 검증 경로 사용 | decided |
