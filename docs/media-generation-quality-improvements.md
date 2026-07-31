# 게시글 생성 Agent 품질·핍진성 개선

Status: 전수 분석 완료, 1차 핵심 개선 및 인물 레퍼런스 누락 차단 구현

## 1. 목표

게시글 생성 Agent가 만든 기획, 이미지와 게시 이력이 다음 조건을 만족하도록
개선한다.

- 캐릭터의 세계관, 촬영 습관과 게시 맥락에 맞아야 한다.
- 최종 이미지의 피사체와 실제 촬영 과정이 구분돼야 한다.
- 카메라 위치, 촬영자, 손, 거울, 행동이 물리적으로 양립해야 한다.
- 인물, 장소, 의상과 시간대가 한 게시물 안에서 자연스럽게 이어져야 한다.
- 최초 생성, 재생성, 재시도와 수동 실행이 같은 품질 계약을 지켜야 한다.
- 운영 화면에 표시되는 프롬프트·레퍼런스와 실제 provider 요청의 일치 여부를
  확인할 수 있어야 한다.
- 게시 후 다음 기획에 반영되는 메모리가 실제 게시 결과와 일치해야 한다.

이 문서는 분석 당시의 결함, 적용한 1차 개선과 후속 개선 순서를 함께
기록한다. 1차 개선은 PAVE 검토와 서브에이전트 교차 리뷰를 거쳐 구현했으며,
제품 정책이 필요한 항목은 임의로 확정하지 않았다.

### 1차 구현 결과

- 플래너부터 provider 실행까지 `scene`, `captureSetup`,
  `characterVisible`, `referenceIds`, `sortOrder`, `targetModelId`를 보존한다.
- `scene`은 최종 프레임의 픽셀만, `captureSetup`은 프레임 밖 촬영 과정만
  표현하도록 분리했다.
- 무인 컷은 LLM 빌더와 로컬 폴백 모두 외모·인물 레퍼런스를 제외하고,
  로컬 폴백이 촬영자 이름을 피사체로 재삽입하지 않게 했다.
- 요청한 컷 수와 빌더 출력 순서를 검증해 누락·재정렬을 거절한다.
- 기획에 사용한 레퍼런스와 실제 실행 레퍼런스, 빌드 대상 모델과 실행
  provider 모델을 비교할 수 있도록 실행 스냅샷을 저장한다. 불일치는
  provider 제출을 막지 않고 검수 화면의 경고로 노출한다.
- 컷 재생성·일반 재시도에서 입력 프롬프트, 후보 수와 `_shot` 메타데이터를
  보존하고, 상태 전이·잡 생성·감사 로그를 트랜잭션으로 묶었다.
- 오래된 컷 잡의 재생성과 초안 소유 잡의 일반 재시도를 차단했다.
- 비주얼 프로필 편집 시 유지되는 레퍼런스 설명을 보존하고 provider 설정이
  `prompt`, `image_urls`, `num_images`, `negative_prompt`를 덮어쓰지 못하게
  했다.
- `characterVisible=true`인 샷은 유효한 업로드 완료 인물 레퍼런스가 최소
  한 장 있어야 한다. 기획·수동 빌드·위저드·provider 실행 경계에서 누락을
  검사하고, 자동 T2I 전환이나 동일 조건의 자동 재기획 없이 즉시 실패한다.

아직 구현하지 않은 제품 정책과 후속 품질 개선은 2~4차 우선순위 및
11절에 명시한다.

## 2. 분석 범위

다음 경로를 자동·수동·생성 위저드로 나눠 끝까지 추적했다.

1. 스케줄러 또는 운영자 초안 생성
2. 캐릭터·페르소나·메모리·최근 게시물·레퍼런스 카탈로그 조립
3. 콘텐츠 기획 LLM 호출과 응답 파싱
4. 이미지 프롬프트 빌더 호출과 응답 파싱
5. 컷별 생성 잡과 메타데이터 저장
6. 레퍼런스 해석, T2I/edit 라우팅과 fal 요청 생성
7. 후보 다운로드·저장·검수·선택·필터
8. 컷 재생성, 일반 재시도와 lease 복구
9. 승인·게시·메모리 역반영
10. 일반 이미지 생성 위저드와 비주얼 프로필 관리

주요 근거:

- `prompts/content-planner.ts`
- `src/worker/content-planner.ts`
- `prompts/image-prompt-builder.ts`
- `src/worker/image-prompt-builder.ts`
- `src/worker/draft-worker.service.ts`
- `src/worker/generation-worker.service.ts`
- `src/worker/image-generation.provider.ts`
- `src/admin/drafts/drafts.service.ts`
- `src/admin/generation/generation.service.ts`
- `src/characters/visual-profile.service.ts`
- `packages/admin/main.js`
- 관련 단위 테스트와 API 문서

## 3. 현재 데이터 흐름

### 자동 게시물

```text
posting policy
  → planned draft
  → planner
  → batch prompt builder
  → image jobs
  → per-shot T2I/edit provider
  → candidates
  → review/selection
  → approval
  → publish
  → character memory
```

### 수동 게시물

```text
manual draft
  → /plan
  → /build-prompts
  → shot별 /generate
  → /aggregate
  → review/selection
  → approval
  → /publish
```

### 분석 당시 샷 계약

```json
{
  "scene": "한국어 장면 서술",
  "referenceIds": ["media-id"]
}
```

프롬프트 빌더에는 `referenceIds`도 전달되지 않고 `scene`만 전달됐다.
그 결과 다음 정보가 자연어 한 문장 안에 섞였다.

