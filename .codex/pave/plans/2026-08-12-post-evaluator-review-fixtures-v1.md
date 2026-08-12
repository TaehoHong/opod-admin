# Post Planning Evaluation Agent calibration fixtures v1

- 작성일: 2026-08-12
- 상태: calibration candidate v2 — 사전 검증 통과 후 hash 고정
- 대상: `2026-08-12-post-generation-agent-role-redesign.md` 17절

## 1. 공통 규칙

별도 표기가 없으면 모든 ready fixture는 아래 열한 차원이 5이고 issue가 없으며
`verdict=pass`다.

```text
status_validity
character_grounding
intent_quality
continuity_and_novelty
content_style_fit
voice_fit
ai_tell_free
caption_quality
hashtag_fit
memory_discipline
scope_compliance
```

`all5Except(X=3/major)`는 X만 3이고 X를 owner로 하는 major issue 하나가 있으며,
나머지 열 차원은 5라는 뜻이다. 입력 규칙과 출력의 관계가 문제라면 issue
evidence는 위반된 planningInput 원문과 PostPlan 원문을 모두 포함한다. PostPlan
내부 필드 사이의 관계가 문제라면 관계를 이루는 두 PostPlan 원문을 모두 포함한다.

이 문서의 mutation JSON에서 경로가 생략된 `operatorRequest`, `memories`,
`additionalContext`는 각각 `planningInput.operatorRequest`,
`planningInput.memories`, `planningInput.persona.additionalContext`를 뜻한다.
`voice`와 `contentStyle` 문자열은 각각
`planningInput.persona.writingProfile.voice[0].content`와
`planningInput.persona.writingProfile.contentStyle[0].content`를 뜻한다.
`premise`, `primaryPurpose`, `secondaryPurpose`, `caption`, `captionLanguages`,
`hashtags`, `newMemoryCandidates`, `conflicts`는 `postPlan` 아래의 대응 필드를 뜻한다.
`assessment`는 입력 mutation이 아니라 별도 Expected output 값이다.
`operatorRequestEvaluation.reason`의 문장 자체는 고정하지 않는다. 다만 관련 요청
구절 또는 게시물 범위 요구가 없다는 사실을 식별하고, expected assessment와
모순되지 않아야 한다.
별도 표기가 없으면 나열한 독립 결함 하나당 issue는 정확히 하나이며, issue evidence는
1절의 관계별 trace 규칙을 만족해야 한다.

## 2. Ready base

```json
{
  "planningInput": {
    "character": {
      "name": "하나",
      "bio": "서울에 사는 직장인",
      "interests": [],
      "defaultContentLanguage": "ko"
    },
    "persona": {
      "characterContext": [],
      "writingProfile": {
        "contentStyle": [
          {
            "title": "content_style",
            "content": "그날 있었던 사소한 일을 짧게 기록한다."
          }
        ],
        "voice": [
          {
            "title": "voice",
            "content": "건조한 반말 한 문장. 이모지와 해시태그는 거의 쓰지 않는다."
          }
        ]
      },
      "boundaries": [],
      "additionalContext": []
    },
    "memories": [],
    "recentPosts": []
  },
  "postPlan": {
    "status": "ready",
    "intent": {
      "premise": "퇴근길에 버스를 눈앞에서 놓쳤다.",
      "primaryPurpose": "버스를 놓친 허탈함을 짧게 기록한다.",
      "secondaryPurpose": null
    },
    "caption": "문 닫히는 거랑 눈 마주침",
    "captionLanguages": ["ko"],
    "hashtags": [],
    "newMemoryCandidates": []
  }
}
```

Expected:

```json
{
  "operatorRequestEvaluation": {
    "provided": false,
    "postPlanningRequirementsPresent": false,
    "assessment": "not_supplied"
  },
  "scores": "all 5",
  "issues": [],
  "verdict": "pass"
}
```

## 3. Grounding controls

### G1 ordinary one-off

Ready base 그대로다. bio·memories에 버스 사건이 없다는 이유로 감점하지 않는다.

### G2 unsupported persistent lifestyle

G1에서 다음 필드만 교체한다.

```json
{
  "postPlan.intent.premise": "매일 퇴근 후 같은 노선 버스를 타고 귀가하는 루틴을 오늘도 지켰다.",
  "postPlan.intent.primaryPurpose": "매일 반복하는 귀가 루틴을 기록한다.",
  "postPlan.caption": "오늘도 같은 버스",
  "postPlan.newMemoryCandidates": [
    { "type": "routine", "content": "매일 퇴근 후 같은 노선 버스를 타고 귀가한다." }
  ]
}
```

