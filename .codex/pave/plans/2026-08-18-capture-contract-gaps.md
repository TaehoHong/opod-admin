# 촬영 계약의 빈칸 메우기 — 촬영 블록 신설 · 장소 네거티브 분리 · ③ 스키마 3필드

Status: 계획 — 구현 승인 대기
Last updated: 2026-08-18
관측 근거: 2026-08-18 3캐릭터 5컷 동시 관측(서린 `01a0089b` 1컷 · 권도건
`01a01019` 2컷 · 한소이 `01a01233` 2컷). 종합은 아키텍처 §19.5.

## Goal

계약에 **적힌 것**은 모델이 잘 지킨다(화이트보드 기록과 바닥 타이머가 일치할
정도로). 이번 5컷의 결함은 전부 **계약에 칸이 없어서 안 적힌 것**이다 — 촬영
문법, 인물 상태, 동작 증거, 프레임에 없어야 할 것. 규칙 문장을 더하지 않고 칸을
만든다.

## Confirmed Decisions (운영자, 2026-08-18)

1. 촬영 문법은 **페르소나 블록으로 신설**한다. content_style을 통째로 ③에
   보내지 않는다(글쓰기 규칙 노이즈가 §19.2 "제약이 결함을 만든다"를 재생산).
2. 장소 네거티브는 **두 벌로 분리**한다. 컷 생성에는 공간 금지만 보내고, 빈 공간
   렌더용 금지(people/faces/silhouettes)는 컷 생성 요청에서 뺀다. `shoes`는
   남긴다 — #11에서 실제로 일한다는 판정이 났다.
3. ③ 스키마 3필드는 **한 번에** 도입한다. 개별 기여도 판정은 포기하고 속도를
   택한다(관측 시 이 사실을 함께 기록한다).

## 근거 (관측 → 결함)

| # | 관측 | 계약의 빈칸 |
|---|---|---|
| 1 | 한소이 ③가 **삼각대를 발명**. 그녀의 실제 방식은 "벤치·창틀 같은 고정면 + 셀프타이머"인데 그 문장이 `content_style`에 있어 ③ 입력에서 제외됨 | 촬영 문법의 주인 필드 없음 |
| 2 | 서린 미러 셀피에 장소 네거티브 `people, body parts, faces, silhouettes, human reflection`이 함께 전송됨 — 사람이 나와야 하는 컷과 정면 모순. 모델은 본문을 골랐고, 같은 줄의 `shoes`까지 함께 무시되어 마루 위 운동화가 남음 | 컷 유형과 무관한 네거티브 병합 |
| 3 | 권도건 완주 직후 컷의 머리가 뽀송. 계약은 땀을 **의상에만** 걸었다(`땀에 젖은 차콜 슬리브리스`) | 인물 상태 필드 없음 |
| 4 | 권도건 "조깅 페이스로 달린다" → 걷는 렌더. 모션 블러·뜬 발·흔들리는 옷 미지시 | 동작 증거 필드 없음 |
| 5 | 한소이 두 컷 모두 `captureSetup`이 "카메라는 프레임 밖"이라 했는데 AE-1과 삼각대가 프레임 안. 촬영 주체가 증발해 3인칭으로 읽힘. 5컷 중 4컷에서 기하가 무시됨(어블레이션: 문구 0/6, 장면 계약 6/6) | 프레임에 **없어야 할 것**을 내용 언어로 쓰는 칸 없음 |

취소한 처방 2건(재검토 결과): ② 입력에 장소 목록 추가와 blocked
`location_unavailable` — `locationId: null`("uncatalogued single place")이 이미
프롬프트·스키마에 있어 미등록 장소는 그냥 그리면 된다. lockedElements 범위
확장 — 서린 체형 표류는 잠금이 아니라 identity 바인딩이 이미 지시한 축이라 계약
층 결함이 아니다.

## Scope Map