- 최종 이미지 안에 보여야 하는 대상
- 촬영자와 카메라의 위치
- 캐릭터가 프레임 안에 있는지
- 레퍼런스를 사용하지 않은 이유
- 실제 생성 모델과 화면 비율

이 정보 손실이 분석 당시 확인된 품질 문제의 공통 원인이었고, 1차
구현에서는 6.1의 구조 계약으로 교체했다.

## 4. 우선순위별 확인된 결함

이 절은 원인 추적 기록이다. 1차 우선순위 중 구현된 항목은 1절의
“1차 구현 결과”와 8절의 상태표를 기준으로 판단한다.

### P1. 최종 화면과 촬영 과정이 분리되지 않는다

플래너는 `scene`에 장면뿐 아니라 촬영자와 카메라 위치까지 쓰도록 요구받고
있다.

- `prompts/content-planner.ts:38-41`
- `prompts/image-prompt-builder.ts:70-75`

빌더는 그 문장에 등장한 촬영자와 카메라를 보존하므로, 촬영 과정이 최종
피사체로 바뀔 수 있다.

확인된 사례:

- 한소이가 Canon AE-1로 직접 찍은 무인 풍경이 카메라를 든 한소이의 인물
  사진으로 생성됨
- 서린이 직접 촬영하는 운동 기록이 제3자가 뒤에서 따라 찍은 구도로 생성됨

프롬프트에 금지 문구를 추가하는 것만으로는 해결되지 않는다. 촬영자와 최종
피사체를 구조적으로 분리해야 한다.

### P1. 모든 샷에 캐릭터 외모가 공통 주입된다

빌더 입력은 모든 샷에 같은 `appearancePrompt`와 `stylePrompt`를 전달한다.

- `src/worker/image-prompt-builder.ts:25-29`
- `src/worker/draft-worker.service.ts:529-536`

LLM 빌더는 장면 문맥으로 인물 노출 여부를 추측해야 한다. 로컬 폴백은 추측도
하지 않고 모든 샷을 `appearance + scene + style`로 연결한다.

- `src/worker/image-prompt-builder.ts:59-73`
- `prompts/image-prompt.ts:4-11`

따라서 LLM 설정이 빠진 환경에서는 무인 풍경과 사물 컷에 외모 프롬프트가
들어가는 것이 결정적이다.

### P1. `referenceIds: []`가 서로 다른 상태를 하나로 합친다

현재 파서는 아래 경우를 모두 빈 배열로 정리한다.

- 실제 인물 없는 샷
- 레퍼런스 카탈로그가 없음
- 캡션이 없어 카탈로그에서 제외됨
- LLM이 `referenceIds`를 누락함
- LLM이 존재하지 않는 ID만 반환함

- `src/worker/content-planner.ts:158-200`
- `src/worker/draft-worker.service.ts:485-505`

생성 워커는 빈 배열을 명시적인 레퍼런스 미사용으로 해석해 T2I로 보낸다.

- `src/worker/generation-worker.service.ts:71-80`
- `src/worker/generation-worker.service.ts:439-453`

인물 샷의 레퍼런스 준비·선별 실패가 정상적인 무인 컷과 구별되지 않아
identity conditioning이 조용히 사라진다.

### P1. 컷 재생성이 장면과 레퍼런스 문맥을 버린다

초안 컷 재생성은 원본에서 `prompt`, `provider`, `sortOrder`만 읽고 새 잡에
다음 값을 복사하지 않는다.

- `paramsJson._shot.scene`
- `paramsJson._shot.referenceMediaIds`
- 화면 비율과 provider 파라미터
- `candidateCount`

근거:

- `src/admin/drafts/drafts.service.ts:491-525`
- 현행 손실 동작을 고정한 테스트:
  `src/admin/drafts/drafts.service.spec.ts:328-360`

`_shot`이 사라지면 생성 워커는 구버전 호환 경로로 캐릭터의 전체 레퍼런스를
사용한다. 원래 무인 풍경이었던 컷도 재생성하면 T2I에서 edit로 바뀌고 인물이
다시 등장할 수 있다.

일반 실패 잡의 `retryJob`도 프롬프트와 provider만 복사하고 `paramsJson`,
후보 수와 입력 문맥을 잃는다.

- `src/admin/generation/generation.service.ts:541-554`

반면 일반 이미지의 `regenerateImageJob`은 이미 해당 메타데이터를 보존한다.

- `src/admin/generation/generation.service.ts:415-447`

### P1. 재생성의 상태 전이와 새 잡 생성이 원자적이지 않다

초안은 먼저 `regenerating`으로 바뀌고 그 다음 새 잡을 생성한다.

- `src/admin/drafts/drafts.service.ts:506-526`

중간 실패나 집계 워커와의 경쟁이 생기면 다음 상태가 가능하다.

- 초안은 `regenerating`인데 새 잡이 없음
- 기존 완료 잡만 보고 다시 `needs_review`로 전환
- 이후 새 잡은 생성되지만 초안이 집계 대상에서 빠짐
- 운영자는 옛 후보를 승인하고 새 생성 결과는 사용하지 않음

초안 상태 전이, 새 잡 생성과 로그를 하나의 트랜잭션으로 묶어야 한다.

### P1. 프롬프트 대상 모델과 실제 실행 모델이 다를 수 있다

프롬프트 빌더는 항상 `editModel ?? t2iModel`을 대상 모델로 받는다.

- `src/worker/worker.module.ts:71-85`
- `src/admin/admin.module.ts:70-85`

실제 워커는 컷에 남은 레퍼런스 유무에 따라 edit 또는 T2I를 선택한다.

