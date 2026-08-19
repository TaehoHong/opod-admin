# 전송본 기록 · ④ 촬영 주체 번역 · 평가 Agent 제거

Status: 계획 — 구현 승인 대기
Last updated: 2026-08-18
근거: 2026-08-18 ②③④ 병렬 리뷰(3개 subagent). 관측 표본은 §19.1 #22의 5컷.

## 왜

세 리뷰가 같은 곳을 가리켰다. **결정은 계약 밖 데이터가 하고, 검증 계층은 그
데이터를 정답으로 삼으며, 그 검증 자체가 절반은 오작동한다.**

- ④ 평가의 `negative_prompt_safety`는 대상이 항상 null이라 공허하다
- `meta_leak` 사전은 ④가 실제로 쓴 `the camera remains outside the frame`을
  못 잡는다(5컷 0건). 이번 최대 결함(장치 프레임 침입 2/2)이 그대로 통과했다
- `unmanned_person_leak`는 `Do not include … selfie` 같은 **배제 문장을 위반으로
  오탐**한다
- `length_bounds`는 #14가 기각한 "길이가 지렛대다" 가설의 상한(350 words)을
  강제한다. 권도건 2컷 모두 초과(379·423)
- ⑤ `style_fidelity`는 `visualStyle` 준수를 재므로 권도건 화보는 **위반이 아니라
  준수**다
- "카탈로그처럼 보이지 않는가"를 보던 유일한 문장은 V2 `image-evaluator.ts:56`의
  `non-catalog imperfection`이고, V3 전환에서 유실됐다(v3-evaluators에 0건)

§18.7·§19.2가 이미 "평가 프롬프트에 '자연스러운지 보라'를 더하는 접근은 가짜
초록불을 재생산한다"고 판정했다. 고쳐 쓰는 대신 **걷어내고 운영자 판정으로
돌린다**(§19.5(d)의 두 번째 선택지).

## 운영자 결정 (2026-08-18)

1. 순서: **4번(전송본 기록) → 2번(④ 촬영 주체) → 평가 제거**
2. 평가 **데이터는 남긴다** — 코드만 제거하고 `DraftEvaluation`·`EvaluationReport`
   테이블과 저장된 설정 값은 그대로 둔다. 마이그레이션 없음
3. **지워야 하는 게 아니면 남긴다** — `prompt-lint.ts`는 호출처가 사라지지만
   순수 함수 + 테스트라 파일은 보존한다. 나중에 결정적 체크가 필요할 때 재사용
   후보다

## Scope Map

| # | 서브시스템 | 변경 | 파일 |
|---|---|---|---|
| 1 | 전송본 기록 | 프로바이더가 만든 최종 문자열(본문 + `Do not include: …`)을 잡에 기록해 `generation_jobs.prompt`가 곧 전송본이 되게 한다 | `src/worker/image-generation.provider.ts`, `generation-worker.service.ts`, `generation-job.repository.ts` |
| 2 | ④ 촬영 주체 | `prompts/image-prompt-generator.ts:18`의 "captureSetup camera mechanics를 보존하라 + 프레임에 넣지 마라" 한 줄을 **교체**한다. 촬영 주체와 지지 장치는 고유명사로 렌더하지 않고 시점·거리·높이·각도로만 옮기되, "다른 사람이 찍었다"는 사실이 만드는 시각적 귀결(피사체가 렌즈를 보지 않음 등)은 ③가 쓴 만큼 옮긴다. 프롬프트 버전 v2 → v3 | `prompts/image-prompt-generator.ts` |
| 3 | 평가 워커 제거 | 파일 삭제: `evaluation-worker.service.ts`, `evaluation.repository.ts`, `plan-evaluator.ts`, `prompt-evaluator.ts`, `image-evaluator.ts`, `v3-evaluators.ts` + 각 spec, `evaluation-average.spec.ts` | `src/worker/` |
| 4 | 평가 프롬프트 제거 | `prompts/v3-evaluators.ts`, `prompts/image-evaluator.ts` | `prompts/` |
| 5 | Admin API 제거 | `src/admin/evaluations/` 전체(라우트 5개: `evaluations/worker/run`, `drafts/:id/evaluations`, `evaluation-reports` CRUD 3), `admin.module.ts` 배선 | `src/admin/` |
| 6 | 워커 배선 | `worker.module.ts`에서 `EvaluationWorkerService`·`EvaluationRepository` provider·export 제거 | `src/worker/worker.module.ts` |
| 7 | 설정 | `evaluator.*` 키(llmApiUrl/llmApiKey/llmModel/workerEnabled)와 화면 항목 제거. **DB에 저장된 값은 남긴다** | `src/domain/settings/`, `src/admin/settings/`, `packages/admin/src/features/settings/` |
| 8 | 화면 | 평가 블록·평가 상태 표시 제거 | `PostWorkPage.tsx`, `PostQueuePage.tsx`, `CandidateCard.tsx`, `posts/api.ts`, `drafts/api.ts` |
| 9 | 읽기 모델 | `post-workspace`가 평가를 조인·노출하는 경로 제거 | `src/admin/post-workspace/` |
| 10 | 문서 | 관측 4 표 정정(서린이 통과한 이유는 페르소나 중복이 아니라 `stylePrompt`의 촬영 매뉴얼), §19.3의 "job.prompt가 1차 증거" 정정, §19.6의 "④ 잘못이 아니다" 정정, 평가 제거 결정 기록 | `docs/` |

## 남기는 것 (의도적)

- `DraftEvaluation`·`EvaluationReport` 테이블과 기존 행
- `evaluator.*` 설정 값(DB)
- `src/worker/prompt-lint.ts` + spec — 호출처 없음. **죽은 코드로 방치하지 않도록
  파일 상단에 "현재 호출처 없음, 결정적 체크 재도입 시 후보" 주석을 단다**

## 호환성·위험

- 평가는 원래 **비차단**이고 러너가 읽지 않는다(§19.2 "진단은 정확한데 처방 경로가
  없다"). 파이프라인 진행에는 영향이 없다
- 평가 API를 부르던 화면이 남으면 404가 난다 → 8·9와 5를 같은 배포에 넣는다
- 4번은 프롬프트 버전이 또 오른다. **v2(subjectState·motionEvidence·notInFrame)가
  아직 한 번도 안 돌았으므로, 다음 관측은 v3 계약 + v3 생성기 + 평가 없음이라는
  세 변경이 겹친 상태다.** 개별 기여도 판정 불가를 관측 기록에 명시한다
- 되돌리기: 코드는 git, 데이터는 그대로 → 복구 가능

## Verification

- `npm test` · `npm run lint` · `npx tsc --noEmit` · `npm run admin:check` ·
  `node scripts/check-schema-sync.mjs`(스키마 무변경이므로 통과해야 정상)
- 삭제 후 잔여 참조 0 확인: `grep -rn "evaluation\|Evaluator" src packages/admin/src`
- 신규 테스트 1건(Test Value Gate): **전송본이 잡에 기록되는가** — 회귀 시 실제
  나간 프롬프트를 다시 못 보게 되고, 연구 로그의 1차 증거가 또 틀려진다
- 수동 확인: 개발서버에서 컷 1장 생성 → `generation_jobs.prompt`에 `Do not
  include:` 꼬리가 포함되는지

## 미포함

- 1번(색감 소유자 = `stylePrompt` 분해)과 프레임 소유자 결정 — 별건
- ②의 반복 채널(초안 premise 입력, premise 백필) — 별건
- 평가 대체물 신설. 지금은 **운영자 판정이 유일한 검증**이 된다