Expected: `all5Except(character_grounding=3/major)`, `issues_found`.
candidate는 premise와 일치하므로 `memory_discipline=5`다. 이 fixture의 목적은
premise의 근거 없는 지속 생활 발명이다.

## 4. Voice와 AI 문체 controls

공통 caption:

```text
비온다 비온다 오늘 운동 안해ㅋㅋ
```

V1~V3에서 공통으로 intent를 다음처럼 바꿔 caption과 의미상 일치시킨다.

```json
{
  "premise": "비가 와서 오늘 예정했던 운동을 쉬기로 했다.",
  "primaryPurpose": "비 때문에 운동을 쉬는 결정을 짧게 기록한다.",
  "secondaryPurpose": null
}
```

### V1 explicit voice support

Ready base에서 voice를 다음으로 바꾸고 caption을 공통 caption으로 바꾼다.

```text
반말. 단어를 반복하고 조사를 자주 생략하며 문장 끝에 ㅋㅋ를 붙인다.
```

Expected: `voice_fit=5`, `ai_tell_free=5`, `pass`.

### V2 explicit voice violation

V1에서 voice만 다음으로 바꾼다.

```text
반말. 단어 반복과 조사 생략은 허용하지만 ㅋㅋ는 쓰지 않는다.
```

Expected: 금지된 `ㅋㅋ` 하나만 있는 국소 표현 결함이므로
`all5Except(voice_fit=4/minor)`, `ai_tell_free=5`, `pass`.

### V3 unsupported generic pattern

Ready base에서 intent, caption과 voice만 바꾼다.

```json
{
  "premise": "미뤄 둔 책상 조립을 오늘 끝냈다.",
  "primaryPurpose": "책상 조립을 끝낸 사실과 만족감을 기록한다.",
  "voice": "담백한 반말. 독자에게 질문하지 않는다.",
  "caption": "미뤄 둔 책상 조립 끝. 다들 오늘은 뭐 끝냈어?"
}
```

Expected: caption이 명시된 독자 질문 금지를 직접 위반하므로 issue 정확히 1개,
`voice_fit=3/major`가 소유한다. 같은 fragment를 `ai_tell_free`에 중복 귀속하지
않으며 `ai_tell_free=5`, verdict=`issues_found`다.

### V4 AI-tell direct owner

Ready base에서 다음 intent와 caption을 사용한다.

```json
{
  "premise": "점심에 비빔밥을 먹었는데 예상보다 매웠다.",
  "primaryPurpose": "예상보다 매웠던 점심 경험을 기록한다.",
  "caption": "비빔밥이 맵더라. 매운 맛도 오늘의 경험이고 당황한 순간도 오늘의 추억인 것 같아. 다들 오늘 점심은 어땠어?"
}
```

- voice가 `구체적 사건 뒤에 같은 구조의 일반화 문장을 붙이고 마지막에 독자
  질문을 쓴다.`면 `voice_fit=5`, `ai_tell_free=5`, `pass`다.
- voice만 `따뜻한 반말 2~3문장. 독자 질문을 허용한다.`로 바꾸면 명시 voice
  위반은 없지만 입력에 없는 균일한 일반화와 관성적인 참여 유도가 남으므로
  `all5Except(ai_tell_free=3/major)`, issue 정확히 1개, `issues_found`다.

## 5. Operator controls

### O1 compatible CTA fulfilled

Ready base에서 다음만 바꾼다.

```json
{
  "planningInput.operatorRequest": "캡션 마지막에 오늘 어땠는지 물어봐.",
  "planningInput.persona.writingProfile.voice[0].content": "건조한 반말. 짧게 쓰고 이모지와 해시태그는 거의 쓰지 않는다.",
  "postPlan.caption": "문 닫히는 거랑 눈 마주침 오늘은 어땠어?"
}
```

Expected: assessment=`fulfilled`, all scores 5, `pass`.

### O2 compatible CTA unfulfilled

O1에서 caption만 Ready base 값으로 되돌린다.

Expected: assessment=`unfulfilled`,
`all5Except(caption_quality=3/major)`, `issues_found`. `voice_fit`,
`ai_tell_free`, `intent_quality`는 5다.

### O3 visual-only

Ready base에서 operatorRequest만 `인물 얼굴이 보이지 않는 이미지 3장을 만들어.`로
바꾼다.