- `src/worker/generation-worker.service.ts:366-372`

인물 컷과 무인 풍경 컷이 섞인 게시물에서는 풍경 프롬프트도 edit 모델
문법으로 작성된 뒤 T2I 모델로 실행된다. 두 모델이 다른 계열이면 프롬프트
형식과 지원 기능까지 어긋난다.

### P1. 레퍼런스 편집이 기존 캡션을 전부 삭제한다

레퍼런스 추가, 제거, 순서 변경과 생성 결과 승격은 모두 전체 세트를
삭제하고 다시 생성한다. 재생성 시 기존 `description`을 보존하지 않는다.

- `src/characters/visual-profile.service.ts:189-237`
- `prisma/schema.prisma:794-800`
- `packages/admin/main.js:5152-5173`
- `packages/admin/main.js:5693-5730`

캡션이 사라진 레퍼런스는 다음 기획 카탈로그에서 제외된다. UI는 수동
`캡션 생성` 버튼을 제공하지만, 기존 문서는 업로드·승격 시 캡션이 생성된다고
설명해 구현과 운영 계약도 다르다.

### P1. 기획 후 레퍼런스가 바뀌면 조용히 T2I로 전환된다

생성 워커는 실행 시점의 현재 비주얼 프로필에서 선택 ID를 다시 찾는다.
기획 후 레퍼런스가 삭제되거나 업로드 상태가 바뀌면 해당 ID는 경고 없이
버려진다.

- `src/worker/generation-worker.service.ts:433-470`

선택 ID가 전부 사라져도 잡은 실패하지 않고 T2I로 전환된다. 인물이 보이는
샷에서는 정체성 일관성이 사라지지만 운영 화면에서 원인을 알기 어렵다.

### P1. provider 추가 파라미터가 핵심 요청을 덮어쓸 수 있다

`providerConfig`와 잡별 `paramsJson`을 합친 `extraParams`가 fal 요청 본문의
마지막에 펼쳐진다.

- `src/worker/generation-worker.service.ts:471-485`
- `src/worker/image-generation.provider.ts:213-230`

현재 구조에서는 다음 예약 필드를 덮어쓸 수 있다.

- `prompt`
- `image_urls`
- `num_images`
- `negative_prompt`

레퍼런스 선별, 최종 프롬프트, 후보 수와 제외 조건이 UI·잡 정보와 다르게
실행될 수 있다. 테스트도 이 덮어쓰기를 허용된 동작으로 고정한다.

- `src/worker/image-generation.provider.spec.ts:165-179`

### P1. 운영 설정 누락을 정상 이미지 생성으로 처리한다

fal API 키가 없거나 해당 라우트의 모델이 없으면 local provider가 1×1 회색
PNG를 반환하고 잡은 `completed`가 된다.

- `src/worker/image-generation.provider.ts:59-93`
- `src/worker/image-generation.provider.ts:106-138`

개발용 플레이스홀더가 운영 초안 검수로 들어갈 수 있으므로 운영에서는
설정 오류로 실패해야 한다.

### P1. 후보 선택·필터와 승인·게시 사이에 동결 경계가 없다

초안 후보 선택은 완료 잡만 확인하고 초안 상태나 최신 잡 여부를 제한하지
않는다.

- `src/admin/drafts/drafts.service.ts:537-570`

게시 로직은 트랜잭션 밖에서 선택 결과를 읽고 필터 파일까지 만든 다음,
마지막에 `approved → published`를 시도한다.

- `src/worker/draft-worker.service.ts:781-847`

승인 또는 게시 이후에도 옛 잡의 선택과 필터가 바뀔 수 있어, 실제 게시물과
초안 화면이 서로 다른 이미지를 가리킬 수 있다. 승인을 선택 결과의 freeze
boundary로 만들어야 한다.

### P1. 상태 전이와 감사 로그가 분리돼 수동 흐름이 중단될 수 있다

초안 생성, 수동 컷 queue, 승인, 반려는 상태를 먼저 바꾸고 로그를 나중에
쓴다. 로그 실패가 예외로 전파된다.

- `src/admin/drafts/drafts.service.ts:278-295`
- `src/admin/drafts/drafts.service.ts:455-481`
- `src/admin/drafts/drafts.service.ts:388-426`
- `src/admin/drafts/drafts.service.ts:664-678`

수동 컷 queue 후 로그 기록이 실패하면 컨트롤러가 `runJobNow`를 호출하지
못한다. 자동 워커가 꺼져 있으면 잡은 queue에 남고 같은 버튼 재실행도
거절된다. 상태·잡·로그를 트랜잭션으로 묶거나 로그를 명시적인
best-effort로 분리해야 한다.

### P1. provider 완료 후 저장 실패의 재수용 경로가 끊길 수 있다

fal 결과를 받으면 LLM 로그를 먼저 `succeeded`로 닫고, 이후 결과 다운로드,
스토리지 업로드와 DB 저장을 수행한다.

- `src/worker/image-generation.provider.ts:382-410`
- `src/worker/generation-worker.service.ts:496-596`

저장만 실패하면 같은 provider request ID로 재시도하지만 새 provider
인스턴스는 `running` 로그만 찾는다.

- `src/domain/llm-logs/llm-log.service.ts:274-294`

이미 성공으로 닫힌 로그를 찾지 못해 유효한 생성 결과를 다시 수용하지
못할 수 있다.

### P2. 게시 시각·형식·화면 비율이 기획에 전달되지 않는다

자동 초안의 `contentType`, `scheduledAt`과 실제 생성 비율은 플래너와
빌더 입력에 없다.

