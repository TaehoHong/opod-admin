# 게시물 Agent 관리 API

기본 경로 `/api/admin/v1/post-generation-agents`. 기존 Admin 세션 인증과
변경 요청의 `x-opod-admin` CSRF 헤더를 사용한다. ID는 BIGINT decimal string이다.

| 메서드 | 경로 | 동작 |
| --- | --- | --- |
| GET | `/` | 다섯 단계 현재 설정 및 출력 규격 |
| GET | `/models?cursor=&limit=` | 모델 목록 (cursor pagination) |
| POST | `/models` | type/provider/model 등록 |
| GET | `/:stage/versions?cursor=&limit=` | 해당 단계 이력 |
| POST | `/:stage/versions` | 새 버전 저장·적용 |
| POST | `/:stage/versions/:id/restore` | 이전 버전을 새 버전으로 적용 |

`stage`: `post_plan`, `image_plan`, `image_prompt`, `generation`, `caption`.
현재 설정은 단계별 최대 revision이다. 모델 등록은 추가/조회만 제공한다.
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

저장한 LLM 지침은 다음 해당 단계 실행부터 적용된다. 이미지 모델은 새 이미지
프롬프트 생성 때 policy를 결정하고 잡의 `_postAgent`에 해당 설정 버전을 기록한다.
이미지 worker는 그 버전으로 실행한다. 이미 생성한 이미지 잡은 이후 설정 변경의
영향을 받지 않는다. 기존 metadata 없는 잡은 기존 공통 이미지 설정을 사용한다.
실행 로그/artifact의 agentConfig에 promptId/revision/aiModelId/provider/model을
기록하며 API secret은 포함하지 않는다. 기존 레거시 파이프라인은 관리 대상이 아니고
현재 PostPipelineV3Runner의 단계들이 관리 대상이다.

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
