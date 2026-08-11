# 엄격한 평가 v2와 생성 이미지 평가

- 날짜: 2026-08-11
- 승인: 기획·프롬프트 평가 강화와 실제 생성 이미지 비전 평가까지 진행.
- 제외: 평가 결과에 따른 자동 재생성·자동 게시 상태 전이.

## 목표

1. 생성 전 평가가 결함을 발견하고도 높은 평균점수를 주지 않도록
   `eval-rubric-v2` 점수 앵커와 결정적 총점 상한을 적용한다.
2. 이미지 프롬프트 빌더가 레퍼런스의 자연스러운 신체 비율과 컷 간 의상·장소·
   촬영 도구를 보존하도록 한다.
3. 생성 완료 후보 이미지를 비전 LLM으로 평가해 후보별 점수, 하드 실패,
   승인 가능 여부와 컷 간 연속성을 저장하고 검수 화면에 표시한다.

## 범위

- `opod-service-backend`: `DraftEvaluationKind.image` canonical enum과 migration.
- `opod-admin`: schema mirror, evaluator prompts/parser, evaluation repository/worker,
  LLM log type, worker wiring, admin evaluation types/UI, focused tests and docs.
- 이미지 평가는 기존 evaluator provider 설정과 워커 토글/lease/backoff를
  재사용한다.

## 성공 기준

- 5점은 결함·지적·제안이 없는 경우만 허용되고, 중대 저점이나 하드 실패가
  높은 총점으로 가려지지 않는다.
- 최신 completed job의 모든 후보가 평가되고 결과가 jobId/mediaId/candidateIndex에
  고정된다.
- 휴대폰 방향, 얼굴 가림/크롭, 의상 변경, 인물 비율 변화, 장소 변화,
  반사·손 물리 오류, 심한 AI artifact가 하드 실패로 표현된다.
- 검수 화면에서 후보별 이미지 평가와 전체 컷 연속성을 확인할 수 있다.
- 관련 unit/UI tests, schema sync, lint, build가 통과한다.

## 검증

- focused Jest/Vitest specs
- `npm run schema:check`
- `npm run lint`
- `npm run test`
- `npm run admin:check`
- `npm run build`