- `src/worker/draft-worker.service.ts:435-506`
- `src/admin/generation/generation.service.ts:250-290`

그 결과 계절, 시간대, 조명, 의상과 구도는 실제 게시 시각과 화면 비율을
모른 채 결정된다. 특히 전신, 거울샷과 고정폰 구도는 세로·가로 프레임에
따라 물리적으로 가능한 범위가 다르다.

### P2. `reel`을 받지만 실제 기획과 생성은 feed 이미지다

초안 API는 `feed`와 `reel`을 모두 허용하지만 플래너는 항상 feed post를
기획하고 모든 잡은 이미지로 생성한다.

- `src/admin/drafts/drafts.service.ts:267-282`
- `prompts/content-planner.ts:32-45`
- `src/worker/draft-worker.service.ts:561-582`

영상 파이프라인이 없다면 `reel`을 거절하거나 별도 계약을 정의해야 한다.

### P2. 요청한 샷 수와 실제 계획 수가 달라도 성공한다

플래너 프롬프트는 정확한 수를 요청하지만 파서는 유효한 샷이 하나 이상이면
성공하고 초과분은 조용히 자른다.

- `prompts/content-planner.ts:88-90`
- `src/worker/content-planner.ts:159-180`

캡션은 두 컷을 전제로 썼지만 실제 생성은 한 컷만 되는 불일치가 생길 수
있다. 빌더처럼 플래너도 정확한 개수를 검증해야 한다.

### P2. 운영자 장면 힌트의 반영 여부를 검증하지 않는다

`sceneHint`는 프롬프트에서 필수라고만 표시된다. 출력 장면이 힌트를
반영했는지 코드에서 확인하지 않는다.

- `prompts/content-planner.ts:74-77`
- `src/worker/content-planner.ts:136-180`

의미 유사도 검사를 성급히 추가하기보다, 구조 필드에 운영자 제약을 보존하고
수동 검수 화면에서 비교할 수 있어야 한다.

### P2. 선택 레퍼런스의 설명을 프롬프트 빌더가 모른다

플래너는 구도 충돌이 적은 레퍼런스를 선택하지만 빌더는 선택 ID나 설명을
전혀 받지 않는다.

- `prompts/content-planner.ts:41`
- `src/worker/image-prompt-builder.ts:25-29`

최종 프롬프트는 edit 모델이 실제로 받는 정면·측면·크롭·의상·배경
레퍼런스와 조율되지 않는다. 또한 provider 프롬프트에는 레퍼런스를
정체성에만 사용하고 의상·배경·포즈는 복사하지 말라는 명시적 역할 구분이
없다.

### P2. 다중 샷 연속성 계약이 없다

전 샷을 한 번에 빌드해 기본적인 인물·스타일 일관성은 유도하지만 다음
일회성 사실을 저장하거나 전달하지 않는다.

- 같은 방문·같은 촬영 세션인지
- 같은 장소의 어느 구역인지
- 같은 날 입은 의상인지
- 시간대와 날씨가 이어지는지

그 결과 같은 헬스장 연속 컷인데 공간, 조명과 옷이 달라질 수 있다. 반대로
서로 다른 시점이어야 하는 컷을 억지로 같게 만들 수도 있다.

### P2. 빌더 재시도 때문에 기획 전체가 바뀐다

자동 모드에서 빌더 실패는 초안을 다시 `planned`로 돌리고 다음 시도에서
플래너부터 다시 호출한다.

- `src/worker/draft-worker.service.ts:523-537`
- `src/worker/draft-worker.service.ts:598-630`

기술적인 빌더 장애 때문에 캡션, 장면과 레퍼런스 선택까지 바뀌어 재현성과
비교 가능성이 낮아진다.

### P2. 실제 게시 장면이 아니라 최초 기획을 메모리에 남긴다

운영자가 최종 프롬프트를 수정하거나 컷을 다른 장면으로 재생성해도
`conceptJson.plan.shots[].scene`은 바뀌지 않는다.

- `src/admin/drafts/drafts.service.ts:438-463`
- `src/admin/drafts/drafts.service.ts:504-525`

게시 후 메모리는 최초 기획 장면만 사용하며 최대 세 컷 중 앞의 두 컷만
기록한다.

- `src/worker/draft-worker.service.ts:905-911`
- `src/worker/draft-worker.service.ts:1098-1119`

다음 플래너가 실제 게시물과 다른 세계관을 확정 기억으로 받아 장기
핍진성과 소재 중복 방지가 흐려진다.

### P2. 운영 화면의 실제 라우트·레퍼런스 표시가 부정확하다

일반 생성 위저드의 `generationContext`는 컷별 선택 레퍼런스가 아니라
프로필 전체 업로드 레퍼런스 수로 edit/T2I를 계산한다.

- `src/admin/generation/generation.service.ts:811-823`
- `packages/admin/main.js:389-410`

무인 컷의 실제 요청이 `0장 · T2I`여도 화면에는 `전체 레퍼런스 · edit`로
표시될 수 있다.

### P2. 출력 파일과 후보 완전성을 검증하지 않는다

provider가 반환한 이미지 수가 요청 후보 수보다 적어도 성공 처리한다.
응답에 MIME 정보가 없으면 PNG로 가정하며 실제 바이트 형식, 디코딩 가능
여부, 크기와 종횡비를 확인하지 않는다.

- `src/worker/image-generation.provider.ts:443-466`
- `src/worker/generation-worker.service.ts:510-545`

저장 전 실제 파일 메타데이터와 최소 품질 계약을 확인해야 한다.

### P2. 전역 negative prompt가 컷별 장면과 충돌할 수 있다

