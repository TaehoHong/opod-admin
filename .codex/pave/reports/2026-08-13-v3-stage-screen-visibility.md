# PAVE Report: V3 단계 화면 가시성 (P0+P1+P2)

- 완료: 2026-08-13
- 브랜치: `fix/v3-structured-output-schema`
- 플랜: [2026-08-13-v3-stage-screen-visibility.md](../plans/2026-08-13-v3-stage-screen-visibility.md)
- 승인 범위: P0 + P1 + P2 (user-confirmed)

## 결과

승인 범위 전부 구현. 스키마 변경 없음. 필요한 값은 모두 이미 저장돼 있었고
read model 매핑과 렌더링만 늘렸다.

### P0 — 표시 버그

- `EvaluationChips`가 V3(`scoresJson.result.scores`, 숫자값)와
  V2(`scoresJson.scores`, `{score, reason}`)를 모두 읽는다.
- V3 차원 사유는 `result.issues[]`에서 dimension으로 매칭해 칩 펼침에 표시한다.
- 텍스트 평가의 `result.verdict`를 판정 배지로 표시한다(`pass`/`issues_found`/
  `valid_conflict`/`valid_block` 등 kind별 어휘).
- 차원 점수가 없어도 총점·판정 배지가 살아남도록 조기 반환 조건을 고쳤다.
  기존에는 이 조기 반환이 정상 계산된 `overallScore`까지 삼켰다.
- V3 차원 한국어 라벨 34개를 추가했다(게시글 11+3, 이미지기획 11+3, 프롬프트 8).
- `BriefStage`가 `operatorRequest`(V3)와 `sceneHint`(V2)를 모두 읽는다.

### P1 — 8단계 공통 규칙

- 단계 헤더 상태 칩 5종(실행 전/실행 중/완료/일시정지/실패)을
  `v3StageState()`로 유도한다. 현재 stage와 전체 순서를 비교하므로 지나간
  단계는 완료로, 앞선 단계는 실행 전으로 표시된다.
- `state === "running"`이면 스피너 + "○○ Agent 실행 중…".
- 산출물 계보 푸터(revision · status · contractVersion · hash 앞 15자).
- 평가 블록 4상태 — 완료 / 대기(스피너) / 실패(사유) / 결과 없음(설정 링크).
  기존에는 평가 행이 없으면 `null`을 반환해 세 상황을 구분할 수 없었다.
- 완료된 단계도 "다시 실행"으로 재실행할 수 있다. 이전에는
  `state === "pending"`일 때만 버튼이 떠 최초 1회만 실행 가능했다.

### P2 — 산출물 노출

- `v3ReadModel()` 확장: PostPlan(caption, hashtags, captionLanguages,
  purposes, memoryCandidates, conflicts), ImagePlan(locationId, shots[],
  lockedElements, blockedReasons), PromptSet(shots[].prompt/negativePrompt,
  슬롯 바인딩), 전 산출물 계보(hash/contractVersion).
- ② 게시글 기획 — 캡션 본문(`white-space: pre-wrap`), 해시태그 배지, 전제·목적·
  언어 메타, 메모리 후보 목록(빈 배열이면 "없음"), 충돌 알림.
- ③ 이미지 기획 — 컷 카드(scene/captureSetup 분리 표시), 인물 노출 배지,
  레퍼런스 바인딩 칩(보존·복제금지 펼침), 연속성 잠금을 컷 카드 밖 별도 영역에,
  imageCount에 "오케스트레이터가 정한 값" 명시, blocked 사유 카드.
- ④ 프롬프트 — 컷별 전문, 네거티브 별도 블록(미사용이면 그 사실을 표시),
  슬롯 바인딩 목록, 모델·정책 버전.

## 설계 판단

| # | 판단 | 근거 |
|---|---|---|
| D1 | 계보 푸터에 실행 시각을 넣지 않았다 | artifact 키는 `hash/input/output/revision/producerLogId/promptVersion/contractVersion`뿐이고 타임스탬프가 없다. draft `updatedAt`은 마지막 변경 시각이라 단계 실행 시각으로 오독된다. 대신 평가 블록에 실제 `createdAt`→`completedAt` 소요 시간을 넣었다 |
| D2 | V3 이미지 평가(kind `image`)는 제외 | `shots[].dimensions{applicable,score}` + `setDimensions`로 구조가 또 다르다. ⑤⑥ 단계 작업으로 분리 |
| D3 | 재실행은 현재 단계와 완료된 단계만 | 앞선 단계 실행은 오케스트레이터가 순서를 소유한다 |
| D4 | 연속성 잠금을 컷 카드 밖에 | 컷 안에 넣으면 "컷을 가로지르는 제약"이라는 성격이 사라진다 |

## 검증

| 명령 | 결과 |
|---|---|
| `npm run admin:check` | 17 파일 / 50 테스트 통과 (신규 8개 포함) |
| `npm run test` | 50 스위트 / 403 테스트 통과 |
| `npm run lint` | 통과 |
| `npm run format` | 통과 |
| `npm run admin:build` | 통과 |

신규 테스트 (Test Value Gate 통과분):

- `EvaluationChips.test.tsx` 5건 — V3 점수·판정·총점 렌더, V3 issue를 차원 사유로
  사용, V2 페이로드 유지, 차원이 비어도 총점 유지, 대기 상태 표시
- `PostWorkPage.test.tsx` 3건 — V3 `operatorRequest` 표시, V2 `sceneHint` 유지,
  기획 산출물(캡션·해시태그·"새 기억 없음"·완료 칩) 표시

관측: `npm run test` 첫 실행에서 2건 실패가 있었으나 이후 4회 연속 403/403
통과했다. 변경 없이 재현되지 않아 플레이키로 판단한다. 실패 스위트를 특정하지
못했으므로 다음 실행에서 재발하면 그때 추적한다.

## 잔여 위험

- 실제 화면 확인은 로컬 dev 서버 기준이며, 개발 서버 배포 후 실제 V3 초안으로
  ③④ 단계를 재확인해야 한다(이 draft는 아직 image_plan 단계라 ④ 산출물이 없다).
- ⑤⑥⑦⑧ 단계는 이번 범위 밖이라 기존 화면 그대로다.

## 다음

P3(브리프 입력 스냅숏, 메모리 계보) → P4(⑤⑥⑦) → P5(버전 배지, 단계 배열
단일화). 설계는 [docs/pipeline-v3-ux-plan.md](../../../docs/pipeline-v3-ux-plan.md).