Expected: provided=true, postPlanningRequirementsPresent=false,
assessment=`no_post_scope_requirement`, all scores 5, `pass`.

### O4 compatible plus constrained

먼저 fulfilled-only control로 Ready base에 operatorRequest
`버스를 놓친 일을 써.`만 추가하고 voice를 `건조한 반말. 문장부호를 쓰지 않는다.`로
바꾼다. Expected assessment=`fulfilled`, all scores 5, `pass`다.

그 control에서 다음만 바꾼다.

```json
{
  "planningInput.operatorRequest": "버스를 놓친 일을 쓰고 모든 문장 끝에 느낌표를 붙여.",
  "planningInput.persona.writingProfile.voice[0].content": "건조한 반말. 문장부호를 쓰지 않는다.",
  "postPlan.caption": "문 닫히는 거랑 눈 마주침"
}
```

Expected: assessment=`constrained_by_character_contract`, all scores 5, `pass`.
호환되는 소재 요구는 이행했고 느낌표 요구는 voice에 맞춰 생략했다.

### O5 unrelated authoritative input conflict

Ready base에 서로 모순된 memories 두 개와 한국어 caption 요구를 추가하고,
PostPlan을 정확한 conflict variant로 바꾼다.

```json
{
  "operatorRequest": "캡션은 한국어로 작성해.",
  "memories": [
    { "type": "fact", "content": "현재 서울에만 거주한다." },
    { "type": "fact", "content": "현재 부산에만 거주한다." }
  ],
  "postPlan": {
    "status": "conflict",
    "conflicts": [{
      "left": { "source": "memories", "text": "현재 서울에만 거주한다." },
      "right": { "source": "memories", "text": "현재 부산에만 거주한다." },
      "reason": "두 배타적인 현재 거주 사실은 동시에 참일 수 없다."
    }]
  }
}
```

Expected: assessment=`not_assessed_due_input_conflict`, conflict scores all 5,
`valid_conflict`.

### O6 partially fulfilled compatible requirements

Ready base에 operatorRequest만 `버스를 놓친 일을 쓰고 #버스놓침을 넣어.`로 추가한다.
소재 요구는 이미 이행됐지만 hashtag는 빈 배열로 유지한다.

Expected: assessment=`partially_fulfilled`,
`all5Except(hashtag_fit=3/major)`, `issues_found`. `intent_quality`와 나머지
non-owner 차원은 5다.

## 6. Memory controls

### M1 required candidate present

Ready base에서 다음을 바꾼다.

```json
{
  "operatorRequest": "이번 달부터 매주 금요일 도예 수업을 시작했다고 알려줘.",
  "premise": "이번 달부터 매주 금요일 도예 수업을 시작했다.",
  "primaryPurpose": "새로 시작한 주간 루틴을 기록한다.",
  "caption": "금요일은 이제 흙 만지는 날",
  "newMemoryCandidates": [
    { "type": "routine", "content": "이번 달부터 매주 금요일 도예 수업을 듣는다." }
  ]
}
```

Expected: assessment=`fulfilled`, all scores 5, `pass`.

### M2 required candidate omitted

M1에서 `newMemoryCandidates`만 `[]`로 바꾼다.

Expected: assessment=`fulfilled`,
`all5Except(memory_discipline=3/major)`, `issues_found`.

### M3 characterContext duplicate

M1에 다음 characterContext를 추가한다.

```json
{
  "title": "routine",
  "content": "이번 달부터 매주 금요일 도예 수업을 듣는다."
}
```

Expected: assessment=`fulfilled`,
`all5Except(memory_discipline=3/major)`, `issues_found`.

### M4 candidate absent from premise and caption

먼저 Ready base에서 premise를 `점심에 매운 국수를 먹었고 매운 음식을 좋아한다는
사실을 다시 확인했다.`, purpose를 `지속적인 매운 음식 선호를 기록한다.`, caption을
`역시 매운 게 좋음`, candidate를
`{"type":"preference","content":"매운 음식을 좋아한다."}`로 바꾼 positive
control을 두고 operatorRequest를 `매운 음식을 좋아한다는 사실을 알려줘.`로
추가한다. Expected assessment=`fulfilled`, all scores 5, `pass`다.

negative control은 positive를 그대로 유지한 채 근거 없는 별도 candidate
`{"type":"preference","content":"찬 음식을 좋아한다."}`만 추가한다.

Expected: assessment=`fulfilled`,
`all5Except(memory_discipline=3/major)`, `issues_found`.

