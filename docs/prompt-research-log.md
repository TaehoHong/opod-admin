# 프롬프트 연구 로그 — 게시물 생성 Agent

게시물 생성 Agent의 프롬프트(`prompts/`)와 평가 루브릭 변경을 실험 기록
방식으로 남긴다. 포트폴리오 정리의 원자료이므로 결과와 실사례를 구체적으로
적는다.

개선 과정 전체의 색인은
[post-creation-agent-research-index.md](./post-creation-agent-research-index.md)에 있다.
이 문서는 그중 **프롬프트·루브릭 실험**만 소유한다.

## 기록 규칙

- 프롬프트·루브릭 변경마다 버전을 올리고 아래 템플릿으로 엔트리를 추가한다.
- 버전 체계: 대상별 독립 버저닝 — `planner-vN`, `builder-vN`, `eval-rubric-vN`.
- 결과는 가능한 한 정량으로: 평가 차원별 점수 변화, 검수 거절률, 컷 재생성
  횟수, 캡션 수정률. 정량이 없으면 대표 실사례(draft ID + 발췌)를 남긴다.
- 실패한 실험도 기록한다 — 롤백한 변경과 그 이유가 포트폴리오에서 더 중요하다.

### 엔트리 템플릿

```markdown
## <대상>-v<N> — <한 줄 제목> (YYYY-MM-DD)

- 상태: 적용 중 | 롤백 | 관찰 중
- 가설: 어떤 문제를 어떤 변경으로 개선할 수 있다고 봤는지
- 변경: 추가/수정한 프롬프트 규칙 (핵심 문장 인용 또는 diff 요약)
- 결과: 평가 점수·휴먼 시그널 변화, 대표 사례 (before/after)
- 판정: 유지 / 부분 유지 / 롤백 — 근거
- 다음: 이 결과가 시사하는 후속 실험
```

---

## planner-v1 — 베이스라인 (2026-08-07 기준 현행)

- 상태: 적용 중
- 내용: `prompts/content-planner.ts` — 캐릭터 페르소나·메모리·최근 게시물·
  장소·비주얼 프로필을 입력으로 캡션·해시태그·컷 구성(기본 2컷, 최대 3컷)을
  JSON으로 생성. scene(프레임 안 픽셀)과 captureSetup(프레임 밖 촬영 과정)
  분리 규칙, 레퍼런스 ID 카탈로그 제한 포함.
- 알려진 한계 (품질 개선 문서 및 평가 Agent 설계에서 도출):
  - 캡션 말투가 캐릭터 개별 페르소나와 무관하게 균질해지는 경향
  - AI틱한 상투 문형(정형화된 감탄·마무리 멘트) 발생
  - 정량 측정 수단 부재 → 평가 Agent(eval-rubric-v1)로 계측 예정

## builder-v1 — 베이스라인 (2026-08-07 기준 현행)

- 상태: 적용 중
- 내용: `prompts/image-prompt-builder.ts` — 한국어 장면 설명을 모델 패밀리별
  (flux / nano-banana / stable-diffusion / generic) 작문 규칙에 맞춘 영어
  프롬프트로 변환. 전 컷 배치 1회 호출. 무인 컷의 인물 묘사 재삽입 금지.
- 알려진 한계: 물리적 정합성(카메라·손·거울) 위반이 프롬프트 단계에서
  검출되지 않음 → 평가 Agent의 prompt 평가로 계측 예정.

## eval-rubric-v1 — 평가 루브릭 초판 (2026-08-07)

- 상태: 적용 중 (2026-08-10 재구성, `plan-prompt-evaluation-agent.md` 참조)
- 구성: 기획 평가 8차원 (persona_fit, voice_tone_fit, ai_tell_free,
  memory_continuity, location_coherence, shot_composition, reference_usage,
  caption_quality) + 프롬프트 평가 6차원 (scene_capture_separation,
  physical_consistency, model_family_rules, plan_fidelity,
  reference_alignment, cross_shot_consistency).
