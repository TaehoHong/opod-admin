# 게시물 생성 Agent — 개선 기록 색인

- 작성: 2026-08-14
- 목적: 나중에 쓸 문서·연구의 **뼈대**다. 여기서 1차 증거로 내려간다.
  결론을 여기 쓰지 않는다 — 어디에 무엇이 있고, 무엇이 무엇을 유발했고,
  무엇이 아직 검증되지 않았는지만 적는다.
- 규칙: `CLAUDE.md`의 게시물 생성 Agent 문서화 규칙을 따른다.

## 1. 문서 지도

각 문서가 무엇을 **소유**하는지로 나눈다. 같은 사실을 두 곳에 쓰지 않는다.

| 문서 | 소유 | 범위 |
|---|---|---|
| [post-creation-agent-workflow.md](./post-creation-agent-workflow.md) | V2 워크플로우와 UML | V2 전용 — V3로 갱신하지 않았다. V2가 legacy로 동결됐으므로 **역사 기록**으로 읽는다 |
| [post-creation-agent-architecture-v3.md](./post-creation-agent-architecture-v3.md) | V3 설계 정본 | 버전 계보, 역할 분리, 계약, 상태 경계, 검증 아키텍처, 트레이드오프. §17 유보 항목, §18 V4 백로그 |
| [prompt-research-log.md](./prompt-research-log.md) | 프롬프트·루브릭 실험 | 가설 → 변경 → 결과 → 판정. 실패·롤백도 남긴다 |
| [plan-prompt-evaluation-agent.md](./plan-prompt-evaluation-agent.md) | 기획 평가 Agent 설계 | V2 기준 |
| [image-prompt-evaluation-agent.md](./image-prompt-evaluation-agent.md) | 프롬프트 평가 Agent 설계 | |
| [generated-image-evaluation-agent.md](./generated-image-evaluation-agent.md) | 생성 이미지 평가 Agent 설계 | |
| [image-prompt-optimization-report.md](./image-prompt-optimization-report.md) | 프롬프트 최적화 실측 보고 | |
| [media-generation-pipeline.md](./media-generation-pipeline.md) | 미디어 생성 파이프라인 | |
| [media-generation-quality-improvements.md](./media-generation-quality-improvements.md) | 품질 개선 누적 기록 | 912줄, 가장 두꺼운 1차 자료 |
| [pipeline-v3-ux-plan.md](./pipeline-v3-ux-plan.md) | V3 운영 화면 설계 | 8단계 데이터 성격별 표현 |
| [api/admin-drafts.md](./api/admin-drafts.md) | draft API 계약 | 운영자 요청 수정 포함 |

**작업 단위 기록**은 `.codex/pave/plans/`와 `.codex/pave/reports/`에 있다.
플랜은 착수 시점의 판단, 리포트는 완료 시점의 실측과 정정을 담는다. 둘이
다르면 **정정 자체가 자료다** — 리포트에 왜 바뀌었는지 남긴다.

## 2. 개선 연대기 — 관측 → 변경 → 결과

이 표가 이 문서의 핵심이다. 각 줄은 인과 사슬 하나다.

| # | 관측 | 변경 | 결과 | 1차 증거 |
|---|---|---|---|---|
| 1 | V2의 ContentPlanner가 글·장면·촬영·레퍼런스를 한 자연어 입력에 섞어 결정한다 | 역할별 Agent 분리 (V3) — 생성 3 + 검증 4 + 결정적 오케스트레이터 | 구현 완료, 설정 게이트로 신규 초안만 적용 | architecture-v3 §4~§12, `902b459` |
| 2 | V3를 켜니 게시글 기획이 전부 400 — `'oneOf' is not permitted` | 판별 union을 루트 object 한 겹으로 감싸고 `const`→`enum`, `uniqueItems` 제거 | 세 스키마 전부 SCHEMA ACCEPTED | research-log `v3-schema-v2`, `8f13aeb` |
| 3 | (2를 조사하다 발견) capability probe가 `{ok:true}` 하나로 "지원 확인"을 반환해 **가짜 초록불**을 냈다 | probe를 실제 스키마 문법으로 교체 + 배포된 스키마를 네트워크 전에 정적 검사 | 회귀 테스트로 고정 | research-log `v3-schema-v2` 부수 발견, `src/worker/strict-schema.spec.ts` |
| 4 | "이미지 기획 단계가 없다" | 진단: 기능 누락이 아니라 **버전 발견성** 문제 (V3 게이트 off, 초안 31건 전부 V2, 화면에 버전 표시 없음) | 파이프라인 버전 배지 (P5) | pipeline-v3-ux-plan §1 |
| 5 | 평가가 만점인데 화면엔 `{"issues": [], "suggestions": null}`만 | 표시 버그 2건 — `EvaluationChips`가 V2 모양만 읽고, 조기 반환이 총점까지 삼켰다 | P0 수정 | ux-plan §2, report `v3-stage-screen-visibility` |
| 6 | 단계 상태·산출물이 화면에 없어 실행 여부를 눈으로 확인 못 한다 | 8단계 횡단 규칙(상태 칩·계보 푸터·평가 4상태·재실행) + 단계별 산출물 노출 | P1~P5 완료 | ux-plan §3, reports `v3-stage-screen-visibility`, `v3-stage-screens-p3-p5` |
| 7 | 평가 "원문 보기"가 빈 껍데기 | V3는 `suggestionsJson`이 항상 null이고 지적 0건이면 `issuesJson`도 `[]`. 실제 산출물은 `scoresJson`에 있다 | 원문을 `scoresJson`으로 교체 | `6c6eae4` |
| 8 | ImagePlan이 "전면 카메라로 미러 셀피" — 기하학적으로 불가능 | `image-planner-v2` — 촬영 기하 원칙 + 거울 사례, 종횡비를 범위 밖으로 명시 | **부분 성공.** 거울 결함은 사라졌고 같은 차원에서 새 유형(카메라를 올려둔 물체가 배경에 보인다)이 났다 | research-log `image-planner-v2`, `c8c9c73` |
| 9 | 평가가 정확한 진단을 내놔도 재실행에 반영할 방법이 없다 (러너가 평가를 읽지 않고 Agent 입력 계약에 자리가 없다) | 운영자 요청 수정 API + 브리프 편집 폼 | 사람을 통한 우회로 확보. 자동 되먹임은 여전히 §17 유보 | plan/report `operator-request-edit`, `52620fb` |
| 10 | 캡션 "자세가 정리된 느낌" — 한국어 연어가 아니다 | (미적용) 캡션 Agent를 파이프라인 끝으로 분리하는 설계를 V4 백로그에 기록 | 관측만 | architecture-v3 §18 |

