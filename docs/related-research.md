# 관련 연구 조사 — 게시물 생성 Agent

조사일: 2026-08-07. 게시물 생성 Agent의 각 구성요소와 맞닿은 논문·아티클을
4갈래(콘텐츠 기획·페르소나 / 이미지 프롬프트 / 평가·자기개선 / 캐릭터
일관성·메모리)로 병렬 조사해 파이프라인 단계별로 매핑했다. 모든 항목은
검색으로 실존 확인함.

## 파이프라인 단계 ↔ 연구 영역 매핑

| opod 단계 | 연구 영역 | 절 |
|---|---|---|
| ① 기획 (플래너 LLM) | plan-then-write, 롤플레이 LLM, 버추얼 인플루언서 | 1 |
| ① 기획 — ai_tell_free 루브릭 | AI 텍스트 탐지·휴머나이징 | 2 |
| ② 프롬프트 빌드 (빌더 LLM) | T2I 프롬프트 최적화, 모델별 프롬프팅, 교차언어 | 3 |
| ④ 이미지 생성 (레퍼런스 편집) | 주체 일관성 생성, 스토리 일관성 | 4 |
| ④ 후보 N장 → ⑥ 선택 | Best-of-N 선택·선호 모델 | 5 |
| ⑧ 메모리 → 다음 기획 | 에이전트 장기 메모리 | 6 |
| 평가 Agent 전체 | LLM-as-judge, 루브릭 평가, 프롬프트 자기개선 | 7 |

---

## 1. 콘텐츠 기획 · 페르소나 (① 기획)

### Plan-then-Write 계열 — "기획 먼저" 아키텍처의 근거