| 서브시스템 | 변경 | 파일 |
|---|---|---|
| A. 페르소나 촬영 블록 | 표준 블록 13종으로 `capture_style`(촬영 방식) 추가. ② reserved 목록과 ③ 제외 목록에 등록해 `additionalContext`로 새지 않게 하고, ③에는 `characterVisualContext.captureStyle`로 **전용 필드** 전달 | `packages/admin/src/features/characters/CharacterPersonasPanel.tsx`, `src/worker/post-pipeline-v3.runner.ts`(`personaInput` reserved, `runImagePlanning` 필터+필드), `src/worker/image-planner.ts`(입력 타입) |
| B. 장소 네거티브 분리 | `character_locations.reference_negative_prompt` 컬럼 신설. 컷 생성 병합에서는 `negative_prompt`만 쓴다. admin CRUD·화면에 두 필드 노출 | `prisma/schema.prisma` + 마이그레이션, `src/worker/generation-worker.service.ts:555`, `src/admin/locations/*`, `packages/admin/src/features/locations/*` |
| C. ③ 계약 3필드 | shot에 `subjectState`(인물 컷 필수) · `motionEvidence`(동작 컷 필수) · `notInFrame`(항상) 추가. 계약 `image-plan-v2`, 프롬프트 `image-planner-v4` | `prompts/image-planner.ts`, `src/worker/image-planner.ts` |
| D. ④가 새 필드를 번역 | `image-prompt-generator`가 세 필드를 보존하도록 지시 추가. 안 하면 계약만 늘고 픽셀은 그대로다 | `prompts/image-prompt-generator.ts`(버전 업), `src/worker/image-prompt-generator.ts` |
| E. 화면·읽기 모델 | `V3ImagePlanShot`에 세 필드 노출(③ 화면에서 계약을 눈으로 확인할 수 있어야 재발을 잡는다) | `src/admin/post-workspace/post-workspace.service.ts`, `packages/admin/src/features/posts/PostWorkPage.tsx` |
| F. 데이터 | 캐릭터 3명의 `capture_style` 블록 작성(기존 content_style에서 촬영 문단 이관) · 장소 4곳의 네거티브를 두 벌로 정리 | 운영 데이터(개발서버) |
| G. 문서 | research-log에 관측 4(3캐릭터 동시) + `image-planner-v4`·`image-prompt-generator` 버전 엔트리, 아키텍처 §19.1 #22·§19.5 처방 (a)(b) 반영 | `docs/` |

## 호환성

- 기존 v3/v4 초안의 `imagePlanning`에는 새 필드가 없다. 읽기 경로(④ 재실행, 화면,
  평가)는 세 필드를 **optional**로 다룬다. 기존 초안 재실행 시 계약 버전이
  올라가는 것은 정상 동작이다.
- `capture_style` 블록이 없는 캐릭터는 지금과 동일하게 동작한다(빈 배열).
- `reference_negative_prompt`는 기본값 `''`. 마이그레이션은 컬럼 추가만 하고 기존
  값은 건드리지 않는다 — 사람 항목 이관은 F(데이터)에서 사람이 한다.

## Verification

- `npm test`(53 스위트) · `npm run lint` · `npx tsc --noEmit` · `npm run schema:check`
- 신규 단위 테스트: ③ 입력 조립이 `capture_style`을 전용 필드로 넣고
  `relevantContext`에서 제외하는가 · 컷 생성 병합이 `reference_negative_prompt`를
  보내지 않는가 · 새 필드가 없는 옛 계약을 ④가 그대로 처리하는가
- 관측: 같은 3캐릭터로 각 1건씩 재생성. 판정 축은 (1) 촬영 주체가 프레임에
  남는가 (2) 운동 직후 상태가 보이는가 (3) 마루 위 신발이 사라지는가

## 미포함 (별건)

- 권도건 `visualStyle`의 `editorial` — 어블레이션 6장으로 검증 후 판단
- ②의 반복 기획(서린 5건 중 4건 동일) — `recentPosts`가 게시본만 보는 문제. 입력
  변경이라 이 계획과 층이 달라 분리한다
