# API·모델 관리와 기능별 모델 설정 구현

승인 근거: 사용자 확정 v3 시안과 “이 시안대로 … 실제 Admin에 구현해” 요청.
범위: 기존 Admin theme/DataPage 기반 두 화면, 관리 API, 기존 생성·검수·채팅 consumer 연결.
별도 DDL·배포·기존 데이터 재작성은 범위에 없다.

## 확정된 화면 경계 (user-confirmed)

- API 관리 분류는 LLM / 이미지. 모든 상세 설정은 팝업.
- 기존/새 Agent의 각 단계와 채팅은 각각 독립 선택.
- 적용 범위와 변경 확인 카드는 두지 않는다.

## Existing Owner Check (repo-evidenced)

- owner-found: admin_settings 저장/CAS/기존 키 해석 — GenerationSettingsService/Repository.
- owner-found: 지원 모델 검증·불변 등록 — AiModelService / 기존 이미지 모델 정책.
- owner-found: 지침과 출력 규격 — PostAgentPromptService / natural bundle.
- owner-found: 실행 — PostPipelineV3Runner, GenerationWorkerService, DbSettingsProvider.
- owner-absent: API 연결별 모델 등록 목록과 기능별 연결 선택. 기존 설정 owner의 JSON에 추가.

## 실행과 검증

1. 연결/모델·독립 선택 API → 마스킹, 유형 검증, CAS, 사용 중 제거 방지 검사.
2. 두 React 화면·메뉴·직접 진입 → 팝업/필터/적용/409 입력 보존 화면 검사.
3. 새 작업 선택 보관·생성/검수/채팅 연결 → 실제 요청 URL·모델·키와 과거 경로 회귀.
4. lint, unit, Admin check, build, format, DB E2E 및 임시 데이터 브라우저 검증.

지속 지식은 docs/api/admin-ai-management.md와 docs/07-codebase-guide.md에 반영한다.