negative prompt는 모든 컷에 공통 적용되고, 별도 필드를 지원하지 않는
모델에서는 `Do not include` 문장으로 뒤에 붙는다.

- `src/worker/image-generation.provider.ts:213-225`

카메라, 휴대폰, 거울처럼 어떤 컷에는 필요한 물체가 전역 제외 목록에 있으면
장면과 충돌한다. 촬영자 비노출 같은 구성 규칙도 단순 제외 목록으로
안정적으로 해결할 수 없다.

### P2. 필름 마감이 이미 생성된 필름 질감을 이중 보정할 수 있다

`film` 프리셋은 고정 Kodak Gold 방향 색행렬, 채도 저하, 블랙 리프트,
블러와 256px 반복 그레인을 적용한다.

- `src/worker/film-finish.ts:21-30`
- `src/worker/film-finish.ts:96-143`

최종 프롬프트가 이미 35mm/Kodak 질감을 요구한 경우 인위성이 커질 수 있다.
현재 후보별 `none`과 원본 비교가 있으므로 강제 결함은 아니지만 마감을
자동 품질 향상으로 간주하면 안 된다.

### P2. 운영자 피드백이 다음 생성으로 이어지지 않는다

반려 사유는 액션 로그에만 남고 플래너 입력에 포함되지 않는다. 후보 선택도
어떤 결함 때문에 다른 후보를 골랐는지 기록하지 않는다.

따라서 같은 캐릭터에서 반복되는 다음 문제를 Agent가 학습하지 못한다.

- 제3자 촬영처럼 보이는 구도
- 손·거울·휴대폰의 물리적 모순
- 특정 레퍼런스가 배경이나 의상을 과도하게 복사하는 현상
- 반복되는 생성 모델 artifact

원문 반려 사유를 무제한 메모리로 넣기보다, 운영자가 확정한 캐릭터별
촬영·품질 규칙만 persona 또는 별도 검수 규칙으로 승격하는 방식이 필요하다.

### P2. lease와 스케줄러가 다중 인스턴스에서 중복 실행될 수 있다

기획 lease 갱신과 최종 저장은 자신이 획득한 lease인지 확인하지 않고
`status=generating`만 검사한다.

- `src/worker/draft-worker.service.ts:374-399`
- `src/worker/draft-worker.service.ts:512-521`
- `src/worker/draft-worker.service.ts:539-596`

lease 만료 후 다른 워커가 재claim하면 두 기획이 모두 잡을 만들 수 있다.
`(draftId, sortOrder)` 고유 제약도 없다.

스케줄러도 pending 확인과 draft 생성을 잠금 없이 나눠 수행한다.

- `src/worker/draft-worker.service.ts:979-1027`

현재 단일 프로세스에서는 잠복하지만 rolling deploy나 수평 실행 시 중복
콘텐츠와 비용 문제로 이어진다.

### P3. 구조화 출력은 프롬프트 약속에만 의존한다

플래너와 빌더 모두 일반 chat-completions 요청을 사용하고 JSON Schema
출력 모드를 사용하지 않는다.

- `src/worker/content-planner.ts:90-105`
- `src/worker/image-prompt-builder.ts:90-113`

OpenAI-compatible provider 호환성을 고려해 지원 여부를 확인한 뒤 적용해야
한다.

### P3. 빌더 출력은 샷 ID 없이 배열 순서만 신뢰한다

길이는 검증하지만 같은 개수로 순서를 바꿔 반환하면 감지할 수 없다.

- `src/worker/image-prompt-builder.ts:138-168`

최대 세 컷이라 우선순위는 낮지만, 구조 계약에 `shotId` 또는 `sortOrder`를
넣으면 해결할 수 있다.

### P3. 모델 계열 분류가 문자열 휴리스틱이다

`flux`, `nano-banana/gemini/imagen`, `stable-diffusion`을 모델 ID 문자열로
분류한다.

- `prompts/image-prompt-builder.ts:20-35`

현재 모델에는 맞지만 provider 교체 시 프롬프트 규칙이 조용히 부정확해질 수
있다. 등록된 모델 설정에서 명시적 capability를 관리하는 편이 안전하다.

### P3. 설정 연결 테스트가 실제 모델 조합을 검증하지 않는다

이미지 연결 테스트는 고정 nano-banana 상태 URL로 API 키만 확인한다.

- `src/domain/settings/generation-settings.service.ts:215-250`

edit/T2I 모델 ID 오류, edit 전용 모델의 T2I 폴백과 필수 파라미터 문제는
실행 전 발견하지 못한다.

### P3. 비주얼 레퍼런스 수 표시가 서버 제한과 다르다

UI는 최대 5장으로 표시하지만 서버는 20장까지 허용한다.

- `packages/admin/main.js:2348`
- `src/characters/visual-profile.service.ts:8-10`

직접적인 생성 결함은 아니지만 운영자가 실제 컨텍스트 규모를 오해할 수
있다.

## 5. 현재 존재하는 안전장치

전체 구조가 무방비인 것은 아니다. 다음 동작은 현재 코드에서 확인됐다.