- 설계 결정 기록:
  - voice_tone_fit은 페르소나 텍스트만으로 판정 불가 → 최근 게시 캡션을
    평가 입력에 포함해 비교하는 방식 채택
  - ai_tell_free는 AI 티 패턴을 **언어별 패턴 팩**(en, ko, …)으로 분리해
    루브릭 버전과 함께 관리 — 서비스가 글로벌·다국어 타겟임이 확정되며
    한국어 단일 패턴에서 설계 변경(2026-08-07). 영어 팩은 공개 연구 자산
    (Wikipedia AI Cleanup, 과대표현 어휘 목록) 기반, 타 언어는 자체 구축
  - 평가는 비동기 워커로 비차단 실행 (LLM 3연쇄 lease 부담 회피)
  - 프롬프트 평가는 2계층 설계 (`image-prompt-evaluation-agent.md`):
    결정적 결함은 정적 린트로 무비용 검출, LLM은 의미 수준 심사만 담당.
    전 컷 배치 1콜로 컷 간 일관성(cross_shot_consistency)까지 판정.
    정답 신호는 생성 결과(실패율·재생성·후보 선택률)와의 상관으로 계측 —
    차원별 예측력 검증이 루브릭 v2 보정의 근거가 된다.
- 다음: 실제 draft에 대한 점수 분포 확인 → 차원별 변별력 검증,
  휴먼 검수 결과와의 상관으로 루브릭 보정 (v2 후보)

## v3-schema-v2 — structured outputs 문법 호환 수정 (2026-08-13)

- 상태: 적용 중
- 대상: `prompts/post-planner.ts`, `prompts/image-planner.ts`,
  `src/worker/v3-evaluators.ts`의 JSON schema. 시스템 프롬프트 문장과
  계약 의미(`post-plan-v1`, `image-plan-v1`)는 바꾸지 않았다.
- 발단: 개발 서버에서 V3를 켜고 만든 초안의 게시글 기획이 전부 실패했다.
  ```
  structured agent failed (400): Invalid schema for response_format
  'opod_post_plan_v1': In context=(), 'oneOf' is not permitted.
  ```
- 원인: V3 스키마가 표준 JSON Schema로 작성됐지만 OpenAI 호환 structured
  outputs(strict)는 부분집합만 받는다. 2026-08-13 실제 프로바이더(gpt-5.6-terra,
  api.openai.com) 응답으로 확인한 위반 3종:

  | 위반 | 위치 | 프로바이더 응답 |
  |---|---|---|
  | 루트 `oneOf` | post-plan, image-plan | `'oneOf' is not permitted` |
  | `uniqueItems` | image-plan 5곳, evaluator 2곳 | `'uniqueItems' is not permitted` |
  | `type` 없는 `const` | post-plan·image-plan status, evaluator 4곳 | `schema must have a 'type' key` |

  같은 확인에서 **허용**되는 것도 함께 고정했다: 중첩 `anyOf`(널 허용 포함),
  `enum`, string `minLength`/`maxLength`, array `minItems`/`maxItems`,
  integer `minimum`/`maximum`. 루트 `anyOf`도 거부된다(루트는 object여야 함).
- 변경:
  1. 판별 union은 `prompts/strict-schema.ts`의 `rootUnionSchema()`로 루트
     object 한 겹(`result`)에 감싼다. 감싼 사실은 전송 계층
     (`strict-json-agent.ts`)이 응답에서 자동으로 벗기므로 Agent 파서와 저장
     artifact 모양은 그대로다. `isRootUnionSchema()`로 감싼 쪽과 벗기는 쪽이
     어긋날 수 없게 했다.
  2. `const` → `{ type: "string", enum: [값] }`.
  3. `uniqueItems` 제거. 중복 금지는 런타임 파서가 이미 강제한다
     (`stringArray`/`textArray`/`numberArray`의 Set 비교). 즉 계약이 약해진
     것이 아니라 검증 주체가 스키마에서 파서로 옮겨졌다. 대신 모델이 중복을
     내면 400이 아니라 파싱 실패로 나타난다 — 단계 실패 메시지에 `has
     duplicates`가 찍히면 이 경로다.
