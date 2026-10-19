# API · 모델 관리 / 기능별 모델 설정

## 책임과 화면

- `/ai-management`: LLM / 이미지별 API 목록. 접속 정보·인증 키·모델 등록·제거·접속 확인은 팝업에서 관리한다.
- `/model-assignments?feature=natural.caption`: 기능 하나의 현재 설정과 API·모델 선택을 표시한다. 각 단계는 독립적으로 저장하며 적용 범위나 변경 비교 카드는 두지 않는다.
- 기존 Agent의 5단계, 새 Agent의 7단계, 캐릭터 채팅 응답을 각각 선택한다. 사진 자연스러움과 요구사항 검수도 별도 선택이다.

`AiManagementService`는 settings/model/prompt Domain Service를 조합한다.
`GenerationSettingsService`가 기존 `admin_settings`의 `ai.management.v1` JSON을 소유하고,
`GenerationSettingsRepository.compareAndSetValue`가 advisory lock + 원문 비교로 동시 변경을 막는다.
모델 등록은 기존 `AiModelService`의 공급자·모델 검증과 불변 `ai_models` 행을 사용한다.
새 테이블이나 DDL은 없다.

## HTTP 계약

모든 경로의 prefix는 `/api/admin/v1/ai-management`다. Admin 세션 cookie가 필요하며,
변경·검사 요청은 기존 `x-opod-admin` / Origin 검사를 통과해야 한다.

| 메서드 | 경로 | 동작 |
| --- | --- | --- |
| GET | `/` | 마스킹된 연결, 등록 모델, 기능 선택, 최근 변경 이력 |
| POST | `/connections` | API 연결 추가 |
| PUT | `/connections/:id` | API 주소·인증 키 변경 |
| DELETE | `/connections/:id` | 미사용 연결을 목록에서 제거 |
| POST | `/connections/:id/models` | 정확한 모델 ID 등록 |
| DELETE | `/connections/:id/models/:modelId` | 미사용 모델 제거 |
| PUT | `/features/:id` | 해당 기능의 `connectionId` / `modelId`만 변경 |
| POST | `/connections/:id/test` | 접속·인증 또는 LLM 모델 호출 검사 |
| POST | `/connections/:id/discover-models` | OpenAI 호환 `/models` 목록 조회 |

저장·제거 요청은 `expectedRevision: string | null`이 필수다. 아직 JSON을 저장하지 않은
초기 조회는 `revision: null`이다. 다른 저장이 먼저 완료됐으면 409이며 입력값을 유지한 채
최신 revision을 다시 읽어 재시도한다. 저장 시 전체 마스킹 view를 반환한다.
검사·목록 조회는 저장하지 않으며 현재 팝업의 미저장 `apiUrl` / `apiKey`를 받을 수 있다.

연결 입력: `type`, `provider`, `apiUrl`, 선택적 `apiKey`. 유형·공급자는 등록 후 변경할 수 없다.
LLM은 OpenAI 호환 API, 이미지는 기존 openai/spicyapi/fal/opod-flux adapter를 지원한다.
URL은 인증 정보·쿼리·fragment를 금지하며 이미지 API는 HTTPS가 필요하다.
LLM 기본 URL 또는 `/chat/completions` URL을 받아 기본 URL로 정규화한다.
이미지 모델은 기존 모델 정책에 구현된 정확한 공급자/모델 조합만 등록할 수 있다.

인증 키는 응답에 `{ set, last4? }`만 포함한다. 빈 교체 입력은 기존 키를 유지한다.
최초 조회는 기존 설정·모델·Agent 버전을 읽어 표시하며 DB를 쓰지 않는다.
기존 키는 `legacyKey` 참조로 유지해 환경변수의 비밀값을 최초 저장 때 DB에 복사하지 않는다.
채팅은 DB 키만 사용하므로 환경변수에만 있는 연결을 채팅에 적용하려면 팝업에서 키를 저장해야 한다.
provider 응답 원문이나 인증 키를 검사 오류·변경 이력에 반환하지 않는다.

LLM 모델 호출 확인은 작은 completion을 사용한다. 이미지 검사는 생성 요청 없이 접속·인증만
확인하며 모델 생성 성공을 보증하지 않는다. `/models` 조회와 실제 호출 성공도 구분한다.
메인 목록의 `설정됨`은 주소·인증 설정 여부이며 실시간 연결 상태가 아니다.

## 실행과 호환

수동·예약 초안 생성 시 `conceptJson.aiModelAssignments`에 당시 연결 ID·모델 ID·공급자·모델명을
보관한다. 키는 포함하지 않는다. 기존/새 Agent의 LLM 단계와 새 Agent의 두 사진 검수는 이 선택을
우선한다. 저장된 지침·schema·natural bundle은 기존 owner와 검증을 유지한다.
기능별 설정은 이후 새 작업부터 적용되며 기존 초안·잡의 모델을 바꾸지 않는다.
설정이 없는 과거 초안은 기존 prompt/bundle/settings 실행 경로를 유지한다.

이미지 프롬프트 정책도 선택된 generation 모델을 사용하고 생성 잡에 `_aiSelection`을 보관한다.
worker는 이 선택을 읽어 해당 연결의 URL·키로 호출한다. 연결 URL·키 교체는 같은 연결을 사용하는
작업에 반영된다. 목록 제거는 내부 archive이므로 과거 잡의 연결 참조는 유지된다.
현재 기능이 사용하는 API·모델은 다른 선택으로 변경하기 전에는 제거할 수 없다.

`opod-agent/src/provider/db-settings-provider.ts`는 매 요청 DB JSON의 `chat.response`를 읽는다.
선택 변경은 다음 요청에 반영하며 임베딩 설정은 기존 owner를 유지한다.
DB 조회 실패나 잘못된 선택은 이전 provider로 우회하지 않고 실패한다.
기존 설정/Agent 화면의 기본 모델은 기능별 선택보다 후순위다.

## 회귀 검증

- `src/ai-management/*.spec.ts`: 키 마스킹, 독립 변경, 연결별 모델 검증, CAS, archive, 실제 URL 전달, 인증/CSRF/DTO.
- `test/ai-management.e2e-spec.ts`: Testcontainers DB 저장·재조회와 실행 resolver 계약.
- `post-pipeline-v3.runner.spec.ts`: 검수 두 단계와 캡션의 독립 모델·API 호출 및 과거 경로.
- `packages/admin/src/features/ai-management/AiManagement.test.tsx`: 팝업 등록, 유형 분리, 기능 독립 변경, 409 입력 보존.
- `opod-agent/src/provider/db-settings-provider.test.ts`: 채팅 선택 변경, DB 키 해석, 임베딩 분리, 실패 시 차단.