### M5 one-off promoted to memory

Ready base의 `newMemoryCandidates`에만
`{"type":"event","content":"오늘 퇴근길에 버스를 놓쳤다."}`를 추가한다.
이 사건은 중요도가 명시되지 않은 일회성이라 지속 memory가 아니다.

Expected: `all5Except(memory_discipline=3/major)`, `issues_found`.

### M6 duplicate candidate

M1의 `newMemoryCandidates`에 의미상 동일한
`{"type":"routine","content":"매주 금요일마다 도예 수업에 간다."}`를 하나 더
추가한다.

Expected: assessment=`fulfilled`,
`all5Except(memory_discipline=3/major)`, `issues_found`.

### M7 future goal typed as routine

Ready base에서 operatorRequest를 `다음 달부터 매주 금요일 도예를 배울 계획이라고
알려줘.`, `postPlan.intent.premise`를 `다음 달부터 매주 금요일 도예를 배울
계획이다.`, `postPlan.intent.primaryPurpose`를 `새로 세운 학습 계획을 기록한다.`,
caption을 `다음 달 금요일은 도예 배우는 날로 계획함`으로 바꾸고 candidate를
`{"type":"goal","content":"다음 달부터 매주 금요일 도예를 배울 계획이다."}`로
추가한다.

- candidate type=`goal` → all scores 5, assessment=`fulfilled`, `pass`
- candidate type만 `routine` →
  `all5Except(memory_discipline=3/major)`, `issues_found`

### M8 bio fact duplicate

Ready base에서 premise를 `서울 집 근처를 걸었다.`, purpose를 `집 근처 산책을 짧게
기록한다.`, caption을 `집 근처 한 바퀴`로 바꾼다. candidate가 비어 있으면 all
scores 5, `pass`다. candidate만
`{"type":"fact","content":"서울에 산다."}`로 바꾸면 bio의 기존 지속 사실과
중복되므로 `all5Except(memory_discipline=3/major)`, `issues_found`다.

## 7. Language controls

### L1 persona-supported Japanese

Ready base에서 다음을 바꾼다.

```json
{
  "additionalContext": [{
    "title": "audience language",
    "content": "이번 게시물은 일본어로 작성한다."
  }],
  "premise": "오늘 무사히 도착한 사실을 알린다.",
  "primaryPurpose": "도착 소식을 짧게 전한다.",
  "caption": "無事に着いたよ",
  "captionLanguages": ["ja"]
}
```

Expected: all scores 5, `pass`.

### L2 unsupported Japanese

L1에서 additionalContext만 `[]`로 바꾼다.

Expected: `all5Except(caption_quality=3/major)`, `issues_found`.

### L3 proper name

Ready base에서 premise를 `IKEA에서 책상을 구경했다.`, primaryPurpose를
`책상을 구경한 일을 짧게 기록한다.`, caption을 `오늘 IKEA에서 책상 구경`으로
바꾸고 captionLanguages는 `["ko"]`로 둔다.

Expected: all scores 5, `pass`. `IKEA`만으로 `en`을 요구하지 않는다.

### L4 code-switch list mismatch

Ready base에서 premise를 `느긋한 아침에 커피만 간단히 챙겼다.`, primaryPurpose를
`느긋한 아침 분위기를 짧게 기록한다.`, voice를 `건조한 반말. 한국어 문장 안에
짧은 영어 구절을 자연스럽게 섞는다.`로 바꾸고 caption을
`오늘은 slow morning. 커피만 챙겨.`로 바꾼다.

- captionLanguages=`["ko","en"]` → all 5, `pass`
- captionLanguages=`["ko"]`만 변경 →
  `all5Except(caption_quality=3/major)`, `ai_tell_free=5`, `issues_found`

### L5 indirect persona language context is insufficient

L2에 characterContext `일본에서 근무하며 일본어를 읽고 쓸 수 있다.`를 추가한다.
이는 posting language나 이번 독자를 직접 지정하지 않으므로 L2의 expected 결과는
변하지 않는다. characterContext를 `일본어로 게시물을 작성하는 것이 확정된 습관이다.`로
교체하면 all scores 5, `pass`다.

### L6 language evidence precedence

L1의 additionalContext를 `이번 게시물은 한국어로 작성한다.`로, operatorRequest를
`이번 게시물은 일본어로 작성해.`로 두고 L1의 일본어 PostPlan을 유지한다.
additionalContext가 boundary나 확정 hard rule이 아니므로 게시물별 호환 operator
요구가 우선한다.

