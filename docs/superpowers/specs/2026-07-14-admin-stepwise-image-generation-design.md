# Admin 단계형 이미지 생성 설계

Date: 2026-07-14  
Status: Approved for implementation planning

## 목표

`생성 작업` 화면에서 관리자가 이미지 생성의 각 단계를 직접 확인하고 다음
단계로 진행한다. 확인 전에는 프로바이더 요청이나 비용이 발생하지 않아야 하며,
재생성해도 이전 프롬프트와 후보, 비용 이력을 보존해야 한다.

단계는 다음 네 가지로 고정한다.

1. 요청 입력
2. 최종 프롬프트 확인 및 수정
3. 후보 이미지 생성
4. 후보 선택 및 최종 확정

## 범위

포함:

- admin `생성 작업` 화면의 이미지 전용 단계형 생성
- 캐릭터 선택, 이미지 요청, 후보 수 1~4장 입력
- 캐릭터 비주얼 프로필을 반영한 최종 프롬프트 확인 및 수정
- 생성 진행 상태 복원, 후보 비교와 하나의 최종 결과 선택
- 프롬프트와 후보 수를 바꾼 새 생성 회차
- scheduler 기본 비활성화

제외:

- 게시물 기획, 캡션, 해시태그, 게시 승인
- 영상 생성
- 선택 결과의 캐릭터 레퍼런스 자동 등록
- 기존 자동 draft 파이프라인의 재설계

## 핵심 결정

### 기존 GenerationJob을 생성 회차로 사용

별도 session 테이블을 만들지 않는다. 최초 회차와 재생성 회차는 기존
`originJobId` 관계로 연결한다. `GenerationJobOutput`은 회차별 후보를 그대로
보관한다.

`GenerationJobStatus`에 `draft`를 추가한다. `draft`는 프롬프트 확인 대기 상태이며
generation worker가 claim하지 않는다. 관리자가 생성 버튼을 누를 때만 원자적으로
`draft → queued`로 전환한다.

`GenerationJob`에는 다음 필드를 추가한다.

- `inputPrompt String?`: 관리자가 처음 입력한 요청. 기존 잡과 draft 파이프라인 잡을
  호환하기 위해 nullable로 둔다.
- `candidateCount Int?`: 해당 회차가 요청할 후보 수. 단계형 UI에서는 1~4를 반드시
  저장한다. 기존 잡과 자동 draft 잡의 `null`은 `WORKER_CANDIDATE_COUNT`를 사용해
  현재 환경별 동작을 보존한다.

`prompt`는 관리자가 확인한 최종 프롬프트를 저장한다. 프로바이더별 자유 파라미터인
`paramsJson`에는 워크플로 메타데이터를 섞지 않는다.

canonical Prisma schema는 `opod-service-backend`가 소유한다. enum과 필드는 그
스키마에 먼저 추가하고, `opod-admin` 스키마를 동일하게 동기화한다.

### 선택은 생성 완료와 분리

worker가 후보 생성을 완료해도 첫 번째 이미지를 자동 선택하지 않는다.
`GenerationJobOutput.selected`는 모두 `false`, `GenerationJob.outputMediaId`는
`null`로 남긴다.

관리자가 후보를 확정할 때 한 트랜잭션 안에서 다음을 수행한다.

1. 후보가 해당 completed 잡에 속하는지 확인
2. 해당 잡의 기존 `selected` 값을 모두 해제
3. 선택 후보를 `selected=true`로 변경
4. `outputMediaId`를 선택한 media ID로 변경
5. 캐릭터 액션 로그 기록

`completed`이면서 `outputMediaId`가 없으면 후보 선택 단계, 값이 있으면 확정
완료로 해석한다. 상태 enum을 더 늘리지 않는다.

## API

기존 자동 큐 API의 의미는 유지한다. 단계형 UI는 아래 전용 동작을 사용한다.

### `POST /api/generation/image-jobs/draft`

입력:

```json
{
  "characterId": "uuid",
  "inputPrompt": "성수동을 걷는 자연스러운 모습",
  "candidateCount": 3
}
```

서버는 캐릭터의 `appearancePrompt`와 `stylePrompt`를 원본 요청에 조합해 최종
`prompt`를 만들고 `draft` 잡을 생성한다. 비주얼 프로필이 없어도 원본 요청만으로
생성할 수 있다.

### `PATCH /api/generation/jobs/:id/draft`

`draft` 상태에서만 최종 `prompt`와 `candidateCount`를 수정한다. 후보 수는 1~4다.

### `POST /api/generation/jobs/:id/confirm`

`draft → queued` 조건부 전이를 수행한다. 이미 전이된 요청은 현재 잡을 반환해
중복 클릭을 멱등하게 처리한다. worker는 queued 이후에만 프로바이더를 호출한다.

### `POST /api/generation/jobs/:id/select-output`

입력한 `mediaId`를 최종 결과로 선택한다. completed 상태와 해당 잡 소유 후보를
검증한다. 같은 후보의 재선택은 멱등하게 처리한다.

### `POST /api/generation/jobs/:id/regenerate`