## 3. 되풀이된 실패 유형

개별 사건보다 이 분류가 나중 글의 뼈대로 쓸 만하다.

### 3.1 가짜 초록불

측정 도구가 자기 대상보다 약해서 통과를 반환한 사례가 둘이다.

- capability probe가 사소한 스키마만 확인해 실제 배포 스키마의 400을 못 봤다 (#3)
- 평가 Agent가 한국어 연어 부자연스러움에 만점을 줬다 (#10, §18.8)

**공통 구조**: 검증자에게 "이게 괜찮은가?"를 묻고 답을 믿었다. 검증자가 그
판단을 실제로 수행할 능력이 있는지는 확인하지 않았다.

이 때문에 §18.7에 다음 판단을 남겼다 — 평가 프롬프트에 "자연스러운지 보라"를
추가하는 접근은 같은 실패를 재생산할 가능성이 크다.

### 3.2 저장돼 있는데 화면이 못 읽는다

#5, #7이 같은 유형이다. 데이터는 전부 도착해 있는데 화면이 다른 세대의 모양을
읽는다. 미구현으로 오인하기 쉽고, 실제로 "기능이 없다"는 요청으로 들어왔다.

**징후**: 빈 배열·null·"없음"이 화면에 뜨는데 DB에는 값이 있다.

### 3.3 사례는 고쳐지고 원칙은 일반화되지 않는다

#8이 유일한 관측이지만 방법론적으로 중요하다. 프롬프트에 원칙 한 문장과 재발
사례 한 문장을 함께 넣었더니 **사례만 지켜졌다**. 사례를 계속 추가하면 프롬프트가
결함 목록으로 자라고, 목록에 없는 결함은 계속 난다.

### 3.4 진단은 정확한데 처방 경로가 없다

#9. 평가자는 설계상 진단 전용(`Diagnose only`)이고 러너는 평가를 읽지 않는다.
정확한 지적이 나와도 파이프라인에 되먹일 방법이 없어 프롬프트를 전역으로 바꾸고
주사위를 다시 굴리는 것 외에 할 게 없었다.

## 4. 측정 방법 노트

나중에 글에서 "어떻게 측정했나"를 쓸 때 필요한 것들이다.

- **측정 대상과 측정 도구를 동시에 바꾸지 않는다.** #8을 관측하는 동안 이미지
  기획 평가자를 건드리지 않았다. 둘을 함께 바꾸면 점수 변화의 원인을 가릴 수 없다.
  게시글 평가자는 다른 Agent를 재는 다른 도구이므로 이 제약에 걸리지 않는다.
- **총점은 약한 신호다.** #8에서 major 하나가 11차원 평균을 5.0 → 4.818로 깎았다.
  "거의 만점"으로 읽힌다. 판정(`verdict`)과 최저 차원을 봐야 한다.
- **표본 1건으로 판정하지 않는다.** LLM이 비결정적이라 규칙 없이도 우연히 맞는다.
  research-log의 판정에는 표본 수를 명시한다.
- **1차 증거는 DB에 있다.** artifact의 `promptVersion`으로 어느 프롬프트가 실제로
  쓰였는지, `_meta.targetHash`로 평가가 어느 리비전을 봤는지 확인한다.

## 5. 아직 검증되지 않은 것

정직성 섹션이다. 글을 쓸 때 여기 있는 것을 성과로 적으면 안 된다.

| 항목 | 상태 |
|---|---|
| V3 생성 이미지 평가 표시 | **실데이터로 한 번도 검증되지 않았다.** `kind='image'` 평가 행이 0건이다 — 게이트가 "컷마다 선택된 이미지 1장"을 요구하는데 아직 아무 초안도 검수 선택까지 가지 않았다 |
| `image-planner-v2` 효과 | 관측 1건. 부분 성공 판정 |
| 캡션 자연스러움 개선 | 관측만 있고 변경 없음 (V4 백로그) |
| 평가자 사각지대 3건 | 기록만 (architecture-v3 §18.8). 보정 미적용 |
| V3 파이프라인 완주 | 아직 ⑤ 이미지 생성 이후로 간 초안이 없다 |

## 6. 재현 경로

```
1차 증거 위치
├─ 코드      prompts/ (프롬프트), src/worker/ (Agent·러너·평가)
├─ 계약      docs/api/admin-drafts.md
├─ 실행 기록  DB: post_drafts.concept_json (artifact + promptVersion + hash)
│                draft_evaluations.scores_json (_meta.targetHash + result)
│                generation_jobs.prompt / params_json._shot / _v3
└─ 작업 이력  .codex/pave/plans|reports/, git log -- prompts/ src/worker/
```
