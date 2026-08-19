# 리포트 — 촬영 계약의 빈칸 메우기

Status: 코드 완료 · 데이터 작업과 배포 대기
Date: 2026-08-18
계획: `.codex/pave/plans/2026-08-18-capture-contract-gaps.md`

## 한 일

| 서브시스템 | 결과 |
|---|---|
| A. 페르소나 촬영 블록 | 표준 블록 13종으로 `capture_style`(촬영 방식) 추가. ② reserved·③ relevantContext 양쪽에서 제외하고 `characterVisualContext.captureStyle` 전용 필드로 전달 |
| B. 장소 네거티브 분리 | `character_locations.reference_negative_prompt` 신설(마이그레이션 `20260818030000`, canonical=backend). 컷 생성 병합은 `negative_prompt`만 쓴다. admin CRUD·화면에 두 필드 |
| C. ③ 계약 3필드 | `subjectState`·`motionEvidence`·`notInFrame` 필수 필드. `image-plan-v2` / `image-planner-v4` |
| D. ④ 번역 | `image-prompt-generator-v2` — 세 필드의 렌더 책임 명시, `notInFrame`은 정책 문구보다 우선 |
| E. 읽기 모델·화면 | ③ 컷 카드에 인물 상태·동작 증거·프레임에 없어야 할 것 노출 |
| F. 테스트 | 3건 추가 |
| G. 문서 | research-log `image-planner-v4`/관측 4, 아키텍처 §19.1 #22·§19.5 처방 상태 |

## 테스트 (Test Value Gate)

- `capture_style`이 전용 필드로 가고 `relevantContext`에서 빠지는가 — 회귀 시 ③가
  다시 촬영자·지지물을 발명한다(§19.5 원인 1의 재발).
- 컷 생성 요청에 `reference_negative_prompt`가 섞이지 않는가 — 회귀 시 인물 컷에
  "사람 금지"가 함께 나가 목록 전체가 무시되고 마루 위 신발이 돌아온다.
- `image-plan-v2` 이전 계약(3필드 없음)으로 프롬프트 패키지가 조립되는가 — 회귀 시
  기존 초안의 ④ 재실행이 통째로 막힌다.

## 검증

`npm test` 53 스위트 446건 통과 · `npm run lint` 통과 · `npx tsc --noEmit` 통과 ·
`npm run admin:check` 17파일 66건 통과 · `node scripts/check-schema-sync.mjs` OK ·
prettier 통과.

부수 정리: backend main을 풀면서 생긴 admin 스키마 drift 2건(`Payment`의
`netAmount`·`taxAmount`, `CreditRefund`의 `freePromotionAmount`)을 canonical에서
동기화했다. `schema:check`가 이걸로 막혀 있었다.

## 남은 일 (코드 아님)

1. **마이그레이션 배포** — backend `deploy.sh`(컨테이너 기동 시 `prisma migrate
   deploy`). admin 배포는 그 다음.
2. **데이터** — 캐릭터 3명의 `capture_style` 블록 작성(기존 `content_style`에서
   촬영 문단 이관), 장소 4곳의 네거티브에서 사람 관련 항목을
   `reference_negative_prompt`로 옮기기.
3. **관측** — 같은 3캐릭터로 1건씩 재생성. 판정 축은 (1) 촬영 주체가 프레임에
   남는가 (2) 운동 직후 상태가 보이는가 (3) 마루 위 신발이 사라지는가.

## 잔여 위험

- ③ 세 필드를 동시에 넣어 개별 기여도는 판정 불가(운영자 결정).
- `capture_style`이 비어 있는 캐릭터는 지금과 동일하게 동작한다 — 데이터 작업
  전에는 A의 효과가 나타나지 않는다.
- 권도건 `visualStyle`의 `editorial` 가설은 이 범위 밖(어블레이션 6장 대기).
