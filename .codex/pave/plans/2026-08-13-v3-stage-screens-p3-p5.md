# PAVE Plan: V3 단계 화면 나머지 (P3+P4+P5)

- 작성: 2026-08-13
- 대상 브랜치: `fix/v3-structured-output-schema`
- 승인 범위: **P3 + P4 + P5** (user: "나머지도 전부 진행해")
- 설계 정본: [docs/pipeline-v3-ux-plan.md](../../../docs/pipeline-v3-ux-plan.md) §3
- 선행: [P0+P1+P2 리포트](../reports/2026-08-13-v3-stage-screen-visibility.md)

## 0. 목표와 완료 조건

②③④는 앞 사이클에서 열었다. 이번에는 **나머지 다섯 단계(①⑤⑥⑦⑧)**를 각
데이터 성격에 맞게 열고, 8단계를 가로지르는 상태 어휘를 하나로 맞춘다.

완료 조건:

1. ①에서 Agent가 실제로 본 입력(페르소나·메모리·최근 게시물)을 볼 수 있다.
2. ⑤에서 컷별 실행 상태·시도·소요를, ⑥에서 V3 생성 이미지 평가를 볼 수 있다.
3. ⑦에서 게시 **전에도** 실제 게시될 모습을 미리 볼 수 있다.
4. ⑧에서 메모리 후보별 판정(선택/제외/무효/저장됨)을 볼 수 있다.
5. 어느 화면에서든 파이프라인 버전을 알 수 있고, 레일과 단계 본문이 같은
   상태 어휘를 쓴다.
6. `npm run admin:check`, `npm run test`, `npm run lint`, `npm run format` 통과.

## 1. 근거 (코드 실측)

| 저장돼 있는 것 | 위치 | 현재 화면 |
|---|---|---|
| 페르소나 블록 4그룹, 메모리 N건, 최근 게시물 N건 | `postPlanning.input` (`postPlannerInput()`) | 없음 |
| 메모리 후보 `{key,type,content,selected,sourcePostPlanHash}` | `concept.memoryCandidates` (runner:178) | 없음 — ⑧은 캡션만 에코 |
| V3 생성 이미지 평가 `shots[].dimensions{applicable,score}` + `setDimensions` | `scoresJson.result` (`completeV3`) | 없음 — `EvaluationChips`가 V2 후보 구조만 읽는다 |
| 컷별 `attemptCount`, `updatedAt` | `generation_jobs` | DTO에 없음 |
| 게시 전 선택 이미지·캡션·해시태그 | `draft.shots[].outputs[].selected` | ⑦은 "승인 후 게시할 수 있습니다"만 |

## 2. 확정된 결정

| # | 결정 | 근거 |
|---|---|---|
| D1 | V3 이미지 평가는 **컷 단위로만** 표시한다. 후보 카드에는 붙이지 않는다 | V3 evaluator는 컷마다 **선택된 한 장**을 평가한다(`selectedImages`). 후보마다 같은 점수를 반복하면 후보별 품질 차이로 오독된다. V2 후보 평가는 그대로 둔다 |
| D2 | V3에는 `hardFailures` 배열이 없으므로 `issues[].severity`의 `major`/`critical`을 같은 자리에 배지로 쓴다 | 하드 실패는 V2 어휘다. 심각도를 버리면 "지적 있음"과 "치명적 결함"이 같아 보인다 |
| D3 | `applicable: false` 차원은 렌더하지 않는다 | 계약이 없어 평가 대상이 아닌 것과 낮은 점수를 받은 것은 다르다 |
| D4 | 메모리 후보 판정은 read model이 `selected`/`stale`만 내리고, "저장됨"은 화면이 draft 상태와 합쳐 만든다 | `selectedPublishedMemories()`가 게시 시점에 같은 두 조건으로 거른다. 판정 규칙을 서버 한 곳에만 두면 화면이 게시 결과와 어긋난다 |
| D5 | 실패한 컷의 재생성 버튼을 새로 열지 않는다 | 백엔드가 `needs_review`/`failed` draft만 허용한다(`drafts.service.ts:746`). UI만 열면 400이 난다. 대신 **왜 지금 못 하는지**를 카드에 쓴다 |
| D6 | ⑤⑥⑦은 V2와 공유하는 화면이므로 변경은 **가산만** 한다 | 개발 서버에 V2 초안 31건이 살아 있다. V3 데이터가 있을 때만 새 블록이 뜬다 |
| D7 | 스키마 변경 없음. DTO에 `attemptCount`/`updatedAt` 두 필드만 추가 | 나머지 값은 전부 이미 저장·조회된다 |

