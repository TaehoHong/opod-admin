# PAVE Report: V3 단계 화면 나머지 (P3+P4+P5)

- 완료: 2026-08-13
- 브랜치: `fix/v3-structured-output-schema`
- 플랜: [2026-08-13-v3-stage-screens-p3-p5.md](../plans/2026-08-13-v3-stage-screens-p3-p5.md)
- 승인 범위: P3 + P4 + P5 (user: "나머지도 전부 진행해")

## 결과

승인 범위 전부 구현. 스키마 변경 없음. DTO에 `attemptCount`/`updatedAt` 두 필드만
추가했고 나머지는 이미 저장·조회되던 값의 매핑과 렌더링이다.

### P3 — ① 브리프 · ⑧ 메모리

- `postPlan.planningInput` — Context Assembler가 조립해 Agent에게 실제로 넘긴
  입력(`postPlanning.input`)을 read model이 내린다. 페르소나는 그룹
  (characterContext/contentStyle/voice/boundaries/additionalContext)을 유지한 채
  평탄화하고, 내용이 빈 블록은 뺀다.
- ① 브리프에 접이식 "Agent가 본 입력" — 블록 N개·메모리 N건·최근 게시물 N건
  요약과 펼침 전문. 기획이 이상할 때 프롬프트를 의심하기 전에 확인할 경로다.
- 최상위 `memoryCandidates[{type, content, selected, stale}]` —
  `stale = sourcePostPlanHash !== postPlanning.hash`.
- ⑧ 메모리가 후보별 판정을 보여준다: 저장됨 / 선택됨 / 제외됨 / 무효.
  후보가 0건이면 "새 기억을 남기지 않습니다"라고 명시한다.

### P4 — ⑤ 생성 · ⑥ 검수 · ⑦ 게시

- `EvaluationChips`가 V3 생성 이미지 평가를 읽는다. 컷 단위는
  `result.shots[].dimensions`, 세트 단위는 `result.setDimensions`,
  둘 다 `{applicable, score}` 형태다.
- ⑤에 진행 요약(완료 n/N · 생성 중 · 실패)과 컷별 `시도 N · N초`.
  실패 컷은 재생성이 왜 지금 불가능한지 카드 안에서 설명한다.
- ⑥ 컷 카드에 접이식 "기획 원문 보기"(역할·기획 장면·기획 촬영·인물 노출) —
  검수자가 화면을 떠나지 않고 픽셀과 계약을 대조한다.
- ⑦에 게시 **전** 미리보기(선택된 컷 + 캡션 + 해시태그), 게시 후에는 실제 post의
  본문·미디어에 더해 게시 시각·post id·예약 여부를 영수증으로 붙였다.
- ⑤⑥⑦에 V3 단계 상태 칩을 붙여 ②③④와 같은 어휘를 쓴다.

### P5 — 버전 발견성·구조 정리

- 헤더와 ① 브리프에 `Agent V3` / `V2 legacy` 배지. "이미지 기획 단계가 없다"는
  최초 오해의 직접 원인이었다.
- 레일이 단계 배지와 같은 5개 어휘를 쓴다(실행 전/실행 중/완료/일시정지/실패).
  "현재 화면"은 테두리와 `aria-current`가 이미 말하므로 상태 자리를 비우지 않는다.
- 레일 단계 id와 파이프라인 stage 어휘(`prompt` ↔ `image_prompt`)를 한 테이블에
  나란히 뒀다. `v3StageState()`가 갖고 있던 별도 순서 배열을 없앴다.

## 설계 판단

| # | 판단 | 근거 |
|---|---|---|
| D1 | V3 이미지 평가는 컷 단위로만 표시하고 후보 카드에는 붙이지 않는다 | V3 evaluator는 컷마다 **선택된 한 장**을 평가한다(`selectedImages`). 후보마다 같은 점수를 반복하면 후보 간 품질 차이로 오독된다. V2 후보 평가는 그대로 둔다 |
| D2 | V3에는 `hardFailures`가 없으므로 `issues[].severity`의 major/critical을 "중대 지적" 배지로 쓴다 | 심각도를 버리면 "지적 있음"과 "치명적 결함"이 같아 보인다 |
| D3 | `applicable: false` 차원은 렌더하지 않는다 | 계약이 없어 평가 대상이 아닌 것과 낮은 점수를 받은 것은 다르다 |
| D4 | 후보 판정 규칙은 read model이 `selected`/`stale`만 내리고 "저장됨"은 화면이 draft 상태와 합쳐 만든다 | 게시 로직(`selectedPublishedMemories`)과 같은 두 조건을 서버 한 곳에 둔다 |
| D5 | 실패 컷의 재생성 버튼을 새로 열지 않았다 | 백엔드가 `needs_review`/`failed` draft만 허용한다(`drafts.service.ts`). UI만 열면 400이 난다. 대신 왜 지금 못 하는지를 카드에 썼다 |
| D6 | ⑤⑥⑦ 변경은 가산만 | V2 초안 31건이 개발 서버에 살아 있다. V3 데이터가 있을 때만 새 블록이 뜬다 |
| D7 | 종료되지 않은 잡에는 `settledAt`을 내리지 않는다 | 진행 중인 잡의 `updatedAt`은 "지금까지"일 뿐이라 소요 시간으로 읽으면 안 된다 |

## 부수 수정

`<Badge>`(div)를 `<Text>`(p) 안에 넣던 자리 4곳을 `<Group>`으로 바꿨다. 테스트가
"`<div>` cannot be a descendant of `<p>`" 경고로 잡아낸 잘못된 HTML 중첩이고,
③ 이미지 기획의 차단 사유와 ④ 프롬프트의 슬롯 바인딩은 이번 사이클 전부터
있던 것이다.

## 검증

| 명령 | 결과 |
|---|---|
| `npm run test` | 50 스위트 / 405 테스트 통과 |
| `npm run admin:check` | 17 파일 / 55 테스트 통과 |
| `npm run lint` | 통과 |
| `npm run format` | 통과 |
| `npm run admin:build` | 통과 |

신규 테스트 6건 (Test Value Gate 통과분):

- `EvaluationChips.test.tsx` 3건 — V3 컷 차원 렌더와 `applicable:false` 제외,
  세트 차원·판정 렌더, 후보 카드에는 붙지 않음
- `PostWorkPage.test.tsx` 2건 — 후보 판정 4종, 입력 스냅숏 요약과 전문
- `post-workspace.service.spec.ts` 2건 — `planningInput` 매핑(빈 블록 제외),
  이전 PostPlan에서 온 후보의 `stale` 판정

테스트하지 않은 것: 배치·문구·색상, 레일 스크롤. 동작이 아니라 표현이다.

## 잔여 위험

- 로컬 dev 서버 육안 확인은 하지 않았다(사용자가 서버 기동을 거절). 자동 검증과
  배포 후 번들 확인으로 대체했다.
- V3 초안이 아직 ⑤ 이후로 간 적이 없어 생성 이미지 평가 표시는 실데이터로
  확인되지 않았다. 저장 모양은 `v3-evaluators.ts` 스키마와 `completeV3` 기준으로
  맞췄고 테스트로 고정했다.

## 다음

`docs/pipeline-v3-ux-plan.md` §4의 P0~P5가 모두 끝났다. 남은 것은 §7의 유보
항목 — 산출물 편집·stale 재실행 UX(architecture §12 rollout gate),
`CharacterMemory` ↔ draft FK, evaluator 점수 기반 자동 재작성.