completed 또는 failed 잡에서 새 `draft` 회차를 만든다. 기존 최종 프롬프트와 후보
수를 기본값으로 복사하고, 새 잡의 `originJobId`는 직전 회차 ID를 가리킨다. 새
회차는 다시 프롬프트 확인 단계를 거친다.

잡 상세 응답에는 `inputPrompt`, `candidateCount`, `outputMediaId`, 후보 전체와 재생성
계보를 화면이 복원할 수 있는 형태로 포함한다.

## 화면 설계

`생성 작업` 목록의 `새 이미지 생성` 버튼으로 집중형 스테퍼에 진입한다. 별도 모달을
사용하지 않는다.

상단에는 네 단계가 표시되고 현재 단계 하나만 넓게 보여준다.

### 1. 요청 입력

- 캐릭터
- 이미지 요청
- 후보 수 1~4
- `최종 프롬프트 확인` 버튼

### 2. 최종 프롬프트 확인

- 읽기 전용 원본 요청
- 수정 가능한 최종 프롬프트
- 적용될 negative prompt, 레퍼런스 이미지 개수, t2i/edit 모델 경로 안내
- 후보 수 수정
- `이미지 N장 생성` 버튼

이 버튼 전까지 잡은 `draft`라 비용이 발생하지 않는다.

### 3. 후보 생성

queued와 running 상태, 프로바이더, 대기 또는 진행 문구를 표시한다. 화면은 잡
상세를 polling하며 새로고침 후에도 잡 ID로 현재 단계를 복원한다.

### 4. 후보 선택

후보 이미지를 그리드로 표시하고 하나를 선택한다. `최종 확정` 전에는
`outputMediaId`가 없다. 확정 후에는 선택 이미지를 명확히 표시하고
`프롬프트 수정 후 새 회차` 버튼을 제공한다.

이전 회차는 현재 작업 아래에 접어서 표시한다. 펼치면 최종 프롬프트, 후보 수,
후보 이미지, 선택 결과, 비용, 오류를 비교할 수 있다.

목록 행은 raw status 대신 다음 단계 라벨을 우선 표시한다.

- `draft`: 프롬프트 확인
- `queued`: 생성 대기
- `running`: 생성 중
- `completed` + output 없음: 후보 선택
- `completed` + output 있음: 확정 완료
- `failed`: 생성 실패

## scheduler와 worker

`DRAFT_SCHEDULER_ENABLED`의 코드 기본값을 `false`로 바꾸고 로컬 실행 환경에도
`false`를 설정한다. scheduler가 꺼져도 수동으로 만든 draft나 기존 작업을 처리하는
기능은 유지한다.

`WORKER_ENABLED`는 유지한다. generation worker는 `queued` 이미지 잡만 claim하므로
관리자의 확인 전인 `draft` 잡은 처리하지 않는다.

## 오류 처리와 동시성

- 빈 요청과 1~4 범위 밖 후보 수는 draft 생성 전에 거부한다.
- draft 수정은 `draft` 상태에서만 허용한다.
- 확인은 조건부 update로 한 번만 queued로 전환한다.
- 후보 선택은 completed 잡의 소유 후보만 허용한다.
- 생성 실패 시 기존 잡과 오류를 보존하고 새 draft 회차를 만든다.
- 프로바이더 자동 재시도는 기존처럼 같은 잡의 `attemptCount`를 증가시킨다.
- 관리자가 누르는 재생성만 새 행과 `originJobId`를 만든다.
- 새로고침과 브라우저 재진입은 서버의 잡 상태를 기준으로 복원한다.

## 테스트

### 서비스 단위 테스트

- 단계형 draft 생성 시 최종 프롬프트와 후보 수 저장
- draft에서만 프롬프트와 후보 수 수정
- confirm의 원자적·멱등 전이
- completed 잡의 소유 후보만 선택
- 선택 변경 시 selected와 outputMediaId의 일치
- regenerate가 이전 결과를 보존하고 originJobId를 연결

### worker 단위 테스트

- job별 candidateCount가 provider 요청에 전달됨
- 완료 시 후보를 자동 선택하지 않음
- 기존 queued 잡의 null 후보 수는 worker 환경 기본값으로 기존 동작 유지
- draft 잡은 claim하지 않음

### admin UI 테스트

- 잡 상태와 outputMediaId로 네 단계 복원
- 후보 수 1~4 payload
- 확정 전후 버튼과 단계 라벨
- 이전 회차 표시

### E2E 테스트

`요청 입력 → 프롬프트 수정 → confirm → worker 완료 → 후보 선택 → 새 회차 생성`의
API 계약과 상태 전이를 검증한다.

## 완료 기준

- 관리자가 확인 버튼을 누르기 전에는 프로바이더 요청이 발생하지 않는다.
- 각 단계 결과가 화면에 보이고 새로고침 후에도 동일 단계로 복원된다.
- 1~4장의 후보 중 하나만 최종 결과로 확정할 수 있다.
- 재생성 전후의 프롬프트, 후보, 선택, 비용 기록이 모두 남는다.
- scheduler는 기본적으로 꺼져 있고 수동 생성 worker는 정상 동작한다.
- 관련 단위, UI, E2E 테스트와 빌드가 통과한다.