- 결과: 세 스키마(`opod_post_plan_v1`, `opod_image_plan_v1`,
  `opod_prompt_set_v1`)를 실제 엔드포인트에 직접 보내 전부 SCHEMA ACCEPTED
  확인. 단위 테스트 403개 통과.
- 부수 발견 (더 중요): **capability probe가 가짜 통과를 냈다.** 기존 probe는
  `{ok: true}` 하나짜리 스키마만 확인해서, 정작 배포된 V3 스키마 전부가 400을
  받는 상태에서 "V3 strict JSON schema 지원 확인"을 반환했다. 운영자는 그
  초록불을 보고 V3를 켰고, 실패는 초안 단계에서야 드러났다. probe를 실제
  스키마와 같은 문법(루트 union envelope + 중첩 anyOf + enum + 길이·개수 제한)
  으로 바꾸고, 네트워크 전에 배포된 스키마를 `assertStrictSchemaCompatible()`
  로 먼저 검사하도록 했다.
- 판정: 유지. 계약 버전(`post-plan-v1`/`image-plan-v1`)은 올리지 않는다 —
  전송 인코딩만 바뀌고 Agent가 주고받는 의미와 저장 artifact는 동일하다.
- 회귀 방지: `src/worker/strict-schema.spec.ts`가 정적 스키마 3종과 평가 Agent
  스키마 6종(조립 시점에 캡처)을 같은 규칙으로 검사한다. 프로바이더 문법을
  어기는 스키마는 네트워크 없이 테스트에서 걸린다.
- 다음: 다른 프로바이더(Anthropic·Gemini 호환 경로)를 붙일 때 이 부분집합이
  또 달라진다. 지금은 OpenAI 호환만 가정하므로, 프로바이더가 늘면
  `strict-schema.ts`를 프로바이더별 프로파일로 확장한다.

## image-planner-v2 — 촬영 기하 일관성과 종횡비 범위 (2026-08-13)

- 상태: 관측 중 (재실행 1회 전)
- 대상: `prompts/image-planner.ts` 시스템 프롬프트. 스키마와 계약 버전
  (`image-plan-v1`)은 바꾸지 않았다.
- 발단: 실제 초안의 ImagePlan에서 `capture_plausibility` 3/5, `major` 지적이
  나왔다. 평가자 진단이 정확했다.

  ```
  scene:        "전신거울에 비친 목 아래 전신 … 스마트폰이 얼굴을 완전히 가리고"
  captureSetup: "스마트폰 전면 카메라를 든 인물이 … 미러 셀피를 촬영한다"
  ```

  거울 셀카는 화면이 나를 향하고 **후면** 카메라가 거울을 향한다. 전면
  카메라는 나를 직접 찍으므로 "거울에 비친 전신"이 나올 수 없다. 폰을 뒤집어
  전면 카메라를 거울로 향하게 하면 찍히긴 하지만 화면이 안 보이고 거울에
  폰 화면이 비친다. 즉 scene과 captureSetup이 기하학적으로 양립하지 않는다.
- 가설: 기존 프롬프트에는 "physically plausible … with an ordinary available
  device"라는 일반 문장만 있어, **장치의 광학 방향**까지는 강제되지 않는다.
  scene/captureSetup 분리 규칙도 "무엇을 어디에 쓰는가"만 말하고 "둘이
  성립하는가"는 말하지 않는다. 원칙 한 줄 + 재발 사례(거울) 한 줄을 넣으면
  같은 결함이 줄어든다.