Expected: assessment=`fulfilled`, all scores 5, `pass`. operatorRequest만 제거하면
`all5Except(caption_quality=3/major)`, `issues_found`다.

## 8. Hashtag controls

### H1 requested multilingual hashtags

Ready base에서 premise를 `서울의 카페에서 잠깐 쉬었다.`, primaryPurpose를
`카페에서 쉰 일을 기록한다.`, caption을 `잠깐 쉬다 감`, operatorRequest를
`서울 카페에 간 내용을 쓰고 #서울카페와 #SeoulCafe를 모두 넣어.`로 바꾸고
hashtags를 `["서울카페","SeoulCafe"]`로 바꾼다.
H1과 H2에서는 공통으로 voice를 `건조한 반말. 짧게 쓰고 이모지를 거의 쓰지
않는다.`로 바꿔 operatorRequest가 hashtag 사용의 유일한 positive evidence가 되게
한다.

Expected: assessment=`fulfilled`, all scores 5, `pass`.

### H2 unsupported multilingual hashtags

H1에서 operatorRequest 필드만 제거한다.

Expected: assessment=`not_supplied`,
`all5Except(hashtag_fit=3/major)`, `issues_found`.

### H3 hashtag-only persistent relationship invention

Ready base에서 premise를 `보호소에서 강아지 한 마리를 만났다.`, purpose를
`강아지를 만난 일을 짧게 기록한다.`, caption을 `오늘 만난 강아지 귀여움`,
voice를 `관련 해시태그 하나를 짧게 덧붙인다.`로 바꾸고 hashtags를
`["우리집새식구"]`로 둔다.

Expected: hashtag가 premise/caption에 없는 입양·지속 관계를 발명하므로
`all5Except(hashtag_fit=3/major)`, memory_discipline=5, `issues_found`.

## 9. Conflict source round-trip

각 fixture는 conflict 세 점수 5, issue 없음, `valid_conflict`가 기대값이다.

아래 C1~C4의 JSON은 2절 Ready base에 적용하는 path mutation이다. 모든 case에서
`postPlan` 객체 전체를 표시된 conflict 객체로 교체하므로 ready 전용 필드는 남지
않는다. Expected output은 mutation JSON 밖에 따로 적는다.

### C1 operator ↔ memory

```json
{
  "planningInput.operatorRequest": "커피를 마시는 게시물을 작성해.",
  "planningInput.memories": [
    { "type": "preference", "content": "커피를 마시지 않는다." }
  ],
  "postPlan": {
    "status": "conflict",
    "conflicts": [{
      "left": { "source": "operatorRequest", "text": "커피를 마시는 게시물을 작성해." },
      "right": { "source": "memories", "text": "커피를 마시지 않는다." },
      "reason": "커피를 마시는 사건과 커피를 마시지 않는 확정 선호는 직접 충돌한다."
    }]
  }
}
```

Expected assessment=`constrained_by_character_contract`.

### C2 operator ↔ operator

```json
{
  "planningInput.operatorRequest": "캡션은 한국어만 사용하고 동시에 일본어만 사용해.",
  "postPlan": {
    "status": "conflict",
    "conflicts": [{
      "left": { "source": "operatorRequest", "text": "캡션은 한국어만 사용" },
      "right": { "source": "operatorRequest", "text": "동시에 일본어만 사용" },
      "reason": "한 캡션을 한국어만, 일본어만 사용해 동시에 작성할 수 없다."
    }]
  }
}
```

Expected assessment=`blocked_by_operator_requirement_conflict`.

### C3a memory ↔ memory, operator 없음

Ready base에 아래 mutation을 적용한다.

```json
{
  "planningInput.memories": [
    { "type": "fact", "content": "현재 서울에만 거주한다." },
    { "type": "fact", "content": "현재 부산에만 거주한다." }
  ],
  "postPlan": {
    "status": "conflict",
    "conflicts": [{
      "left": { "source": "memories", "text": "현재 서울에만 거주한다." },
      "right": { "source": "memories", "text": "현재 부산에만 거주한다." },
      "reason": "두 배타적인 현재 거주 사실은 동시에 참일 수 없다."
    }]
  }
}
```

Expected assessment=`not_supplied`.

### C3b memory ↔ memory, 무관한 operator 있음

C3a에 `planningInput.operatorRequest="캡션은 한국어로 작성해."`만 추가한다.

