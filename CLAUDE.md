# PAVE Agent Contract for Claude Code

Claude Code entrypoint for repositories using PAVE.

After reading this file, read in order:

1. `AGENTS.md`
2. `.codex/pave/config.md`
3. `.codex/pave/adapters/claude-code.md`

Use `/pave` when available. The command lives at `.claude/commands/pave.md`.
The shared PAVE source of truth stays in `.codex/pave/`.
Use `.claude/agents/` as a Claude Code adapter copy for bounded PM, planning,
UI/UX, fullstack, and QA subagent discovery.

## 게시물 생성 Agent 문서화 규칙 (포트폴리오용)

게시물 생성 Agent(기획 → 프롬프트 빌드 → 이미지 생성 → 검수 → 게시 → 메모리
파이프라인)와 관련된 모든 작업은 나중에 포트폴리오로 정리할 예정이므로
`docs/`에 세세하게 기록한다.

- 설계 결정은 근거·검토한 대안·트레이드오프와 함께 날짜를 명시해 기록한다.
  아키텍트 관점의 다이어그램(UML 등)을 적극 활용한다.
- 프롬프트(`prompts/`)와 평가 루브릭 변경은 `docs/prompt-research-log.md`에
  버전을 올려(planner-vN / builder-vN / eval-rubric-vN) "가설 → 변경 →
  결과(정량 지표·실사례) → 판정(유지/롤백)" 구조로 연구 기록하듯 남긴다.
  실패·롤백한 실험도 반드시 기록한다.
- 주요 문서: `docs/post-creation-agent-workflow.md`(워크플로우 UML),
  `docs/plan-prompt-evaluation-agent.md`(평가 Agent 설계),
  `docs/prompt-research-log.md`(프롬프트 실험 로그),
  `docs/media-generation-pipeline.md`, `docs/media-generation-quality-improvements.md`