- 변경:
  1. Responsibilities에 촬영 기하 규칙 추가 —
     `captureSetup must be geometrically able to produce scene.` 반사 뷰는
     렌즈가 반사면을 향해야 하므로 셀프 미러샷은 후면 카메라이고 거울에는
     기기 뒷면이 보인다, 전면 카메라는 피사체를 직접 담고 반사 뷰를 만들지
     않는다. 손·기기·팔다리·몸 방향이 한 사람에게 동시에 가능해야 한다.
  2. Scope boundary의 `generation settings`에 `including aspect ratio and
     resolution`을 명시. 같은 산출물이 `captureSetup`에 "세로 4:5"를 적었는데,
     종횡비는 설정이 게시 형식에서 유도한다(`aspectRatioFeed` 등, `324899b`).
     기획이 정할 값이 아니고, crop/framing이라면 애초에 `scene` 소관이다.
- 결과 (2026-08-14, draft `019ffa17…`, artifact `promptVersion: image-planner-v2`,
  imagePlanning revision 1):

  | 컷 | 기획한 촬영 | 결과 |
  |---|---|---|
  | 0 미러 셀카 | `rear camera … aiming the lens squarely at its reflective surface` | **규칙이 겨냥한 결함 재발 없음** |
  | 1 거치 촬영 | `propped upright on the cream shoe cabinet … aimed directly toward her` | 같은 차원에서 **새 유형** 결함 |

  컷 1의 scene은 "그 신발장이 그녀 뒤에 보인다"고 썼다. 카메라를 올려둔 물체는
  카메라 위치, 즉 프레임 밖에 있으므로 배경에 나올 수 없다. 평가자가 major로
  잡았다.

  ```
  capture_plausibility 3/5 · issues_found · 총점 4.818 (= 53/11, 한 차원만 3점)
  ```

  **v1 때와 수치가 동일하다.** 결함의 종류만 바뀌었다.

- 판정: **부분 유지.** 사례(거울)는 해결됐고 원칙 일반화는 미달이다. 규칙을
  "원칙 한 문장 + 재발 사례 한 문장"으로 썼는데, 모델이 사례는 따르고 원칙은
  일반화하지 못했다. "카메라를 지지하는 면·물체는 프레임 밖"은 원칙
  (`captureSetup must be geometrically able to produce scene`)의 직접 귀결인데
  지켜지지 않았다. 롤백하지 않는다 — 되돌리면 거울 결함이 돌아온다.
- 표본 주의: **관측 1건이다.** 거울 결함이 나지 않은 것이 규칙 덕인지 우연인지
  1건으로는 가릴 수 없다. 다만 같은 차원에서 다른 결함이 났다는 사실은
  "`capture_plausibility`가 이 파이프라인의 구조적 약점"이라는, 표본 1건보다
  강한 신호다.
- 부수 관측: 평가자는 두 번 다 정확했다. `docs/post-creation-agent-architecture-v3.md`
  §18.8에 기록한 평가자 사각지대 3건과 대조된다 — `capture_plausibility`는
  작동하고 `scope_compliance`·`ai_tell_free`는 놓친다.
- 다음 후보 (미적용): v3에서 원칙에 귀결을 하나 명시한다 — 촬영자와 카메라를
  지지하는 면·물체는 프레임 밖이며 scene에 등장할 수 없다. 적용 전에 관측을
  더 모아 사례 나열이 아니라 원칙 강화로 가는지 확인한다.
- 방법 주의: **평가자 프롬프트는 이번에 건드리지 않는다.** 같은 산출물에서
  평가자가 놓친 것이 하나 더 있다 — `captureSetup`의 "세로 4:5"는
  `scope_compliance` 소관인데 5/5를 줬다. 측정 대상(기획자)과 측정 도구
  (평가자)를 동시에 바꾸면 점수 변화가 어느 쪽 때문인지 알 수 없다. 기획자
  변경의 효과를 먼저 관측하고, 평가자 보정은 별도 엔트리로 다룬다.
- 관측 방법: 같은 초안에서 ③ 이미지 기획을 재실행하고
  `capture_plausibility` 점수와 `captureSetup`의 종횡비 언급 유무를 본다.
  artifact의 `promptVersion`이 `image-planner-v2`인지로 새 프롬프트가 실제로
  쓰였는지 확인한다.