- 활성 페르소나를 정렬해 모두 전달한다.
- 최근 메모리와 게시물을 각각 최대 20개로 제한한다.
- 플래너가 반환한 레퍼런스 ID를 카탈로그 allowlist로 정제한다.
- 샷당 레퍼런스를 최대 3개로 제한한다.
- 이미지 provider 전송 직전 레퍼런스를 최대 10장으로 제한한다.
- 업로드 완료된 레퍼런스만 provider에 보낸다.
- 비공개 S3 레퍼런스를 presigned URL로 전달한다.
- 레퍼런스 유무에 따라 T2I와 edit provider를 분리한다.
- provider request ID를 제출 직후 저장해 자동 재시도의 이중 제출을 줄인다.
- provider 임시 결과를 자사 스토리지에 저장한 뒤 Media로 등록한다.
- 전 샷을 한 번의 빌더 호출로 처리하고 출력 개수 불일치를 거절한다.
- 초안 최초 기획 결과와 생성 잡 저장은 하나의 DB 트랜잭션이다.
- 컷별 최신 잡 선택과 캐러셀 순서는 detail, 집계와 게시에서 일관된다.
- 모든 컷이 완료되고 후보가 선택돼야 승인할 수 있다.
- 게시의 `approved → published` 조건부 전이가 중복 Post 생성을 막는다.
- LLM 로그에 기획·빌드·provider 요청/응답과 입력·출력 미디어를 남긴다.
- 초안 검수 화면은 후보 확대, 원본 비교와 후보별 필터를 제공한다.

이 안전장치들은 형식·저장·승인 무결성에는 도움이 되지만, 현재 핵심 결함인
“최종 프레임에 누가 무엇으로 보이는가”를 표현하지는 못한다.

## 6. 개선 설계

### 6.1 샷 계약 분리

최소 계약은 다음과 같다.

```json
{
  "sortOrder": 0,
  "scene": "최종 이미지 안에 실제로 보여야 하는 내용",
  "captureSetup": "촬영자와 카메라의 위치 및 촬영 방법",
  "characterVisible": false,
  "referenceIds": [],
  "targetModelId": "fal-ai/nano-banana"
}
```

- `scene`: 이미지 모델이 표현할 최종 픽셀만 기술한다.
- `captureSetup`: 시점, 카메라 높이·거리·방향과 촬영 방식을 기술한다.
- `characterVisible`: 캐릭터가 최종 프레임 안에 있는지를 명시한다.
- `referenceIds`: 보이는 캐릭터의 정체성 보존에만 사용한다.
- `targetModelId`: 실제 실행 라우트에 맞는 프롬프트 문법을 선택한다.
- `sortOrder`: 빌더 출력의 컷 순서가 바뀌지 않았는지 확인한다.

화면 비율, 콘텐츠 형식과 게시 시각은 샷별 묘사가 아니라 게시물 공통
기획 컨텍스트로 전달한다.

### 6.2 기획 규칙

- 촬영자가 프레임 밖에 있으면 `scene`의 피사체로 쓰지 않는다.
- 촬영 습관은 캐릭터별 posting persona에서 읽는다.
- 공통 플래너가 특정 촬영 방식을 모든 캐릭터에 강제하지 않는다.
- 셀프타이머, 거울, 고정폰, 동행자 촬영은 확립된 맥락이 있을 때만 쓴다.
- `characterVisible=false`이면 `referenceIds=[]`여야 한다.
- `characterVisible=true`인데 사용 가능한 레퍼런스가 없다면 이를 정상적인
  무인 컷으로 처리하지 않는다.
- 요청한 샷 수와 정확히 일치해야 한다.
- `contentType`, 화면 비율, 계획 게시 시각과 같은 촬영 세션의 연속성
  정보를 함께 고려한다.

### 6.3 프롬프트 빌더 규칙

- 충돌 우선순위를 `최종 프레임과 가시성 → 물리 가능성 → 보이는 정체성 →
  상황·분위기 → 스타일` 순으로 둔다.
- `captureSetup`은 시점과 촬영 기하에만 반영한다.
- 프레임 밖 촬영자를 인물, 손, 신체 일부나 카메라를 든 피사체로 만들지
  않는다.
- `characterVisible=false`이면 LLM과 로컬 폴백 모두 외모를 제외한다.
- `characterVisible=true`이면 실제 프레임에 보이는 외모 섹션만 적용한다.
- 선택 레퍼런스의 구도 설명을 읽어 최종 프롬프트와 충돌을 줄인다.
- edit provider에는 레퍼런스를 정체성에만 사용하고 의상·배경·포즈를 복사하지
  않도록 역할을 명시한다.
- 샷별 실제 `targetModelId`에 맞는 문법을 쓴다.
- 머리·신체·의상을 억지로 재배치하지 않고 자연스러운 가림을 허용한다.

### 6.4 전달과 저장

기획 결과의 구조 필드를 다음 위치에 유실 없이 보존한다.

- 기획 원본: `conceptJson.plan`
- 컷별 실행 메타정보: `paramsJson._shot`
- 운영자 최종 수정: `_shot.effectiveScene` 또는 동등한 명시 필드
- 빌드 모델 스냅샷: `_shot.targetModelId`

이 구조 자체는 기존 JSON 필드를 이용할 수 있어 1차 개선에는 DB 스키마
변경이 필요하지 않다.

재생성·재시도는 원본의 다음 값을 계승해야 한다.

- `paramsJson`
- `candidateCount`
- `inputPrompt`
- `draftId`, `sortOrder`, `originJobId`

실제 실행 결과인 `provider`와 `providerRequestId`는 새 잡에 미리 복사하지
않는다.

### 6.5 레퍼런스 생명주기

- 유지되는 레퍼런스 관계는 삭제·재생성하지 않고 설명과 순서를 보존한다.
- 새 레퍼런스만 캡션 대기 상태로 추가한다.
- 인물 샷은 필요한 레퍼런스 캡션이 준비되지 않았으면 기획을 실패 또는
  보류한다.
