# PAVE Plan: 운영자 요청 수정 후 재실행

- 작성: 2026-08-13
- 분류: feature (작은 기능, 기존 계약 확장)
- 승인: user "지금 작업해" (백로그 대신 즉시 구현 선택)

## 0. 문제

평가 Agent가 정확한 진단을 내놔도 그것을 파이프라인에 되먹일 방법이 없다.

- 러너는 평가를 읽지 않는다 (`post-pipeline-v3.runner.ts`에 `evaluation` 참조 0건).
- Agent 입력 타입(`PostPlannerInput`, `ImagePlannerInput`)에 이전 지적·점수·이전
  산출물이 들어갈 자리가 없다. 재실행은 첫 실행과 **완전히 같은 입력**으로 돈다.
- 평가자는 설계상 진단 전용이다 — `Diagnose only; never output replacements,
  suggestions, retries…`.

운영자가 파이프라인에 의도를 전달할 통로는 `operatorRequest` 하나인데, 쓰기
경로가 초안 생성 시점(`drafts.service.ts:410`)뿐이라 **만든 뒤에는 고칠 수 없다**.

게다가 제품 문구가 이미 그 능력을 약속하고 있다. `needs_input` 상태의 다음 행동:

> 캐릭터 정보나 **운영자 요청을 보완한 뒤** 다시 실행하세요.

보완할 방법이 없다.

## 1. 완료 조건

1. V3 초안의 운영자 요청을 ① 브리프에서 수정할 수 있다.
2. 워커가 단계를 실행 중일 때는 수정되지 않는다.
3. 수정 후 각 단계의 재실행 버튼으로 새 요청이 반영된 산출물을 만들 수 있다.
4. `npm run test`, `npm run admin:check`, `npm run lint`, `npm run format` 통과.

## 2. 확정된 결정

| # | 결정 | 근거 |
|---|---|---|
| D1 | `PATCH :id`(updateDraft)에 얹지 않고 별도 엔드포인트를 만든다 | `EDITABLE_STATUSES = [needs_review, approved]`인데 운영자 요청은 정확히 그 **이전**(planned/failed)에 고쳐야 의미가 있다. 상태 조건이 정반대라 한 핸들러에 합치면 둘 중 하나가 틀린 가드를 갖게 된다 |
| D2 | V3 초안만 허용한다 | V2 플래너는 `sceneHint`를 읽는다. V2 draft에 `operatorRequest`를 써도 아무도 읽지 않는 조용한 no-op이 된다. 반영됐다고 믿게 만드는 저장은 안 하는 것보다 나쁘다 |
| D3 | `planned`·`failed`일 때만 허용한다 | 워커 claim이 `planned → generating`을 원자적으로 옮긴다(`claimV3Draft`). 따라서 `status='planned'` 조건부 갱신이면 실행 중 단계와 구조적으로 충돌할 수 없다. 별도 락이 필요 없다. `failed`를 포함하는 이유는 실패 후 요청 보완이 주 사용례이기 때문이다 |
| D4 | 저장만 하고 자동으로 재실행하지 않는다 | 재실행은 이미 각 단계 화면의 버튼이 소유한다. 저장에 실행을 묶으면 "어느 단계를 다시 돌릴지"를 브리프 화면이 결정하게 되는데 그건 오케스트레이터의 책임이다 |
| D5 | 빈 문자열은 요청 삭제로 처리한다 | "지정 없음"으로 되돌릴 수 있어야 한다. 런타임 `operatorRequest()`가 공백을 undefined로 보므로 의미가 일치한다 |
| D6 | `markManual`을 호출한다 | 기존 규칙과 같다. 화면이 이미 "내용을 수정하면 이 게시물만 수동 진행으로 전환됩니다"라고 약속한다 |

## 3. 체크리스트

- [x] B1 `UpdateOperatorRequestDto` 신설
- [x] B2 `PATCH /drafts/:id/operator-request` 컨트롤러
- [x] B3 `DraftsService.updateOperatorRequest()` — 길이 검증, 공백→null
- [x] B4 ~~`DraftsRepository.updateV3OperatorRequest()`~~ → **기존
      `updateEditableDraft()` 재사용.** 구현 중 정정: 정책(V3 여부, 허용 상태)을
      repository에 넣으면 service spec으로 검증할 수 없고, `finish` 처리가
      이미 "service가 concept을 합치고 repository는 조건부 쓰기만" 형태다.
      같은 형태를 따랐고 repository 신규 메서드는 없다
- [x] F1 admin api `updateOperatorRequest()`
- [x] F2 ① 브리프에 편집 폼 (V3·수정 가능 상태에서만)

### 테스트 (Test Value Gate 통과분만)

- [x] T1 실행 중(`generating`) 초안은 거부한다. **잡는 결함**: 워커가 옛 입력으로
      산출물을 만드는 중에 요청이 바뀌어, 저장된 요청과 실제 사용된 입력이
      어긋나는 것. 운영자가 "요청대로 안 나왔다"고 오판하게 된다
- [x] T2 V2 초안은 거부한다. **잡는 결함**: 아무도 읽지 않는 값을 저장하고 성공을
      보고해, 운영자가 반영됐다고 믿고 재실행하는 것
- [x] T3 V2 브리프에는 편집 폼이 뜨지 않는다. **잡는 결함**: 효과 없는 입력란 노출

테스트하지 않는 것: 폼 배치·문구. 표현이지 동작이 아니다.

## 4. 범위 밖

- 평가 지적을 Agent 입력에 넣는 것 — architecture §17 유보 항목
- 산출물 직접 편집 — §12 rollout gate
- V2 `sceneHint` 수정 — legacy 동결 (D2)
- 저장과 동시에 재실행 (D4)
