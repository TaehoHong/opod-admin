# PAVE Runtime

이 프로젝트는 **Plan, Approve, Verify, Execute**를 뜻하는 PAVE를 사용한다.

PAVE는 AI 개발 작업이 명시적인 제품 결정, 작은 유지보수 가능한 변경과
최신 검증 근거를 따르도록 한다.

English documentation: [README.md](README.md)

## 사용법

Codex:

```text
$pave:pave 이 기능 구현해줘
$pave:pave 이 버그 원인을 찾고 고쳐줘
$pave:pave 현재 변경사항 리뷰해줘
$pave:pave 이전 작업 이어서 진행해줘
```

Claude Code:

```text
/pave 이 기능 구현해줘
/pave 이 버그 원인을 찾고 고쳐줘
/pave 현재 변경사항 리뷰해줘
/pave 이전 작업 이어서 진행해줘
```

## 작업 흐름

1. `AGENTS.md`, `CLAUDE.md`, `.codex/pave/config.md`와 해당 adapter를 읽는다.
2. 코드 작업이면 `docs/07-codebase-guide.md`를 읽고 target, 직접 의존
   코드, 관련 테스트와 현재 canonical example만 먼저 확인한다.
3. 제품 동작, 보안, 데이터, 비용, 권한, 계약 또는 아키텍처를 크게 바꾸는
   미확정 결정만 질문한다. 작고 되돌릴 수 있는 구현 세부사항은 승인된
   규칙 안에서 판단한다.
4. 명시적으로 요청된 저위험 소규모 변경만 hard limit 안에서 fast path를
   사용한다.
5. 그 외에는 유용한 계획을 만들고 코드·테스트 수정 직전에 한 번만 종합
   승인을 받는다.
6. 실제 동작을 보호하는 테스트만 추가한다.
7. 구현, 리뷰와 위험도 기반 최신 검증을 수행한다.
8. 결과, 검증 근거와 잔여 위험을 보고한다.

프로젝트 초기화에서는 프로젝트 전체 규칙만 정한다. 기능별 세부 동작은
해당 기능을 구현할 때 정한다.

## Codex와 Claude Code

| 항목 | Codex | Claude Code |
| --- | --- | --- |
| 호출 | `$pave:pave ...` | `/pave ...` |
| 먼저 읽는 파일 | `AGENTS.md` | `CLAUDE.md`, 그 다음 `AGENTS.md` |
| runtime 경로 | `.codex/pave/` | `.codex/pave/` |

## 파일

- `config.md`: repository 전용 PAVE 정책
- `../../docs/07-codebase-guide.md`: 현재 소유권과 검증 인덱스
- `plans/`: 필요한 경우의 구현 계획
- `reports/`: 필요한 경우의 완료·blocked 보고서
- `templates/`: 문서 template
- `adapters/`: 실행 환경별 안내

## 상태 확인

Codex에서 다음을 요청한다.

```text
$pave:doctor
```

plugin terminal fallback:

```bash
./scripts/doctor.js <repo-path>
```