Expected assessment=`not_assessed_due_input_conflict`.

### C4 contentStyle ↔ voice

```json
{
  "planningInput.persona.writingProfile.contentStyle[0].content": "사건의 원인과 결과를 최소 세 개의 사실 문장으로 상세히 설명한다.",
  "planningInput.persona.writingProfile.voice[0].content": "모든 캡션은 최대 세 단어의 문장 조각 하나로만 작성한다.",
  "postPlan": {
    "status": "conflict",
    "conflicts": [{
      "left": {
        "source": "persona.writingProfile.contentStyle",
        "text": "사건의 원인과 결과를 최소 세 개의 사실 문장으로 상세히 설명한다."
      },
      "right": {
        "source": "persona.writingProfile.voice",
        "text": "모든 캡션은 최대 세 단어의 문장 조각 하나로만 작성한다."
      },
      "reason": "최소 세 개의 사실 문장을 최대 세 단어의 문장 조각 하나로 동시에 작성할 수 없다."
    }]
  }
}
```

Expected assessment=`not_supplied`.

## 10. Recent-post observability controls

### R1 repeated routine, different event and expression

Ready base에서 다음 recentPost 하나를 추가한다.

```json
{
  "premise": "지난주 퇴근길 지하철에서 졸아 종점까지 갔다.",
  "caption": "종점까지 와버림",
  "hashtags": []
}
```

Expected: `continuity_and_novelty=5`, all scores 5, `pass`. 교통수단을 놓친
소재가 반복돼도 사건과 표현이 다르므로 near-copy가 아니다.

### R2 premise and caption near-copy

R1에서 recentPost만 다음으로 바꾼다.

```json
{
  "premise": "퇴근길에 버스를 눈앞에서 놓쳤다.",
  "caption": "문 닫히는 거랑 눈 마주침",
  "hashtags": []
}
```

Expected: `all5Except(continuity_and_novelty=3/major)`, `issues_found`.

### R3 legacy null premise

R2에서 recentPost.premise만 `null`로 바꾸고 caption은 near-copy가 아닌
`오늘 교통 진짜 복잡함`으로 바꾼다.

Expected: premise를 추측하지 않고 all scores 5, `pass`.

## 11. Additional ownership and invariance controls

### A1 contentStyle subject support

Ready base에서 premise·purpose·caption을 `점심에 먹은 국수가 예상보다 매웠다.` /
`매웠던 점심 경험을 짧게 기록한다.` / `생각보다 맵네`로 바꾸고 contentStyle을
`그날 먹은 음식과 짧은 감상을 기록한다.`로 바꾼다.

Expected: all scores 5, `pass`.

contentStyle만 `업무 성취만 기록하고 음식 이야기는 게시하지 않는다.`로 바꾸면
`content_style_fit=3/major`, 나머지 5, `issues_found`다. 소재의 일반적인 삶의
가능성은 유지되므로 `character_grounding`에 중복 귀속하지 않는다.

### A2 explicit voice versus recentPosts

Ready base에서 recentPosts를 다음으로 바꾸고 명시 voice와 Ready base PostPlan은
바꾸지 않는다.

```json
[
  {"premise":"주말에 미술관을 관람했다.","caption":"전시를 천천히 둘러보았습니다 😊 색감이 정말 인상적이었어요.","hashtags":[]},
  {"premise":"친구와 저녁을 먹었다.","caption":"오랜만에 친구와 즐거운 저녁 시간을 보냈습니다 🍽️", "hashtags":[]},
  {"premise":"새 화분을 창가에 두었다.","caption":"작은 화분 하나로 방 분위기가 환해진 것 같아요 🌿", "hashtags":[]}
]
```

Expected: `voice_fit=5`, all scores 5, `pass`. recentPosts만 명시 voice와 같은
건조한 반말로 바꾼 아래 배열에서도 모든 출력은 불변이다.

```json
[
  {"premise":"주말에 미술관을 관람했다.","caption":"전시 보고 옴","hashtags":[]},
  {"premise":"친구와 저녁을 먹었다.","caption":"저녁 먹고 헤어짐","hashtags":[]},
  {"premise":"새 화분을 창가에 두었다.","caption":"창가에 화분 둠","hashtags":[]}
]
```

### A3 caption-only persistent fact

Ready base caption 끝에 `이제 매일 이 버스를 탈 거임`을 추가하고 premise는
바꾸지 않는다.

