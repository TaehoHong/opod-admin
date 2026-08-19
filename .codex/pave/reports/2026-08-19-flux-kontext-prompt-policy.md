# 리포트 — FLUX.1 Kontext-dev 전용 프롬프트 정책

Status: 코드 완료 · provider 연동 대기
Date: 2026-08-19
계획: `.codex/pave/plans/2026-08-19-flux-kontext-prompt-policy.md`

## 결과

- 공식 logical model ID `black-forest-labs/FLUX.1-Kontext-dev`에
  `flux-kontext-policy-v1`을 등록했다.
- Nano는 기존 `Image N`, FLUX는 `Reference image N`을 사용한다.
- FLUX prompt 순서는 최종 사진 의도 → reference별 역할과 보존 범위 → ImagePlan의
  pose/gaze/composition/viewpoint/state/motion → light/color/finish다.
- identity/person 여러 장을 동일 주인공의 보조 증거로 합치고, environment는 지정된
  구체 공간 요소만 보존한다. reference의 pose/crop/viewpoint/composition은 복제하지
  않는다.
- PromptSet, ImagePlan, provider 호출부와 generation parameter는 변경하지 않았다.

## 리뷰

서브에이전트 1차 리뷰의 P1 세 건을 반영했다: reference preserve의 구도 권한 예외
제거, Nano wardrobe 계약 복원, FLUX 2-slot 누락·정순·역순 테스트 추가. 재검토 결과
잔여 P0/P1 없이 최종 승인됐다.

## 검증

- focused: 2 suites, 9 tests 통과
- 전체 Jest: 46 suites, 417 tests 통과
- format, lint, build, `git diff --check` 통과
- 첫 전체 Jest의 `listen EPERM`은 sandbox local-port 제한이었으며 동일 명령을 port
  허용 환경에서 재실행해 통과했다.

## 남은 일

custom generation server adapter가 ordered multi-reference conditioning과 역할별
asset 전달을 구현하고 capability test를 통과해야 한다. 그 전에는 이 model ID를
운영 설정에서 활성화하지 않는다. 실제 자연스러움·정체성·배경 보존 품질은 adapter
연동 후 렌더 표본으로 별도 판정한다.