- 기획 시 선택한 ID와 실행 시 해결된 ID를 비교한다.
- 인물 샷에서 선택 ID가 누락되면 조용히 T2I로 전환하지 않는다.
- 요청·해결·누락·절단된 ID를 LLM 로그 또는 잡 메타데이터에 남긴다.
- provider 제출 시 실제 라우트와 해결된 레퍼런스 ID를
  `paramsJson._shot.execution`에 저장하고, 검수 화면에서 기획값과 비교한다.
- 기획·실행 불일치는 운영자 경고로만 표시하며 승인 차단 조건으로 사용하지
  않는다.
- `providerConfig`에서 `prompt`, `image_urls`, `num_images`,
  `negative_prompt` 같은 예약 키를 차단한다.

### 6.6 승인과 게시

- 후보 선택과 필터 변경은 `needs_review`에서만 허용한다.
- 승인 순간 선택 결과와 필터를 동결한다.
- 재생성의 상태 전이, 새 잡 생성과 로그를 하나의 트랜잭션으로 묶는다.
- 게시 시 동결된 선택 스냅샷을 사용한다.
- 게시 메모리는 최초 계획이 아니라 최신 선택 잡의 유효 장면을 사용한다.
- 허용한 모든 컷을 bounded summary로 기록한다.

### 6.7 출력 품질 게이트

생성 모델의 미학을 코드 키워드로 판정하지 않는다. 대신 결정적으로 검사할
수 있는 항목만 자동화한다.

- 이미지 디코딩 가능 여부
- 실제 MIME과 확장자
- 폭·높이와 최소 해상도
- 요청한 종횡비와 허용 오차
- 후보 수 부족
- 인물 비노출 샷의 레퍼런스 미전달
- 인물 노출 샷의 필수 레퍼런스 해결 여부

정체성 유사도, 손·거울의 자연스러움과 전체 미학은 후보 비교와 운영 검수
샘플로 평가한다.

## 7. 장소와 의상 컨텍스트

이 항목은 현재 코드에 구현돼 있지 않지만 사용자가 명시한 품질 요구이므로
후속 개선 범위에 포함한다.

### 캐릭터가 반복 방문하는 장소

집, 단골 헬스장, 작업실처럼 캐릭터의 세계관에 귀속된 장소는
캐릭터별 장소 레퍼런스로 관리한다.

- 장소 정체성과 캐릭터의 방문 관계를 보존한다.
- 같은 장소의 다른 구역·시간대는 허용하되 공간 구조가 매번 바뀌지 않게 한다.
- 인물 정체성 레퍼런스와 장소 레퍼런스를 같은 배열에 섞지 않는다.

### 공통 장소 유형

호텔 수영장, 공항 라운지처럼 특정 캐릭터의 소유 장소가 아닌 배경은 공용
장소 카탈로그로 관리한다.

- 캐릭터별로 중복 저장하지 않는다.
- 특정 호텔을 다시 방문하는 설정이 아니라면 하나의 고정 장소처럼 강제하지
  않는다.
- 공용 레퍼런스는 장소 유형과 시각 문법을 제공하고 캐릭터 세계관은
  플래너가 별도로 판단한다.

### 의상

의상은 요일, 장소 ID나 `gym-look` 같은 고정 조합에 매핑하지 않는다.

- 캐릭터별 persona에는 색감, 노출 범위, 실루엣, 브랜드 태도 같은
  선택 규칙만 둔다.
- 실제 착장은 게시물 기획 시점의 일회성 결정으로 만든다.
- 같은 게시물의 연속 컷에는 같은 착장을 유지한다.
- 최근 착장 기록을 참고해 반복을 줄이되, 현실적인 재착용은 허용한다.
- 협찬처럼 외부에서 지정된 착장은 해당 게시물의 명시적 제약으로 처리한다.

## 8. 구현 우선순위

### 1차: 확정적으로 잘못된 생성 차단

1. **완료** — 재생성·재시도에서 `_shot`과 후보 수 보존
2. **완료** — 재생성 상태 전이, 새 잡 생성과 감사 로그 트랜잭션화
3. **완료** — `scene / captureSetup / characterVisible / referenceIds /
   sortOrder / targetModelId` 계약 추가
4. **완료** — 인물 비노출 샷에서 외모와 레퍼런스 제외
5. **완료** — 샷별 실제 생성 모델과 프롬프트 대상 모델 비교·경고
6. **완료** — provider 예약 키 덮어쓰기 차단
7. **완료** — 요청 컷 수·빌더 출력 순서 검증
8. **완료** — 오래된 컷 재생성과 초안 잡의 우회 재시도 차단

### 2차: 레퍼런스와 운영 신뢰성

1. **완료** — 레퍼런스 편집 시 기존 캡션 보존
2. **완료** — 인물 샷의 레퍼런스 준비·누락 정책 확정 및 전 경로 검증
3. **완료** — 운영 화면에 실제 선택·해결 레퍼런스와 라우트 표시
4. 운영에서 local placeholder 차단
5. 승인 시 선택·필터 동결
6. provider 결과 저장 실패 재수용

### 3차: 게시물 전체 핍진성

1. 게시 시각·콘텐츠 형식·화면 비율을 기획과 빌더에 전달
2. 다중 샷 촬영 세션·의상·장소 연속성 계약
3. 실제 최종 장면을 게시 메모리에 반영
4. 장소 전용·공용 레퍼런스 분리
5. 게시물별 의상 결정과 최근 착장 중복 관리
6. 구조적으로 확인 가능한 출력 품질 게이트

### 4차: 규모와 운영 안정성

