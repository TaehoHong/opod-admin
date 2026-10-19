# 게시물 Agent 관리 API

기본 경로 `/api/admin/v1/post-generation-agents`. 기존 Admin 세션 인증과
변경 요청의 `x-opod-admin` CSRF 헤더를 사용한다. ID는 BIGINT decimal string이다.

| 메서드 | 경로 | 동작 |
| --- | --- | --- |
| GET | `/` | 과거 다섯 단계 설정·출력 규격 조회와 공통 이미지 생성 설정 |
| GET | `/models?cursor=&limit=` | 모델 목록 (cursor pagination) |
| POST | `/models` | type/provider/model 등록 |
| GET | `/:stage/versions?cursor=&limit=` | 해당 단계 이력 |
| POST | `/:stage/versions` | 공통 `generation`만 저장; 기존 LLM 단계는 400 |
| POST | `/:stage/versions/:id/restore` | 공통 `generation`만 복원; 기존 LLM 단계는 400 |

`stage`: `post_plan`, `image_plan`, `image_prompt`, `generation`, `caption`.
기존 Agent는 보관되어 LLM 네 단계의 HTTP 저장·복원과 기존 초안 실행은 거부한다.
이력·설정 읽기는 유지한다. 아래 버전 저장 형식 설명은 공통 generation 설정과
과거 저장 데이터의 해석을 위한 계약이며 보관된 LLM Agent의 실행을 허용하지 않는다.
현재 설정은 단계별 최대 revision이다. 모델 등록은 추가/조회만 제공한다.
현재 버전과 모델 참조·override·지침·출력 규격이 모두 같은 저장 요청은 새 이력을
추가하지 않고 현재 버전을 반환한다. 이 비교는 단계 잠금과 expectedRevision 검사 뒤에 수행한다.
저장된 모델은 수정하지 않으므로 이전 버전 복원 시 공급자/기본 모델도 유지된다.

모델 등록 예시:

```json
{"type":"llm","provider":"openai-compatible","model":"gpt-5-mini"}
```

현재 LLM 공급자는 `openai-compatible`이고 기존 LLM URL/키를 사용한다.
이미지 공급자는 `openai`, `fal`, `opod-flux`, `spicyapi`이며 기존 이미지 model policy와
adapter가 지원하는 조합만 등록/실행한다. URL/키는 기존 설정 화면이 담당한다.
`spicyapi`는 `alibaba/qwen-image-3.0-pro/edit`, `alibaba/qwen-image-3.0/edit`,
`bytedance/seedream-5.0-pro/edit`(2026-10-15 비교용 추가)만 등록할 수 있고, 레퍼런스
없는 컷은 같은 계열의 `/text-to-image`로 실행한다.

저장 예시 (outputSchema에는 GET이 반환한 현재 코드 출력 규격을 전달):

```json
{
  "expectedRevision": 0,
  "aiModelId": "1",
  "model": null,
  "systemPrompt": "이 단계에서 적용할 지침 전문",
  "outputSchema": {"...": "GET의 outputSchema와 동일한 전체 JSON Schema"}
}
```

aiModelId는 필수다. model이 NULL이면 참조 모델의 model을 사용하고, 있으면
그 값을 우선한다. provider는 항상 ai_models.provider에서 읽는다.
LLM 단계는 type=llm, generation은 type=image만 선택한다. LLM 지침은 비어
있을 수 없고 outputSchema는 코드 parser 계약과 같아야 한다. 저장 schema는
StrictJsonAgentClient가 실제 response_format.json_schema.schema에 전달한다.
출력 필드 변경은 코드와 함께 수정해야 하므로 UI에서는 읽기 전용이다.
generation의 systemPrompt/outputSchema는 모두 NULL로 전송한다.

복원 body는 `{"expectedRevision": 3}`이다. DB에 저장된 해당 버전의 지침,
출력 규격, 모델 참조/override를 새 버전으로 복사한다. 코드 지침과 기본값 적용
API/UI는 제공하지 않는다.