- **Plan-and-Write** (Yao et al., AAAI 2019, [arXiv:1811.05701](https://arxiv.org/abs/1811.05701)) — 스토리라인 계획 후 본문 생성하는 2단계 패러다임의 원전. 명시적 기획이 다양성·일관성을 높임. opod의 기획→실행 분리 구조의 근본 인용.
- **Re3** (Yang et al., EMNLP 2022, [arXiv:2210.06774](https://arxiv.org/abs/2210.06774)) — 매 생성 호출에 "계획 + 현재 상태"를 주입하는 루프. opod가 페르소나+최근 게시물 상태를 매 기획에 주입하는 것과 동형.
- **DOC** (Yang et al., ACL 2023, [arXiv:2212.10077](https://arxiv.org/abs/2212.10077)) — 상세 아웃라인 제어로 일관성 +22.5%. 창작 부담을 기획 단계로 옮기는 설계의 정량 근거.
- **RecurrentGPT** (Zhou et al., 2023, [arXiv:2305.13304](https://arxiv.org/abs/2305.13304)) — 단기/장기 메모리 요약을 자연어로 갱신하며 이어쓰는 패턴. 파인튜닝 없는 연속 게시물 스트림 유지에 참고.
- **A Survey on LLMs for Story Generation** (Findings of EMNLP 2025) — 기획·에이전트 기반 창작 기법의 최신 지도.

### 롤플레이 · 페르소나 일관성 — voice_tone_fit 루브릭의 근거

- **Generative Agents** (Park et al., UIST 2023, [arXiv:2304.03442](https://arxiv.org/abs/2304.03442)) — 메모리 스트림(최근성×중요도×연관성 검색) + 반추 + 계획. opod 캐릭터 에이전트의 아키텍처 청사진 — "행동이 게시물인 generative agent".
- **Character-LLM** (Shao et al., EMNLP 2023, [arXiv:2310.10158](https://arxiv.org/abs/2310.10158)) — 캐릭터 프로필을 경험 데이터로 변환해 학습. "경험/메모리가 캐릭터를 만든다"는 아이디어가 opod 메모리 설계와 상통.
- **RoleLLM** (Wang et al., Findings of ACL 2024, [arXiv:2310.00746](https://arxiv.org/abs/2310.00746)) — 롤 프로필 구축→말투 모방 프롬프팅 4단계 + RoleBench 벤치마크. 페르소나 조건화 층의 템플릿.
- **RPLA Survey** (Chen et al., 2024, [arXiv:2404.18231](https://arxiv.org/abs/2404.18231)) — 롤플레이 언어 에이전트 분류 체계. 관련 연구 절의 표준 지도.
- **Measuring and Controlling Persona Drift** (Li et al., 2024, [arXiv:2402.10962](https://arxiv.org/abs/2402.10962)) — 8턴 내 페르소나 드리프트 정량화. 정적 페르소나 프롬프트만으로는 부족하다는 경고 — voice_tone_fit 평가에 최근 캡션을 포함시킨 설계의 근거.
- **Identity Drift in LLM Agents** (2024, [arXiv:2412.00804](https://arxiv.org/abs/2412.00804)) — 페르소나 부여만으로 정체성 안정성이 보장되지 않음을 9개 모델에서 확인.
- **MINDECHO** (2024, [arXiv:2407.05305](https://arxiv.org/abs/2407.05305)) — 인플루언서(KOL) 전용 롤플레이 에이전트. opod 캐릭터 클래스와 가장 직접 겹치는 페르소나 연구.

### 버추얼 인플루언서 — 제품 도메인 근거

- **Lil Miquela 정체성 수행 분석** (AI & Society, 2025) — 가상 인플루언서 정체성이 게시물 전반에서 어떻게 일관되게 수행되는지 법의학적 분석. opod가 자동화하려는 대상 그 자체의 연구.
- **How Real Is Real Enough?** (Psychology & Marketing, 2024) / **Emotional Display와 참여도** (JRCS, 2023, Lil Miquela 1,028장 분석) / **Human-Like VI Content** (CHB:AH, 2024) — 인간다움 정도·감정 표현이 참여도를 좌우한다는 실증. 컷 기획의 감정 구성에 참고.
- **Aitana López 사례** (Euronews, 2023-24) — SD+LoRA 기반 상업 파이프라인 실증(월 €3-10K). **Meta AI 계정 개방과 반발** (Forbes, 2025-01) — 플랫폼 라벨링 규범과 진정성 반발 리스크.
- **OASIS** (2024, [arXiv:2411.11581](https://arxiv.org/abs/2411.11581)) — 백만 LLM 에이전트 소셜 시뮬레이션. **Social Simulacra** (Park et al., UIST 2022) — LLM 페르소나의 소셜 행동 생성 가능성의 선행 증명.

## 2. AI 티 제거 (ai_tell_free 루브릭)

- **Why Does ChatGPT "Delve" So Much?** (COLING 2025, [arXiv:2412.11385](https://arxiv.org/abs/2412.11385)) — LLM 과대표현 어휘 21개 식별, 원인으로 RLHF 지목. 인용 가능한 어휘 차단 목록.
- **Excess Vocabulary** (Kobak et al., Science Advances 2025, [arXiv:2406.07016](https://arxiv.org/abs/2406.07016)) — 1,500만 초록 분석으로 AI 문체의 통계 시그니처 정량화. ai_tell_free가 억제하려는 신호의 측정 방법론.
- **Wikipedia: Signs of AI Writing** (WikiProject AI Cleanup, 2023-25) — 실무자가 수천 건에서 추린 AI 티 체크리스트(3의 법칙, 상투적 강조, 홍보 톤). **평가 프롬프트의 네거티브 제약으로 직접 변환 가능한 최고의 실무 자료.**
- **숙련 사용자는 AI 글을 정확히 탐지한다** (Russell et al., 2025, [arXiv:2501.15654](https://arxiv.org/abs/2501.15654)) — 진짜 적수는 분류기가 아니라 눈썰미 있는 SNS 사용자라는 근거. 이들이 쓰는 단서 목록이 실행 가능한 문체 제약.
- **Paraphrasing Evades Detectors** (Krishna et al., NeurIPS 2023, [arXiv:2303.13408](https://arxiv.org/abs/2303.13408)) / **RAID 벤치마크** (ACL 2024, [arXiv:2405.07940](https://arxiv.org/abs/2405.07940)) / **AuthorMist** (2025, [arXiv:2503.08716](https://arxiv.org/abs/2503.08716)) — 패러프레이즈·RL 기반 휴머나이징의 효과와 한계.
- **LLM 게시물 인지 실험** (2024, [arXiv:2409.06653](https://arxiv.org/abs/2409.06653)) — 1,000+명 대상, SNS 환경에서 LLM 게시물 식별 가능성 실증.

## 3. 이미지 프롬프트 생성 · 최적화 (② 프롬프트 빌드)

### 자동 프롬프트 리라이팅 — 빌더 LLM의 학계 대응물

- **Promptist** (Hao et al., NeurIPS 2023, [arXiv:2212.09611](https://arxiv.org/abs/2212.09611)) — 평문→모델 선호 프롬프트 변환을 SFT+RL로 학습한 원전. opod 빌더가 수행하는 기능 그 자체.
- **DALL-E 3 기술 보고서** (Betker et al., OpenAI 2023) — 추론 시 GPT-4가 사용자 프롬프트를 학습 분포에 맞는 상세 캡션으로 "업샘플링". LLM 리라이터를 이미지 모델 옆에 두는 설계의 산업 표준 선례.
- **PromptEnhancer** (Tencent Hunyuan, 2025, [arXiv:2509.04545](https://arxiv.org/abs/2509.04545)) — T2I 실패 지점 24개 분류 기반 보상으로 학습한 CoT 리라이터. 모델 패밀리 전속 리라이터 LLM의 최신 사례.
- **OPT2I** (Meta AI, TMLR 2024, [arXiv:2403.17804](https://arxiv.org/abs/2403.17804)) — 미학이 아닌 **프롬프트-이미지 충실도**를 최적화하는 LLM 반복 리라이팅. plan_fidelity 차원과 목표가 일치.
- **FPA** (TikTok, 2024, [arXiv:2412.08639](https://arxiv.org/abs/2412.08639)) — 반복 최적화를 1패스 LLM 호출로 증류. opod의 배치 1콜 설계와 같은 지향.
- **BeautifulPrompt** (Alibaba, EMNLP 2023 Industry) — 산업 배포 사례. 문서화된 실패 모드(사용자 의도 이탈)가 opod가 관리할 리스크와 동일.
- **DiffusionGPT** (ByteDance, 2024, [arXiv:2401.10061](https://arxiv.org/abs/2401.10061)) — "어떤 모델 + 어떤 프롬프트 형태"를 LLM이 공동 결정. opod의 t2i/edit 라우팅 + 모델별 빌드와 대응.
- **Idea2Img** (Microsoft, ECCV 2024, [arXiv:2310.08541](https://arxiv.org/abs/2310.08541)) — LMM이 특정 이미지 모델의 프롬프팅 버릇을 상호작용으로 학습. 모델 패밀리별 템플릿 튜닝에 응용 가능.
- **ChatGen** (CVPR 2025, [arXiv:2411.17176](https://arxiv.org/abs/2411.17176)) — 자유 입력→프롬프트+모델 선택+설정의 "Automatic T2I" 문제 정식화 + 벤치마크.

### 모델 패밀리별 프롬프팅 — imageModelFamily() 분기의 근거

- **FLUX 공식 프롬프팅 가이드** (Black Forest Labs, docs.bfl.ml) — FLUX/Kontext의 자연어 문단형 프롬프팅 공식 규범.
- **FLUX vs SD 프롬프팅 차이** (실무 가이드 다수, 2025) — T5 인코딩 기반 FLUX에서는 SD식 콤마 태그·품질 부스터("masterpiece, 8k")가 무효하거나 유해. **패밀리별로 다른 영어 문체가 필요하다는 실무 증거.**
- **Prompt Modifier 분류학** (Oppenlaender, 2022, [arXiv:2204.13988](https://arxiv.org/abs/2204.13988)) / **CHI 2022 프롬프트 설계 가이드라인** (Liu & Chilton) — SD 시대 수식어 어휘 체계와 "키워드 선택이 핵심 레버"라는 HCI 실증.

### 교차언어 (한국어 장면 → 영어 프롬프트)

- **Translation-Enhanced Multilingual T2I** (ACL 2023, [arXiv:2305.19216](https://arxiv.org/abs/2305.19216)) — translate-then-generate 설계 선택지의 체계적 정량화. opod 설계의 학술 근거.
- **NeoBabel** (2025, [arXiv:2507.06137](https://arxiv.org/abs/2507.06137)) — 번역 파이프라인의 "의미 드리프트"(문화 특수 의미 소실) 리스크를 명명한 반론. 한국어 문화 맥락 보존이 빌더의 명시적 과제임을 시사.
- **한국어 일기→영어 프롬프트 파이프라인** (2026, [arXiv:2606.05816](https://arxiv.org/abs/2606.05816)) — Qwen3-8B로 한국어를 구조화된 영어 프롬프트(장면·분위기·조명)로 변환. **가장 직접 비교 가능한 공개 시스템.**

### 물리·공간 정합성 (physical_consistency 차원의 근거)

- **T2I-CompBench/++** (NeurIPS 2023 / TPAMI 2025, [arXiv:2307.06350](https://arxiv.org/abs/2307.06350)) — 구성적 프롬프트 표준 벤치마크. 패밀리별 프롬프트 개선 효과 측정의 잣대.
- **SPRIGHT** (ECCV 2024, [arXiv:2404.01197](https://arxiv.org/abs/2404.01197)) — 명시적 공간 언어가 공간 정확도를 견인. 빌더가 카메라 위치·구도를 명시적으로 쓰게 하는 설계의 근거.
- **Commonsense-T2I** (2024, [arXiv:2406.07546](https://arxiv.org/abs/2406.07546)) / **PhyBench** (2024, [arXiv:2406.11802](https://arxiv.org/abs/2406.11802)) — 거울·반사·광학 등 암묵적 물리에서 SOTA 모델도 자주 실패하며, **프롬프트에 물리 원리를 명시하면 개선됨**. 거울 셀피·손 정합성 문제의 학술 근거.

## 4. 캐릭터 일관성 이미지 생성 (④ 레퍼런스 기반 생성)

- **FLUX.1 Kontext** (Black Forest Labs, 2025, [arXiv:2506.15742](https://arxiv.org/abs/2506.15742)) — 레퍼런스 이미지 편집으로 캐릭터 일관성을 유지하는 플로우매칭 모델. **opod 아키텍처와 가장 가까운 공개 시스템** — 반복 편집 체인에서 일관성이 열화된다는 발견 포함(재생성 정책에 시사점).
- **DreamBooth** (Google, CVPR 2023, [arXiv:2208.12242](https://arxiv.org/abs/2208.12242)) — 캐릭터당 파인튜닝 접근의 원전. opod가 회피한 대안(캐릭터당 학습 비용)의 대표.
- **IP-Adapter** (Tencent, 2023, [arXiv:2308.06721](https://arxiv.org/abs/2308.06721)) — 레퍼런스 조건 생성의 표준 어댑터. **InstantID** (2024) / **PhotoMaker** (CVPR 2024) — 단일/다중 레퍼런스 얼굴 정체성 보존.
- **The Chosen One** (SIGGRAPH 2024, [arXiv:2311.10093](https://arxiv.org/abs/2311.10093)) — 레퍼런스가 없는 상태에서 일관 정체성을 수렴시키는 자동 파이프라인. 신규 캐릭터 부트스트랩 단계에 참고.
- **ConsiStory** (NVIDIA, SIGGRAPH 2024) / **StoryDiffusion** (NeurIPS 2024, [arXiv:2405.01434](https://arxiv.org/abs/2405.01434)) / **One-Prompt-One-Story** (ICLR 2025) — 학습 없는 어텐션 공유로 컷 간 일관성. 한 게시물 내 멀티컷 일관성(cross_shot_consistency)의 생성 측 대응 기법.

## 5. Best-of-N 후보 선택 (④ 후보 생성 → ⑥ 검수 선택)

- **PickScore / Pick-a-Pic** (NeurIPS 2023, [arXiv:2305.01569](https://arxiv.org/abs/2305.01569)) — 실사용자 선호 50만 쌍으로 학습한 후보 랭킹 모델. **휴먼 후보 선택의 자동화 대체재 표준** — 검수 부담 축소의 후속 후보.
- **ImageReward** (NeurIPS 2023, [arXiv:2304.05977](https://arxiv.org/abs/2304.05977)) / **HPSv2** (2023, [arXiv:2306.09341](https://arxiv.org/abs/2306.09341)) — T2I 선호 보상 모델 계보. **LAION Aesthetics** — 최저가 미학 필터.
- **Inference-Time Scaling for Diffusion** (NYU/DeepMind, 2025, [arXiv:2501.09732](https://arxiv.org/abs/2501.09732)) — Best-of-N을 검증자 유도 탐색으로 일반화. N만 늘리는 것보다 검증자 선택이 중요하며, 검증자 해킹 실패 모드도 경고.

## 6. 에이전트 장기 메모리 (⑧ 메모리 반영)

- **Generative Agents** (1절 참조) — 메모리 스트림 + 반추 + 계획. opod의 메모리→기획 루프의 직접 원형.
- **MemGPT** (UC Berkeley, 2023, [arXiv:2310.08560](https://arxiv.org/abs/2310.08560)) — OS식 계층 메모리(코어/아카이브) 자기 관리. 무한 게시 이력에서 캐릭터 사실 일관성 유지 패턴.
- **Mem0** (2025, [arXiv:2504.19413](https://arxiv.org/abs/2504.19413)) — 추출→ADD/UPDATE/DELETE 연산으로 모순 없는 압축 메모리. 게시별 경험을 정리·통합하는 프로덕션 패턴 — 현재 opod의 append-only 메모리의 진화 방향 후보.
- **A-MEM** (2025, [arXiv:2502.12110](https://arxiv.org/abs/2502.12110)) — 제텔카스텐식 연결 메모리. 캐릭터 간 관계·단골 장소·반복 소재 같은 관계 구조가 필요해지면 참고.
- **Agent Memory Survey** (2024, [arXiv:2404.13501](https://arxiv.org/abs/2404.13501)) — 저장 대상·연산·표현의 분류 체계.

## 7. 평가 Agent — LLM-as-Judge · 루브릭 · 자기개선

### LLM-as-Judge 기초와 신뢰성

- **MT-Bench / Chatbot Arena judge** (Zheng et al., NeurIPS 2023, [arXiv:2306.05685](https://arxiv.org/abs/2306.05685)) — GPT-4 심사가 인간 선호와 80%+ 일치. 위치·장황·자기선호 편향 분류 체계 — 평가 Agent 존재의 근본 인용.
- **LLM Evaluators Favor Their Own Generations** (NeurIPS 2024, [arXiv:2404.13076](https://arxiv.org/abs/2404.13076)) — 자기 출력 인식과 자기선호 편향의 인과 관계 실증. **평가자를 생성자와 다른 모델로 분리한 opod 설계의 가장 강한 근거.**
- **G-Eval** (Liu et al., EMNLP 2023, [arXiv:2303.16634](https://arxiv.org/abs/2303.16634)) — CoT + 폼 채우기 차원별 채점. opod 루브릭 평가 프롬프트 구조의 가장 가까운 템플릿.
- **LLM-as-a-Judge Survey** (2024-25, [arXiv:2411.15594](https://arxiv.org/abs/2411.15594)) — 신뢰성 위협과 완화책 지도.

### 루브릭·체크리스트 평가

- **FLASK** (KAIST, ICLR 2024, [arXiv:2307.10928](https://arxiv.org/abs/2307.10928)) — 12개 스킬 차원 분해가 판정-인간 상관을 높임. **다차원 루브릭이 단일 총점보다 낫다는 직접 선례.**
- **Prometheus 2** (KAIST, EMNLP 2024, [arXiv:2405.01535](https://arxiv.org/abs/2405.01535)) — 임의 사용자 정의 루브릭 채점 전용 오픈 평가 모델. 독점 모델 밖 평가자 대안.
- **TICK** (Cohere, 2024, [arXiv:2410.03608](https://arxiv.org/abs/2410.03608)) — 심사자가 YES/NO 체크리스트를 먼저 생성하면 인간 일치도 상승, 같은 체크리스트가 개선 루프도 구동. 정적 린트(Layer 1)의 이진 검사 구조와 상통.

### 프롬프트 자기개선 (개선 제안 리포트의 학술 계보)

- **ProTeGi/APO** (Microsoft, EMNLP 2023, [arXiv:2305.03495](https://arxiv.org/abs/2305.03495)) — 실패 비평을 "텍스트 그래디언트"로 삼아 프롬프트를 편집. **opod 개선 루프(평가 비평→시스템 프롬프트 수정안)의 가장 가까운 학술 대응물.**
- **OPRO** (DeepMind, ICLR 2024, [arXiv:2309.03409](https://arxiv.org/abs/2309.03409)) — (프롬프트, 점수) 이력만으로 개선 후보 생성. 루브릭 점수 축적→수정안 제안 레시피.
- **TextGrad** (Stanford, Nature 2025, [arXiv:2406.07496](https://arxiv.org/abs/2406.07496)) — 다구성 시스템에 텍스트 피드백 역전파. 플래너+빌더 복합 파이프라인에 차원별 피드백을 전파하는 형식적 프레임.
- **Promptbreeder** (DeepMind, ICML 2024) / **DSPy·MIPROv2** (Stanford, ICLR 2024) — 탐색 다양성·체계적 프롬프트 컴파일. 수동 반영이 검증된 뒤의 다음 단계 후보.
- **Self-Refine** (NeurIPS 2023, [arXiv:2303.17651](https://arxiv.org/abs/2303.17651)) / **Reflexion** (NeurIPS 2023) — 동일 모델 자기비평의 효과와 한계. **Constitutional AI/RLAIF** (Anthropic 2022 / ICML 2024) — 명시적 원칙 대비 AI 피드백이 인간 라벨을 대체 가능하다는 대규모 증거 — 단 원칙 자체는 인간이 작성(= opod의 "사람이 커밋" 게이트).

### 판정-인간 정렬 (8절 상관 계측의 방법론)

- **EvalGen** (UC Berkeley, UIST 2024, [arXiv:2404.12272](https://arxiv.org/abs/2404.12272)) — 인간 채점 부분집합에 정렬되는 판정 구현 선택 + **"criteria drift"**(채점 기준이 출력을 보며 진화) 발견. opod의 점수×휴먼시그널 상관 컴포넌트와 가장 가까운 기존 시스템이며, 루브릭 버저닝이 다뤄야 할 리스크를 명명.
- **JUDGE-BENCH** (ACL 2025, [arXiv:2406.18403](https://arxiv.org/abs/2406.18403)) — 판정 신뢰성은 과제·속성별로 크게 다름 → 자기 데이터로 판정-인간 상관을 직접 측정해야 한다는 방법론적 근거.
- **실무 가이드**: Hamel Husain "Your AI Product Needs Evals" (2024) — 3단계 평가(단정/오프라인 판정/온라인 A/B)와 "판정을 인간 비평에 정렬 후 프롬프트 수정 구동" 워크플로우 = opod 운영 루프. Eugene Yan "eval-process" (2025), Anthropic "Demystifying Evals for AI Agents" (2025).

---

## 시사점 — opod 설계와의 대조

**설계가 문헌으로 검증되는 지점:**

1. 기획→실행 분리 (Plan-and-Write 계열), 평가자-생성자 모델 분리 (자기선호 편향 실증), 다차원 루브릭 (FLASK), 정적 린트의 이진 검사 (TICK), 개선 제안-사람 커밋 게이트 (Constitutional AI의 원칙 인간 작성), 메모리→기획 피드백 루프 (Generative Agents).

**문헌이 경고하는 리스크 (설계에 이미 반영됐거나 주시할 것):**

1. **페르소나 드리프트** — 정적 페르소나 프롬프트는 수 턴 내 열화. voice_tone_fit에 최근 캡션 비교를 넣은 이유이자, 장기적으로 메모리 계층화(Mem0류)가 필요한 이유.
2. **criteria drift** (EvalGen) — 검수자의 기준 자체가 진화함. 루브릭 버저닝(eval-rubric-vN)이 이를 다루는 장치.
3. **번역 의미 드리프트** (NeoBabel) — 한국어 장면의 문화 맥락 소실. plan_fidelity 차원이 감시할 대상.
4. **반복 편집 체인의 일관성 열화** (FLUX Kontext 자체 보고) — 컷 재생성 횟수가 늘수록 정체성 열화 가능. 재생성 정책·평가에 반영 고려.
5. **검증자 해킹** (Inference-Time Scaling) — 자동 선호 모델로 Best-of-N을 자동화할 경우의 실패 모드.

**글로벌·다국어 타겟 관점 (2026-08-07 확정):**

서비스가 글로벌 타겟이고 캡션이 캐릭터/마켓별 다국어이므로:

- 2절의 AI 티 연구는 대부분 **영어 기준**이라 영어 캡션에는 직접 적용
  가능하지만(Wikipedia 체크리스트, delve 어휘 목록), 비영어권 AI 티는
  연구가 얇다 — 언어별 패턴 팩을 자체 구축·검증해야 하며, 이 자체가
  포트폴리오에서 차별화 포인트가 될 수 있다.
- 교차언어 T2I 연구(3절)의 위상 변화: 기획 내부 언어(운영자용)와 캡션
  언어(독자용), 프롬프트 언어(영어)가 분리되는 3-언어 구조가 되므로
  NeoBabel이 지적한 의미 드리프트 감시 지점이 두 곳(기획→캡션,
  기획→프롬프트)으로 늘어난다.
- 플랫폼 관습(해시태그 문화, 캡션 길이)도 마켓별로 달라 caption_quality
  평가와 오프라인 집계는 언어별 분리가 필요하다.

**차용 후보 (우선순위 순):**

1. Wikipedia AI Cleanup 체크리스트 + "delve" 어휘 목록 → ai_tell_free **영어 팩**의 구체 패턴으로 즉시 변환. 타 언어 팩은 자체 구축.
2. G-Eval의 CoT+폼 채점 구조 → 평가 프롬프트 작성 시 채택.
3. PickScore/ImageReward → 검수 부담 축소용 후보 사전 랭킹 (휴먼 선택과의 일치율 계측 후).
4. ProTeGi의 텍스트 그래디언트 형식 → 개선 제안 리포트의 출력 형식.
5. Mem0식 메모리 통합 연산 → 캐릭터 메모리가 커질 때의 진화 방향.