1. 기획 lease 소유권 토큰과 중복 잡 방지
2. 스케줄러 캐릭터별 직렬화
3. 모델 capability 검증과 설정 연결 테스트
4. 운영자 검수 피드백의 명시적 규칙 승격

## 9. 대표 수용 기준

### 한소이 무인 풍경 컷

- `characterVisible=false`
- `scene`의 주 피사체가 연트럴파크 철길 풍경
- 촬영자와 Canon AE-1은 `captureSetup`에만 존재
- 외모 프롬프트가 최종 prompt에 없음
- 인물 레퍼런스가 provider에 전달되지 않음
- 실제 라우트와 빌더 대상 모델이 T2I로 일치
- 재생성 후에도 위 조건이 유지됨

### 한소이 셀프타이머 인물 컷

- `characterVisible=true`
- 벤치 위 고정 카메라에서 도달 가능한 프레임
- 소이는 정적인 뒷모습 또는 옆모습
- 카메라 위치, 소이의 위치와 프레임 높이가 양립
- 해당 구도에 맞는 레퍼런스만 전달

### 서린 운동 게시물

- 촬영 습관은 서린 persona에서 결정
- 동행 촬영자가 확립되지 않았다면 제3자 follow shot 금지
- 셀카, 거울샷 또는 고정폰 구도에서 손·폰·거울·신체 행동이 양립
- 같은 운동 세션의 컷은 장소·조명·의상이 자연스럽게 이어짐
- 다른 캐릭터에게 서린의 촬영 규칙을 공통 적용하지 않음

### 재생성

- 원본과 동일한 `scene`, `captureSetup`, `characterVisible`,
  `referenceIds`, 화면 비율과 후보 수를 계승
- 운영자가 최종 장면을 바꾸면 명시적인 유효 장면으로 저장
- 무인 컷이 재생성 때문에 edit 라우트로 바뀌지 않음
- 옛 잡에서 재생성해 최신 컷을 덮어쓰지 않음

### 승인과 게시

- 모든 계획 컷 0..N-1에 최신 완료 잡과 선택 후보가 존재
- 승인 후 선택·필터를 변경할 수 없음
- 실제 게시한 선택 결과와 초안 화면이 일치
- 다음 기획 메모리에 실제 게시 장면이 반영됨

## 10. 검증 현황과 후속 계획

1차 구현은 단위 회귀 테스트, 전체 Jest 테스트, 린트와 Nest 빌드로
검증한다. 실제 이미지 후보의 미학·정체성·핍진성 비교는 외부 생성 비용과
운영자 판정이 필요한 별도 수용 검수로 남긴다.

완료한 자동 검증 범위:

1. 플래너 원문에서 최종 화면과 촬영 방법의 구조 분리
2. 자동·수동·위저드 경로의 샷 메타데이터 저장
3. 인물 비노출 샷의 외모·레퍼런스 제외
4. 요청 컷 수와 빌더 출력 순서 검증
5. 최초 생성과 재생성·재시도의 문맥 계승
6. 빌더 대상 모델과 실제 provider 모델 비교 및 비차단 경고
7. 레퍼런스 추가·삭제 후 기존 설명 보존
8. provider 예약 필드 보호
9. 오래된 컷 재생성 및 초안 잡 우회 재시도 차단
10. 인물 노출 샷의 유효 레퍼런스 누락 시 즉시 실패 및 provider 제출 차단

후속 자동 검증 및 제품 작업:

1. 후보 선택 후 승인 시 선택과 필터 동결
2. 이미지 파일·해상도·비율 품질 게이트
3. 실제 최종 장면의 게시 메모리 반영
4. 한소이·서린 대표 장면 후보를 생성해 운영자가 다음을 비교
   - 구도
   - 물리적 가능성
   - 캐릭터 촬영 습관
   - 정체성 일관성
   - 장소·의상·시간대 연속성
   - 장면 충실도

의미 있는 회귀 테스트 대상:

- 인물 없는 샷에서 appearance와 레퍼런스 제외
- 촬영자와 최종 피사체 정보 보존
- 재생성·재시도의 `_shot` 메타데이터 보존
- 샷별 target model과 provider 라우트 불일치 추적
- 레퍼런스 편집 시 설명 보존
- 인물 샷 선택 레퍼런스 누락 시 실패
- provider 예약 필드 보호
- 승인 이후 선택·필터 변경 차단
- 요청 샷 수와 실제 잡 수 일치
- 실제 최종 장면의 게시 메모리 반영

## 11. 후속 구현 전 결정이 필요한 항목

다음은 제품 동작을 바꾸므로 후속 구현 전에 하나씩 결정한다.

1. LLM 프롬프트 빌더 미설정 시 구조 보존 로컬 폴백을 허용할지,
   품질 미보장 오류로 중단할지
2. `reel` 초안을 당분간 거절할지, 별도 이미지 기반 reel 계약을 둘지
3. 후보 수 부족과 종횡비 오차를 경고로 둘지 실패로 둘지
4. 승인 이후 어떤 수정까지 다시 `needs_review`로 되돌려 허용할지
5. 캐릭터 전용 장소와 공용 장소의 저장 단위를 어떻게 정의할지

## 12. 이번 분석에서 제외한 항목

다음은 현재 확인된 결함을 해결하는 선행조건이 아니거나 별도 제품 결정이
필요해 구현 범위에서 제외한다.

- 이미지 생성 provider 자체 교체
- 임베딩·pgvector 기반 대규모 레퍼런스 검색
- 자동 얼굴 인식 또는 생체 특징 점수화
- 완전 자동 미학 점수와 사람 검수 제거
- 캐릭터별 장기 콘텐츠 전략 전체 재설계