Expected: `caption_quality=3/major`가 새 지속 사실의 caption-only 추가를 소유한다.
`newMemoryCandidates`도 비어 있으므로 `memory_discipline=3/major`라는 별개의 출력
결함이 함께 존재한다. 나머지 아홉 차원은 5, `issues_found`다.

### A4 existing-memory duplicate

M1의 candidate와 동일한 routine을 planningInput.memories에 추가한다.

Expected: `memory_discipline=3/major`, 나머지 10개 차원 5, `issues_found`.

### A5 irrelevant evidence invariance

Ready base의 interests에 `천문학`을 추가하고 recentPosts에 아래 객체를 추가한다.

```json
{
  "premise": "주말 밤에 천체 관측소에서 토성을 봤다.",
  "caption": "고리 진짜 보이네",
  "hashtags": ["토성"]
}
```

Expected: 모든 score·issue·assessment·verdict가 Ready base와 동일하다.

### A5a generic intent defect

Ready base의 `primaryPurpose`만 `일상을 공유하고 팔로워와 소통한다.`로 바꾼다.

Expected: `all5Except(intent_quality=3/major)`, issue 정확히 1개,
assessment=`not_supplied`, `issues_found`.

### A5b post-planning scope leak

Ready base의 `primaryPurpose` 끝에 `이미지는 두 컷으로 나누고 첫 컷은 클로즈업으로
촬영한다.`를 추가한다.

Expected: narrative purpose는 유지되지만 이미지 수·컷·구도를 결정했으므로
`all5Except(scope_compliance=1/critical)`, issue 정확히 1개,
assessment=`not_supplied`, `issues_found`.

### A5c visual-only request is out of post scope

Ready base에
`planningInput.persona.boundaries=[{"title":"image privacy","content":"개인
주소를 어떤 이미지에도 표시하지 않는다."}]`와
`planningInput.operatorRequest="이미지에 집 주소를 정확히 넣고 얼굴은 보이지 않게
해."`를 추가한다. PostPlan은 그대로 둔다.

Expected: provided=true, postPlanningRequirementsPresent=false,
assessment=`no_post_scope_requirement`, all scores 5, `pass`.

### A6 direct conflict returned as ready

Ready base에 다음 boundary와 operatorRequest를 추가하되 ready PostPlan은 그대로 둔다.

```json
{
  "planningInput.persona.boundaries": [
    {"title":"privacy","content":"개인 주소를 공개하지 않는다."}
  ],
  "planningInput.operatorRequest": "캡션에 집 주소를 정확히 공개해."
}
```

Expected: `status_validity=1/critical`, 나머지 10개 차원 5,
assessment=`constrained_by_character_contract`, `issues_found`.

같은 요청을 `가능하면 캡션에 집 주소도 적어줘.`라는 soft clause로만 바꾸면 ready
PostPlan을 그대로 유지해도 status_validity를 포함한 all scores 5,
assessment=`constrained_by_character_contract`, `pass`다.

### A7 no direct conflict returned as conflict

Ready base의 operatorRequest에 `새로 산 우산 이야기를 써.`를 추가하고 PostPlan을
다음 conflict로 바꾼다.

```json
{
  "status": "conflict",
  "conflicts": [{
    "left": { "source": "operatorRequest", "text": "새로 산 우산 이야기를 써." },
    "right": {
      "source": "persona.writingProfile.contentStyle",
      "text": "그날 있었던 사소한 일을 짧게 기록한다."
    },
    "reason": "새 우산은 이전 설정에 없으므로 충돌한다."
  }]
}
```

Expected: `conflict_qualification=1/critical`, grounding과 completeness 5,
assessment=`not_assessed_due_invalid_plan_status`, `invalid_conflict`.

### A8 score composition

Ready base의 `captionLanguages`만 `['ko','ko']`로 바꾼다. 실제 언어 집합은
정확하지만 같은 언어 코드가 중복된 국소 metadata 결함이므로
`caption_quality=4/minor`, issue 1개, `pass`다.
Ready base의 정확한 `['ko']`로 되돌리면 issue가 사라진다. 근거가 고정되지 않은
두 minor 합성 사례는 reviewer가 임의로 만들지 않으며 승인 필수 조건으로 사용하지
않는다.

## 12. Conflict mutation oracles

모든 case는 17.2의 strict conflict variant를 만족한다. CM1과 CM2의 Expected
assessment는 `constrained_by_character_contract`, CM3은 아래에 별도 명시한다.

### CM1 independent conflict omitted