최초 미저장 단계는 id=NULL, revision=0, aiModelId=NULL, systemPrompt=NULL이다.
outputSchema는 최초 저장에 필요한 코드 parser 계약을 제공하며 실행 지침의 대체값이 아니다.
LLM 단계는 저장된 지침이 없으면 모델을 호출하지 않고 `needs_configuration`과
`<stage>_prompt_missing` 사유로 중단한다. 목록의 provider/effectiveModel도 미설정이다.
`defaultSystemPrompt`/`defaultOutputSchema` 필드는 제공하지 않는다.
프롬프트가 없는 generation 단계의 공통 이미지 모델 설정은 유지한다.

충돌은 HTTP 409이며 입력을 보존해 최신 설정을 확인한 후 새 expectedRevision으로
재시도한다. 잘못된 ID/유형/지침/규격/모델 조합은 400, 미존재 ID나 다른 단계의
복원 ID는 404다. 변경 이력은 수정/삭제하지 않는다.

자연형 Agent는 초안에 고정한 natural 번들을, 레퍼런스 Agent는 아래 reference 설정
snapshot을 실행한다. 기존 LLM 단계 설정으로 fallback하지 않는다. 이미지 위저드와
공통 generation 설정은 유지한다. 키·URL은 기존 연결 소유자에서 해석하며 초안과
실행 artifact에 secret을 저장하지 않는다.

정본 DDL은 opod-service-backend의
`drizzle/20260928080853_post_agent_prompts/migration.sql`이다.


## 새 Agent 번들

- `GET /api/admin/v1/post-generation-agents/natural/config`: `current` 저장 번들 또는 null,
  명시적 설치용 `starters`를 반환한다. 초안 지침은 런타임 fallback이 아니다.
- `POST /api/admin/v1/post-generation-agents/natural/config`: `expectedRevision`(첫 저장 null),
  `planningAiModelId`, `reviewAiModelId`, `schedulerDefault`와 여섯 단계 `prompts`를 저장한다.
  기획·검수 모델은 LLM이어야 하며 이미지 생성 단계의 저장 모델 버전이 필요하다.
  단계별 출력 schema는 서버 계약으로 고정한다. 저장 결과의 content hash가 revision이다.
  동시에 변경된 revision은 409다. 저장 번들은 기존 단계 지침을 변경하지 않는다.

새 초안은 선택 시 전체 번들을 복사한다. 이전 초안은 이후 설정 저장의 영향을 받지 않는다.
[동작과 단계별 계약](../natural-post-agent.md)에 픽셀 검수·게시 차단·복구 범위를 기록한다.

## 레퍼런스 Agent 설정

- `GET /reference/config`는 `{ current, starters }`를 반환한다. 미저장 current는
  `{ revision: null, selection: { batchSize: 12, maxAttempts: 1 } }`이며 읽기로 저장하지 않는다.
  starters는 세 LLM 단계의 `systemPrompt`와 읽기 전용 `outputSchema`다.
- `POST /reference/config` body는 `expectedRevision`(첫 저장 null), 정수
  `maxAttempts`(1~3), 선택적 `stages`다. batchSize는 서버 상수 12다.
  stages가 있으면 `reference_select`, `image_prompt`, `caption`을 모두 전달하며
  각 값은 `{ aiModelId, systemPrompt }`다. 모델은 LLM이어야 하고 지침은 비공백
  50,000자 이하다. outputSchema/provider/model은 서버가 모델 목록·고정 parser 계약으로 정한다.
- UI는 stages와 함께 `generationAiModelId`를 전달한다. 서버는 이미지 모델 유형을
  검증하고 `{ source: "model", aiModelId, provider, effectiveModel }`을 같은 reference
  설정 CAS에 저장한다. 공통 generation 버전을 만들거나 변경하지 않는다.
  이전 클라이언트가 이 필드를 생략하면 기존 공통 generation 버전을 복사하는 계약을
  유지한다. stages를 생략하면 탐색 횟수만 변경하며, 이때 generationAiModelId는 받지 않는다.