## 3. 체크리스트

### P3 — ① 브리프 · ⑧ 메모리

- [x] P3-1 read model: `postPlan.planningInput`
      (persona[{group,title,content}], memories, recentPosts)
- [x] P3-2 read model: 최상위 `memoryCandidates[{type,content,selected,stale}]`
      — `stale = sourcePostPlanHash !== postPlanning.hash`
- [x] P3-3 ① 브리프: 파이프라인 버전 배지, 접이식 "Agent가 본 입력",
      V3에서 다음 단계 링크를 `post_plan`으로
- [x] P3-4 ⑧ 메모리: V3 후보별 판정 목록(저장됨/선택됨/제외됨/무효)

### P4 — ⑤ 생성 · ⑥ 검수 · ⑦ 게시

- [x] P4-1 `EvaluationChips` V3 이미지 평가 지원 (컷 차원 + set 차원 + 심각도)
- [x] P4-2 backend: `DraftShot`에 `attemptCount`, `updatedAt` 노출
- [x] P4-3 ⑤: 상태 칩, 진행 요약(완료 n/N), 컷별 시도·소요, 실패 컷 설명
- [x] P4-4 ⑥: 컷 카드에 V3 이미지 평가, 기획 대비 대조(scene/captureSetup) 접이식
- [x] P4-5 ⑦: 게시 전 미리보기(선택 이미지 + 캡션 + 해시태그), 게시 후 post id·시각

### P5 — 버전 발견성·구조 정리

- [x] P5-1 헤더에 파이프라인 버전 배지 (`Agent V3` / `V2 legacy`)
- [x] P5-2 레일 상태 어휘를 단계 배지와 통일 (실행 전/실행 중/완료/일시정지/실패)
- [x] P5-3 파이프라인 stage ↔ 레일 stage 매핑을 한 테이블로 단일화

### 테스트 (Test Value Gate 통과분만)

- [x] T1 `EvaluationChips` — V3 이미지 평가에서 컷 차원 점수와 판정이 렌더되고,
      `applicable:false` 차원은 빠진다. **잡는 결함**: 저장 모양을 못 읽어 검수
      화면에서 이미지 평가가 통째로 사라지는 것(2026-08-13 기획 평가에서 실제 발생)
- [x] T2 ⑧ 메모리 — `stale` 후보가 "저장됨"으로 표시되지 않는다.
      **잡는 결함**: 실제로 저장되지 않은 기억을 저장됐다고 오인시켜, 운영자가
      세계관에 없는 사실을 있다고 믿고 다음 기획을 판단하는 것
- [x] T3 read model — `planningInput`과 `memoryCandidates` 매핑.
      **잡는 결함**: 필드명 어긋남으로 입력 스냅숏이 조용히 빈 값이 되는 것

테스트하지 않는 것: 배치·문구·색상, 레일 스크롤. 동작이 아니라 표현이다.

## 4. 검증

| 대상 | 명령 |
|---|---|
| Admin UI | `npm run admin:check` |
| read model·DTO | `npm run test` |
| 정적 검사 | `npm run lint`, `npm run format` |
| 번들 | `npm run admin:build` |

## 5. 범위 밖

- 산출물 편집·stale 재실행 UX — architecture §12 rollout gate
- `CharacterMemory` ↔ draft FK — 계보 표시가 안정된 뒤 별도 결정 (설계 §3 ⑧)
- 실패 컷 재생성 허용 범위 확대 — 백엔드 계약 변경 (D5)
- V2 화면 개선 — legacy 동결
