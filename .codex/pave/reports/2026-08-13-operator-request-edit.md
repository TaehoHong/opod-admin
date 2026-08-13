# PAVE Report: 운영자 요청 수정 후 재실행

- 완료: 2026-08-13
- 브랜치: `feat/operator-request-edit`
- 플랜: [2026-08-13-operator-request-edit.md](../plans/2026-08-13-operator-request-edit.md)

## 결과

승인 범위 전부 구현. 스키마 변경 없음.

`PATCH /api/admin/v1/drafts/:id/operator-request`를 신설하고 ① 브리프에 편집
폼을 붙였다. 이제 운영자가 평가 지적을 읽고 요청을 보완한 뒤 해당 단계를 다시
실행할 수 있다.

## 왜 필요했나

평가 Agent가 정확한 진단을 내놔도 파이프라인에 되먹일 방법이 없었다.

- 러너가 평가를 읽지 않는다 (`post-pipeline-v3.runner.ts`의 `evaluation` 참조 0건)
- `PostPlannerInput`/`ImagePlannerInput`에 이전 지적·점수·이전 산출물 자리가 없다
- 평가자는 설계상 진단 전용 (`Diagnose only; never output replacements…`)

즉 재실행은 첫 실행과 **완전히 같은 입력**으로 돌고, 결과 차이는 LLM 비결정성뿐이다.
유일한 통로인 `operatorRequest`는 초안 생성 시점에만 쓸 수 있었다.

그런데 제품 문구는 이미 그 능력을 약속하고 있었다 — `needs_input` 상태의 다음
행동이 "운영자 요청을 보완한 뒤 다시 실행하세요"인데 보완할 방법이 없었다.

## 설계 판단

| # | 판단 | 근거 |
|---|---|---|
| D1 | `PATCH :id`에 얹지 않고 별도 엔드포인트 | `EDITABLE_STATUSES`는 `[needs_review, approved]`인데 운영자 요청은 그 **이전**에 고쳐야 의미가 있다. 상태 조건이 정반대다 |
| D2 | V3 초안만 허용 | V2 플래너는 `sceneHint`를 읽는다. 아무도 읽지 않는 값을 저장하고 성공을 보고하면 운영자가 반영됐다고 믿는다 |
| D3 | `planned`·`failed`만 허용 | 워커 claim이 `planned → generating`을 원자적으로 옮기므로 `status='planned'` 조건부 갱신이면 실행 중 단계와 구조적으로 충돌할 수 없다. 별도 락 불필요 |
| D4 | 저장이 재실행을 트리거하지 않는다 | 어느 단계를 다시 돌릴지는 단계 화면과 오케스트레이터의 책임이다 |
| D5 | 빈 값은 요청 삭제 | 런타임 `operatorRequest()`가 공백을 요청 없음으로 보는 것과 저장 모양을 맞춘다 |
| D6 | `markManual` 호출 | 화면이 이미 "내용을 수정하면 수동 진행으로 전환됩니다"라고 약속한다 |

### 구현 중 정정

계획은 정책 검사를 `DraftsRepository.updateV3OperatorRequest()`에 두려 했으나
service로 옮겼다. 두 가지 이유다 — repository에 두면 service spec이 자기 fake를
검증하게 되어 T1·T2가 무의미해지고, 기존 `finish` 처리가 이미 "service가 concept을
합치고 repository는 조건부 쓰기만" 형태다. 결과적으로 repository 신규 메서드는
없고 `updateEditableDraft()`를 재사용했다.

## 검증

| 명령 | 결과 |
|---|---|
| `npm run test` | 50 스위트 / 409 테스트 통과 |
| `npm run admin:check` | 17 파일 / 59 테스트 통과 |
| `npm run lint` | 통과 |
| `npm run format` | 통과 |

신규 테스트 8건:

- `drafts.service.spec.ts` 4건 — 실행 중 거부, 허용 상태 계약(`[planned, failed]`),
  V2 거부, 빈 값이 키를 지우고 다른 concept 키는 보존
- `PostWorkPage.test.tsx` 4건 — V2에는 폼 없음, V3 `planned`에서 폼과 현재 값,
  `generating`에서 잠김, 기존 legacy sceneHint 케이스를 V2 초안으로 정정

## 잔여 위험

- 실화면 확인은 하지 않았다. 저장 후 화면 갱신은 `useDraftMutation`의 기존 캐시
  경로를 그대로 타므로 다른 편집 폼과 동일하다.
- 이 기능은 **재실행이 개선된다고 보장하지 않는다.** 요청을 전달할 수 있게 됐을
  뿐이고, Agent가 그 요청을 얼마나 반영하는지는 별개다.

## 다음

평가 지적을 Agent 입력에 직접 넣는 것은 여전히 architecture §17 유보 항목이다.
이번 작업은 그 대안이 아니라 **사람을 통한 우회로**다.