- 저장 결과는 새 UUID revision과 `selection`, 선택적 `stages`, `generation`이다.
  stale revision이나 최초 저장 경쟁은 원문 compare-and-set으로 HTTP 409다.
  잘못된 횟수·모델·지침·누락 단계는 400이다. 키·URL은 반환하지 않는다.
- 새 초안은 `POST /api/admin/v1/drafts`에 `postGenerationAgent: "reference-v1"`을
  명시하고 완전한 설정을 저장한 상태여야 한다. 탐색 횟수만 저장한 설정은 실행에
  충분하지 않다. `referenceAgentConfig`에 revision·selection·세 단계 지침/schema/모델·
  이미지 버전을 고정한다. 이후 설정 변경은 이미 만든 초안에 소급 적용하지 않는다.
- 수동 단계 실행은 `POST /api/admin/v1/drafts/:id/plan`에 `expectedStage`와
  `expectedRevision`(조회한 draft.updatedAt)을 전달한다. 현재 단계/초안 timestamp를
  확인해 변경되었거나 실행 중인 요청을 거부한다(현재 controller는 400). 설정 UUID
  revision과 초안 timestamp는 별개다. 공통 UI의 다음 버튼은 실행이 아닌 단계 이동이다.

재선택/전체 재생성은 `POST /api/admin/v1/drafts/:id/reference/restart`로 요청한다.
body는 `{ target: "reference_select" | "generation", expectedRevision: draft.updatedAt }`다.
expectedRevision은 ISO timestamp이며 stale 초안, 활성 publication/stage lease 또는 현재
queued/running 이미지 잡, 게시/거절된 초안은 거부한다. `reference_select`는 원본 선택과
후속 prompt/이미지/캡션 artifact를 비운다. `generation`은 저장된 prompt/negative·순서·
참조·원본·설정을 그대로 보존하고 prompt revision을 증가시켜 새 이미지 job ID를 만든다.
두 경우 caption/generation artifact와 기존 승인을 무효화하고 해당 단계 pending으로
되돌린다. 실패한 컷만 retry하는 API와 구분하며 UI는 확인 Modal 이후 요청한다.

코드 owner는 `ReferencePostAgentRunner`, `GenerationSettingsService`,
`PostGenerationAgentsController`이며 Repository 변경은 소유 Domain Service를 통해 수행한다.
기존 Agent 원문은 `archive/existing-agent/2026-10-19/`에 보관한다. 자연형 Agent와
공통 이미지 생성 모델 설정은 유지한다. DB E2E·DDL 적용과 실제 공급자 실행은 보류 상태다.


### 관리 화면의 저장 구분

레퍼런스 탭의 이미지 생성 모델 영역에서 이미지 모델을 직접 선택하고
`이미지 모델과 설정 저장`을 누르면 지침·단계 모델·이미지 모델이 한 요청으로 저장된다.
하단 `설정 저장`도 같은 요청을 사용한다. 저장한 모델은 신규 작업에 고정되며,
기존 공통 generation 버전으로 만든 작업은 이전 버전 조회·검증 경로를 유지한다.
새 선택은 AiModelService에서 고정된 ID·유형·공급자·모델명을 확인한 뒤 실행한다.
단계 모델·지침 누락은 저장 버튼 근처 오류 요약에서 해당 입력으로 이동할 수 있다.
탐색 횟수만 저장하거나 최신 설정을 확인해도 편집 중인 단계 값은 유지하며,
단계 저장은 최신 확인한 revision을 기준으로 수행한다.
공통 이미지 모델 편집기에서 모델을 바꾸면 이전 override를 비우며, 변경 없는
공통 설정은 새 이력을 추가하지 않는다.