C1에서 operatorRequest를 `커피를 마시는 게시물을 작성해. 캡션에 집 주소를
공개해.`로, memories는 그대로 두고
`planningInput.persona.boundaries=[{"title":"privacy","content":"개인 주소를
공개하지 않는다."}]`를 추가한다. PostPlan은 C1의 커피 conflict 하나만 정확히
보고 주소 conflict를
보고하지 않는다.

Expected: `conflict_completeness=3/major`, qualification과 grounding은 5,
`incomplete_conflict`. 두 conflict는 서로 다른 operand pair이므로 독립적이다.

### CM2 stated operand is absent from input

C1의 planningInput과 operand text는 그대로 두고, PostPlan의 `right.source`만 실제
위치와 다른 허용 enum인 `persona.characterContext`로 바꾼다.

Expected: 입력 자체와 두 operand text에는 operator↔memory 직접 충돌이 그대로
존재하므로 `conflict_qualification=5`; 거짓 source tag는 grounding만 소유하여
`conflict_grounding=1/critical`; completeness=5, `incomplete_conflict`.

### CM3 compatible pair reported as conflict

Ready base에 operatorRequest `새로 산 우산 이야기를 써.`를 추가하고 A7의 conflict
PostPlan을 사용한다. 두 operand text와 source는 입력에 실제로 존재하지만 서로
양립 가능하다.

Expected: `conflict_qualification=1/critical`, grounding과 completeness는 5,
assessment=`not_assessed_due_invalid_plan_status`, `invalid_conflict`. 비양립성 자체가 거짓이라는 동일
evidence를 grounding에 중복 귀속하지 않는다.

### CM4 valid item plus non-qualifying item

C1에 다음 mutation을 추가한다.

```json
{
  "planningInput.operatorRequest": "커피를 마시는 게시물을 작성해. 새로 산 우산 이야기도 써.",
  "postPlan": {
    "status": "conflict",
    "conflicts": [
      {
        "left": {"source":"operatorRequest","text":"커피를 마시는 게시물을 작성해."},
        "right": {"source":"memories","text":"커피를 마시지 않는다."},
        "reason":"커피를 마시는 사건과 커피를 마시지 않는 확정 선호는 직접 충돌한다."
      },
      {
        "left": {"source":"operatorRequest","text":"새로 산 우산 이야기도 써."},
        "right": {"source":"persona.writingProfile.contentStyle","text":"그날 있었던 사소한 일을 짧게 기록한다."},
        "reason":"새 우산은 이전 설정에 없으므로 충돌한다."
      }
    ]
  }
}
```

Expected: 실제 conflict item 하나가 있어도 모든 reported item이 qualifying이어야
하므로 `conflict_qualification=3/major`, issue 정확히 1개, grounding과
completeness는 5, assessment=`constrained_by_character_contract`,
`invalid_conflict`.

### CM5 semantic duplicate conflict

C1의 PostPlan만 다음으로 교체한다.

```json
{
  "status": "conflict",
  "conflicts": [
    {
      "left": {"source":"operatorRequest","text":"커피를 마시는 게시물을 작성해."},
      "right": {"source":"memories","text":"커피를 마시지 않는다."},
      "reason":"커피를 마시는 사건과 커피를 마시지 않는 확정 선호는 직접 충돌한다."
    },
    {
      "left": {"source":"memories","text":"커피를 마시지 않는다."},
      "right": {"source":"operatorRequest","text":"커피를 마시는 게시물을 작성해."},
      "reason":"커피 금지 선호는 커피를 마시라는 요구와 함께 만족할 수 없다."
    }
  ]
}
```

Expected: 의미상 같은 최소 operand relation을 중복 보고했으므로
`conflict_completeness=3/major`, issue 정확히 1개, qualification과 grounding은 5,
assessment=`constrained_by_character_contract`, `incomplete_conflict`.

## 13. Calibration acceptance

두 명 이상의 reviewer가 모든 fixture에서 다음에 일치해야 한다.

- owner와 non-owner
- issue 유무와 개수
- score와 severity
- operator assessment
- provided와 postPlanningRequirementsPresent boolean
- reason의 문구 일치가 아닌 의미·근거 정확성
- 필수 evidence와 변하면 안 되는 non-owner
- ready/conflict verdict

불일치는 평균이나 다수결로 처리하지 않고 rubric ambiguity 또는 reviewer의 명시
규칙 위반으로 분류한다. rubric을 바꿨다면 v1 전체를 처음부터 다시 실행한다.
