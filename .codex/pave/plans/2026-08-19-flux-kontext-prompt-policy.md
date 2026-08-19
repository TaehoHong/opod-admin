# FLUX.1 Kontext-dev 전용 프롬프트 정책

Status: 구현 완료
Last updated: 2026-08-19

## Goal

provider 호출 형식과 무관하게, ④ Image Prompt Generation Agent가 동일한 ImagePlan을
FLUX.1 Kontext-dev에 맞는 영어 자연어와 ordered multi-reference 역할 계약으로
컴파일하게 한다.

## Confirmed Decisions

1. PromptSet과 ImagePlan JSON은 변경하지 않는다.
2. 공식 logical model ID는 `black-forest-labs/FLUX.1-Kontext-dev`다.
3. 컷당 최대 5개 reference를 `Reference image N`으로 실제 asset 순서에 매핑한다.
4. 여러 identity/person reference는 같은 주인공의 정체성·요청된 의상 증거다.
5. environment reference는 요청된 구체 공간 요소만 보존한다. pose, crop,
   viewpoint, composition은 항상 ImagePlan 소유다.
6. provider endpoint, 인증, payload, generation parameter는 후속 범위다. ordered
   multi-reference adapter와 capability test 전에는 운영에서 model ID를 활성화하지
   않는다.

## Scope

- `prompts/image-model-policies.ts`: FLUX policy v1과 모델별 slot prefix
- `src/worker/image-model-policy.ts`: policy의 slot 표기를 package에 적용
- 관련 specs: Nano 회귀, FLUX identity/environment 2-slot, 누락·정순·역순
- durable docs와 prompt research log 갱신

## Verification

- focused: model-policy + prompt-generator specs
- full: format, lint, Jest, build, `git diff --check`
- 실제 모델 품질과 custom server capability는 provider 연동 뒤 별도 관측
