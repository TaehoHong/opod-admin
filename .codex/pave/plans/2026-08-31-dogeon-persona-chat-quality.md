# 권도건 DM 페르소나 품질 개선

## 목표

권도건이 짧은 일상 대화에서도 모든 말을 운동·기록·승부의 교훈으로 바꾸지 않고,
상대의 의도와 감정 온도를 먼저 받아 자연스러운 한두 문장으로 답하게 한다.

## 범위 지도

- in-scope: 개발 Admin의 권도건 `voice`, `examples` 블록 개선, 36개 대화
  평가 매트릭스, 개선 과정 문서
- preserve-current-behavior: identity, values, emotions, relationships, boundaries,
  canon memory, Bond 단계, 짧은 plain-text DM, 의료 안전 경계
- deferred: 전체 캐릭터의 canon memory 중복 제거와 recent/canon 분리, 실제 모델
  A/B 자동화, production 배포
- out-of-scope: schema·migration·DDL, 모델·sampling 변경, character memory 삭제,
  게시 파이프라인 변경

## Existing Owner Check

| 동작 | 결과 | 정본 |
| --- | --- | --- |
| 활성 캐릭터 페르소나 작성 | owner-found | 개발 OPOD Admin 캐릭터 페르소나 탭 |
| 채팅 페르소나 로드·조립 | owner-found | `opod-agent`의 `PostgresPersonaStore`, `assembleSystemPrompt` |
| 장기 대화 품질 평가 | owner-found | `opod-agent/evals/` H30 하네스 |
| 권도건 단기 반응 품질 기준 | owner-absent | 이번 개선 문서의 36개 평가 매트릭스 |

기존 H30은 24턴 장기 연속성 인증을 소유한다. 이번 36개 매트릭스는 특정 캐릭터의
짧은 반응을 사람이 검토하기 위한 authoring 기준이며, 별도 자동 평가 엔진을 만들지
않는다.

## 근거와 결정

| ID | 결정 | 근거 | 상태 |
| --- | --- | --- | --- |
| DQ-01 | 사용자 의도·온도를 캐릭터 모티프보다 먼저 받는다 | user-confirmed | active |
| DQ-02 | 가벼운 대화에 운동·기록·승부 비유를 강제하지 않는다 | repo-evidenced | active |
| DQ-03 | 조언 요청이 없으면 코칭·교훈으로 닫지 않는다 | user-confirmed | active |
| DQ-04 | 정확한 사실인 canon 25개는 이번에 삭제하지 않는다 | repo-evidenced | active |
| DQ-05 | exact 생성문 테스트 대신 행동 rubric과 실제 모델 A/B를 쓴다 | repo-evidenced | active |

## Feature Readiness

- actor: 권도건과 DM하는 사용자
- trigger: 인사, 칭찬, 장난, 일상, 감정 공유, 거절, 운동 질문, 메타 질문
- happy path: 발화 의도를 먼저 받고 권도건의 담백한 자신감이 자연스럽게 드러남
- edge cases: 대화 종료 의사, 욕설, 원치 않는 조언, 메모리·페르소나 공개 요구,
  의료 위험 신호, 친밀도보다 앞선 반말
- data rules: Admin의 active ordered block만 수정; canon과 관계 메모리 보존
- acceptance: 36개 매트릭스에서 정확 문장 복제가 아니라 의도 일치, 자연스러움,
  캐릭터다움, 기억 절제, 안전 경계를 평가할 수 있음
- blocking decisions: 0

## 구현 체크리스트

1. 개발 Admin 권도건 `voice`, `examples`
   - 상대 의도 우선, 모티프 절제, 조언·질문 절제, 종료 의사 존중 규칙 추가
   - 일상·칭찬·장난·감정·갈등·메타 질문 예시를 균형 있게 배치
   - 검증: 저장 후 Admin read-back에서 두 블록 내용 일치
2. `../opod-agent/docs/dogeon-persona-improvement-2026-08-31.md`
   - 진단, 변경 원칙, 36개 평가 매트릭스, 채점·A/B 절차, 메모리 판단 기록
   - 검증: 경로·링크·공백 점검과 실제 변경 내용 대조
3. `opod-agent` 검증
   - `npm test -- src/chat/system-prompt.test.ts`
   - `npm run lint`, `npm test`, `npm run build`

## Test Value Gate

확률적 모델의 exact 답변을 고정하는 단위 테스트는 자연스러운 변형을 실패로 만들고 실제
품질 저하를 잡지 못한다. 기존 system prompt 조립 테스트로 블록 전달 계약을 보호하고,
36개 상황은 동일 입력 A/B와 rubric 평가에 사용한다. 실제 candidate/simulator/judge 실행은
Agent endpoint와 역할별 모델 설정이 있는 환경에서 수행한다.

## 승인

- 구현 승인: 2026-08-31 사용자 `진행하고 페르소나 개선 과정을 정리한 문서 만들어`
- 외부 write: 개발 Admin의 권도건 `voice`, `examples` 저장
- DDL·삭제·production 배포: 없음

## 구현 결과

- 개발 Admin의 권도건 `voice`를 상대 의도 우선, 모티프·조언·질문 절제,
  종료 의사 존중, 기억 절제 규칙으로 갱신했다.
- 첫 개선에서 `examples`를 운동 중심 17개에서 27개 단문 모범답안으로 늘렸으나,
  사용자 리뷰에서 자연스러운 대화 리듬을 만들기 어렵다는 이유로 기각됐다.
- 평가용 36개 probe는 프롬프트 밖에 유지하고 production `examples`는 8개 다중 턴
  장면으로 줄이는 교정안을 작성했다. Admin 활성 블록 교체는 브라우저 연결 대기 중이다.
- identity, values, emotions, relationships, boundaries와 기존 character memory
  25개는 변경하지 않았다.
- Agent 문서에 36개 probe, 5축 rubric, 전후 3회 A/B 절차와 메모리 후속 판단을
  기록했다.

## 검증 결과

- Admin 새로고침 후 read-back: 첫 개선안의 `voice`, 27개 단문 `examples` 저장 확인
- Admin memory read-back: 추가 입력 필드를 제외한 기존 25개 유지
- `npm test -- src/chat/system-prompt.test.ts`: 12/12 통과
- `npm run eval:validate`: H30 8개 fixture 검증 통과
- `npm run lint`: 통과
- `npm test`: 265/265 통과, 환경 의존 14개 skip
- `npm run build`: 통과
- Agent·Admin `git diff --check`: 통과
- 실제 36-probe A/B는 `EVAL_TARGET_URL`과 역할별 모델 설정이 없어 미실행. 품질
  향상 수치는 아직 검증되지 않았으며, authoring 반영과 실행 절차까지만 완료했다.
- 교정된 8개 다중 턴 `examples`는 현재 Browser 연결이 없어 Admin write/read-back을
  완료하지 못했다.
