# PAVE Plan: V3 단계 화면 가시성 (P0+P1+P2)

- 작성: 2026-08-13
- 대상 브랜치: `fix/v3-structured-output-schema`
- 승인 범위: **P0 + P1 + P2** (user-confirmed, 2026-08-13)
- 설계 정본: [docs/pipeline-v3-ux-plan.md](../../../docs/pipeline-v3-ux-plan.md)

## 0. 목표와 완료 조건

운영자가 V3 단계 화면만 보고 **각 단계가 실행됐는지, 무엇을 만들었는지, 평가가
어떻게 나왔는지**를 판단할 수 있게 한다. 스키마는 바꾸지 않는다 — 필요한 값은
모두 `conceptJson`과 `draft_evaluations`에 이미 저장돼 있다.

완료 조건:

1. 평가가 완료되면 차원 점수·총점·판정이 화면에 보인다 (V3·V2 모두).
2. 브리프에서 입력한 장면 요청이 V3 초안에서도 보인다.
3. 모든 V3 단계에서 실행 전/실행 중/완료/실패를 상태 칩으로 구분한다.
4. 완료된 단계도 재실행할 수 있다.
5. ②③④ 단계에서 산출물 본문(캡션·컷·프롬프트)을 읽을 수 있다.
6. `npm run admin:check`, `npm run test`, `npm run format` 통과.

## 1. 근거 (실측, draft `019ff878…`)

| 저장된 것 | 현재 화면 |
|---|---|
| 캡션 전문, 해시태그 4개, 목적, 언어, 메모리 후보 | 전제 한 줄만 |
| 평가 11차원 전부 5점, 총점 5.0, 판정 `pass`, 3초 | `{"issues": [], "suggestions": null}` |
| `operatorRequest` (V3 필드) | 항상 "지정 없음" (V2 `sceneHint`를 읽음) |

## 2. 확정된 결정

| # | 결정 | 근거 |
|---|---|---|
| D1 | `EvaluationChips`는 V3·V2 두 페이로드를 모두 읽는다 | 개발 서버에 V2 초안 31건과 실제 V2 평가가 살아 있다 |
| D2 | V3 차원 사유는 `result.issues[]`에서 dimension으로 매칭한다 | V3에는 차원별 `reason` 필드가 없다 |
| D3 | V3 이미지 평가(kind `image`)는 이번 범위에서 제외 | `shots[].dimensions{applicable,score}` + `setDimensions`로 구조가 다르다. ⑤⑥ 단계 작업으로 분리 |
| D4 | 계보 푸터에 **실행 시각을 넣지 않는다** | artifact 키는 `hash/input/output/revision/producerLogId/promptVersion/contractVersion`뿐이고 타임스탬프가 없다. draft `updatedAt`은 마지막 변경 시각이라 단계 실행 시각으로 오독된다. 평가 블록은 실제 `createdAt`/`completedAt`이 있으므로 소요 시간을 표시한다 |
| D5 | 스키마 변경 없음 | 모든 값이 이미 저장돼 있다 |

## 3. 체크리스트

### P0 — 표시 버그

- [ ] P0-1 `EvaluationChips.scoreEntries()`가 V3(`scoresJson.result.scores`,
      숫자값)와 V2(`scoresJson.scores`, `{score,reason}`)를 모두 읽는다
- [ ] P0-2 V3 차원 사유를 `result.issues[]`에서 dimension으로 매칭해 칩 펼침에 표시
- [ ] P0-3 텍스트 평가(plan/image_plan/prompt)의 `result.verdict`를 배지로 표시
- [ ] P0-4 점수가 없어도 총점·판정 배지가 살아남도록 조기 반환 조건 수정
- [ ] P0-5 V3 차원 한국어 라벨 추가 (게시글 11+3, 이미지기획 11+3, 프롬프트 8)
- [ ] P0-6 `BriefStage`가 `operatorRequest`(V3)와 `sceneHint`(V2)를 모두 읽는다

### P1 — 8단계 공통 규칙

- [ ] P1-1 단계 헤더 상태 칩 (실행 전/실행 중/완료/일시정지/실패)
- [ ] P1-2 `state === "running"`일 때 스피너 + "○○ Agent 실행 중…"
- [ ] P1-3 산출물 계보 푸터 (revision · status · contractVersion · hash 앞 8자)
- [ ] P1-4 평가 블록 4상태 (완료 / 대기 / 실패+사유 / 워커 꺼짐+설정 링크)
- [ ] P1-5 완료 후에도 재실행 버튼 노출, 하단 좌측 실행 / 우측 다음 단계

### P2 — 산출물 노출

- [ ] P2-1 `v3ReadModel()` 확장 — PostPlan(caption, hashtags, captionLanguages,
      purposes, memoryCandidates), ImagePlan(locationId, shots[], continuity,
      blocked reasons), PromptSet(shots[].prompt/negativePrompt, bindings)
- [ ] P2-2 ② 게시글 기획 — 캡션 본문(줄바꿈 보존), 해시태그 배지, 목적·언어 메타,
      메모리 후보 목록(빈 배열이면 "새 기억 없음")
- [ ] P2-3 ③ 이미지 기획 — 컷 카드(scene/captureSetup 시각 분리), 인물 노출 배지,
      레퍼런스 바인딩 칩, 연속성 잠금 별도 영역, imageCount 출처 명시
- [ ] P2-4 ④ 프롬프트 — 컷별 전문(monospace), negativePrompt 별도, 슬롯 바인딩 표

### 테스트 (Test Value Gate 통과분만)

- [ ] T1 `EvaluationChips` — V3 페이로드에서 점수·총점·판정이 렌더되고, V2
      페이로드도 계속 렌더된다. **잡는 결함**: 저장 모양 변경이 평가 출력 전체를
      조용히 삼키는 것 (2026-08-13 실제 발생)
- [ ] T2 `BriefStage` — V3 `operatorRequest`와 V2 `sceneHint`가 모두 표시된다.
      **잡는 결함**: 필드명 회귀로 운영자 입력이 화면에서 사라지는 것

테스트하지 않는 것: 렌더링 배치·문구·색상. 동작이 아니라 표현이므로 수동 확인.

## 4. 검증

| 대상 | 명령 |
|---|---|
| Admin UI | `npm run admin:check` (tsc + vitest) |
| read model | `npm run test` |
| 포맷 | `npm run format` |

## 5. 범위 밖

- V3 이미지 평가 표시 (D3) — ⑤⑥ 단계 작업
- P3(브리프 입력 스냅숏·메모리 계보), P4(⑤⑥⑦), P5(버전 배지·구조 정리)
- 산출물 편집·stale UX — architecture §12 rollout gate
- V2 화면 개선 — legacy 동결
