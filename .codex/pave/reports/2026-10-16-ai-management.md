# API·모델 관리 / 기능별 모델 설정 구현 검증

계획: [2026-10-16-ai-management](../plans/2026-10-16-ai-management.md)

## 결과

- 시스템 메뉴에 `/ai-management`, `/model-assignments`를 추가했다. 직접 진입/새로고침 경로도 등록했다.
- API 화면은 LLM/이미지 목록과 설정 팝업을 제공한다. 팝업에서 주소·키 교체, 접속 확인, 모델 조회·등록·제거를 처리한다.
- 기능 화면은 기존 5단계, 새 Agent 7단계와 채팅 응답을 독립 저장한다. 적용 범위·변경 확인 카드는 없다.
- 신규 수동/예약 초안과 이미지 잡은 연결·모델 선택을 보관한다. 생성/검수/캡션/채팅 호출이 해당 설정을 사용한다.
- 키 마스킹, 원문 CAS, 사용 중 제거 방지, 과거 잡용 archive와 입력 보존을 적용했다. 신규 DDL·실제 데이터 이관·배포는 수행하지 않았다.

## 변경 파일

- UI: `packages/admin/src/features/ai-management/`, `app/routes.tsx`, `app/AppLayout.tsx`, 기존 Settings/Agent 화면의 안내 링크.
- API: `src/ai-management/`, `src/settings/ai-management.ts`, `generation-settings.service.ts`, `app.module.ts`, `main.ts`.
- 실행: `drafts.service.ts`, `post-pipeline-v3.runner.ts`, `post-production.module.ts`, generation worker와 이미지 adapter의 기본 URL 전달.
- 채팅: `opod-agent/src/provider/db-settings-provider.ts` 및 해당 테스트.
- 계약/지식: `docs/api/admin-ai-management.md`, `docs/api/admin-settings.md`, `docs/natural-post-agent.md`, `docs/07-codebase-guide.md`.

## 확인한 증거

| 확인 | 결과 |
| --- | --- |
| Admin `npm test -- --runInBand` | 60 suites / 708 tests 통과 |
| `npm run admin:check` | 타입 검사 + 25 files / 109 UI tests 통과 |
| `npm run lint`, `npm run format`, `npm run build` | 통과 |
| 전체 AppModule DI 구성 compile | 통과 (DB 연결·worker 시작 없이 확인) |
| Agent `npm test` | 443 통과, 기존 조건부 25 skip |
| Agent `npm run typecheck`, `npm run build`, 변경 파일 Biome lint | 통과 |
| 마지막 키 해석 분기 수정 후 provider 집중 테스트 | 9 통과 |
| 브라우저 | 실제 production build + 실제 관리 Controller/Service + 임시 메모리 repository로 모델 등록 → 캡션 적용 → 새로고침 유지 → 기획 모델 불변 확인 |
| 좁은 화면 | 375px에서 문서 가로 넘침 없음. API 팝업의 키 마스킹·버튼 이름·유형 구분 확인 |
| DB E2E | **미완료**: 로컬 Docker daemon이 응답하지 않아 Testcontainers 준비에서 대기. Desktop 열기·제한 시간 진단 후 작업에서 시작한 대기 프로세스만 종료 |

브라우저 QA는 테스트 데이터만 사용했다. 실 API 유료 생성이나 운영 DB 저장은 실행하지 않았다.
`test/ai-management.e2e-spec.ts`는 추가했으며 Docker가 복구되면 `npm run test:e2e`를 실행해야 한다.

## 병합 전 사람 검토

UI·단위·HTTP·빌드는 검증했다. 공유 설정·인증 키 경계를 변경하므로 병합 전 사람 검토와 DB E2E가 필요하다.

1. `GenerationSettingsService`: 기존 키 참조, CAS, 신규 초안의 선택 보관과 현재 연결의 주소/키 해석.
2. `AiManagementService`: 최초 catalog 해석, 기능별 선택·archive 경계, 비밀값을 반환하지 않는 계약.
3. `DbSettingsProvider`: 다음 채팅 요청부터 선택 적용, 임베딩 설정 분리와 잘못된 DB 설정 차단. Admin과 Agent 배포가 모두 필요하다.

## Knowledge Delta

- **user-confirmed**: 두 화면의 역할, LLM/이미지 구분, 팝업 관리, 기능별 독립 선택, 변경 확인 카드 제외를 API 계약에 기록했다.
- **repo-evidenced**: 기존 settings/model/prompt 소유권, JSON/CAS, 초안/잡 선택 보관과 채팅 consumer를 코드베이스 가이드와 API 계약에 반영했다.
- Docker 미응답은 로컬 검증 제한이며 제품·프로젝트의 일반 규칙으로 승격하지 않았다.
