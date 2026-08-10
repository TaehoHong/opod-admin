# 프롬프트 연구 로그 — 게시물 생성 Agent

게시물 생성 Agent의 프롬프트(`prompts/`)와 평가 루브릭 변경을 실험 기록
방식으로 남긴다. 포트폴리오 정리의 원자료이므로 결과와 실사례를 구체적으로
적는다.

## 기록 규칙

- 프롬프트·루브릭 변경마다 버전을 올리고 아래 템플릿으로 엔트리를 추가한다.
- 버전 체계: 대상별 독립 버저닝 — `planner-vN`, `builder-vN`, `eval-rubric-vN`.
- 결과는 가능한 한 정량으로: 평가 차원별 점수 변화, 검수 거절률, 컷 재생성
  횟수, 캡션 수정률. 정량이 없으면 대표 실사례(draft ID + 발췌)를 남긴다.
- 실패한 실험도 기록한다 — 롤백한 변경과 그 이유가 포트폴리오에서 더 중요하다.

### 엔트리 템플릿

```markdown
## <대상>-v<N> — <한 줄 제목> (YYYY-MM-DD)

- 상태: 적용 중 | 롤백 | 관찰 중
- 가설: 어떤 문제를 어떤 변경으로 개선할 수 있다고 봤는지
- 변경: 추가/수정한 프롬프트 규칙 (핵심 문장 인용 또는 diff 요약)
- 결과: 평가 점수·휴먼 시그널 변화, 대표 사례 (before/after)
- 판정: 유지 / 부분 유지 / 롤백 — 근거
- 다음: 이 결과가 시사하는 후속 실험
```

---

## planner-v1 — 베이스라인 (2026-08-07 기준 현행)

- 상태: 적용 중
- 내용: `prompts/content-planner.ts` — 캐릭터 페르소나·메모리·최근 게시물·
  장소·비주얼 프로필을 입력으로 캡션·해시태그·컷 구성(기본 2컷, 최대 3컷)을
  JSON으로 생성. scene(프레임 안 픽셀)과 captureSetup(프레임 밖 촬영 과정)
  분리 규칙, 레퍼런스 ID 카탈로그 제한 포함.
- 알려진 한계 (품질 개선 문서 및 평가 Agent 설계에서 도출):
  - 캡션 말투가 캐릭터 개별 페르소나와 무관하게 균질해지는 경향
  - AI틱한 상투 문형(정형화된 감탄·마무리 멘트) 발생
  - 정량 측정 수단 부재 → 평가 Agent(eval-rubric-v1)로 계측 예정

## builder-v1 — 베이스라인 (2026-08-07 기준 현행)

- 상태: 적용 중
- 내용: `prompts/image-prompt-builder.ts` — 한국어 장면 설명을 모델 패밀리별
  (flux / nano-banana / stable-diffusion / generic) 작문 규칙에 맞춘 영어
  프롬프트로 변환. 전 컷 배치 1회 호출. 무인 컷의 인물 묘사 재삽입 금지.
- 알려진 한계: 물리적 정합성(카메라·손·거울) 위반이 프롬프트 단계에서
  검출되지 않음 → 평가 Agent의 prompt 평가로 계측 예정.

## eval-rubric-v1 — 평가 루브릭 초판 (2026-08-07)

- 상태: 적용 중 (2026-08-10 재구성, `plan-prompt-evaluation-agent.md` 참조)
- 구성: 기획 평가 8차원 (persona_fit, voice_tone_fit, ai_tell_free,
  memory_continuity, location_coherence, shot_composition, reference_usage,
  caption_quality) + 프롬프트 평가 6차원 (scene_capture_separation,
  physical_consistency, model_family_rules, plan_fidelity,
  reference_alignment, cross_shot_consistency).
- 설계 결정 기록:
  - voice_tone_fit은 페르소나 텍스트만으로 판정 불가 → 최근 게시 캡션을
    평가 입력에 포함해 비교하는 방식 채택
  - ai_tell_free는 AI 티 패턴을 **언어별 패턴 팩**(en, ko, …)으로 분리해
    루브릭 버전과 함께 관리 — 서비스가 글로벌·다국어 타겟임이 확정되며
    한국어 단일 패턴에서 설계 변경(2026-08-07). 영어 팩은 공개 연구 자산
    (Wikipedia AI Cleanup, 과대표현 어휘 목록) 기반, 타 언어는 자체 구축
  - 평가는 비동기 워커로 비차단 실행 (LLM 3연쇄 lease 부담 회피)
  - 프롬프트 평가는 2계층 설계 (`image-prompt-evaluation-agent.md`):
    결정적 결함은 정적 린트로 무비용 검출, LLM은 의미 수준 심사만 담당.
    전 컷 배치 1콜로 컷 간 일관성(cross_shot_consistency)까지 판정.
    정답 신호는 생성 결과(실패율·재생성·후보 선택률)와의 상관으로 계측 —
    차원별 예측력 검증이 루브릭 v2 보정의 근거가 된다.
- 다음: 실제 draft에 대한 점수 분포 확인 → 차원별 변별력 검증,
  휴먼 검수 결과와의 상관으로 루브릭 보정 (v2 후보)
