# Image Planning Evaluation calibration fixtures

- 상태: candidate — 리뷰 통과 후 hash 고정
- 대상: `2026-08-12-image-planning-evaluation-agent.md`

## 1. 실행 규칙

아래 base의 path mutation만 적용한다. 별도 표기가 없으면 ready 11차원은 모두 5,
issue 없음, tuple은 `provided=false`, `visualRequirementsPresent=false`,
assessment=`not_supplied`, verdict=`pass`다. `X=3/major`는 X만 3, issue 정확히 1개,
나머지 active 차원 5라는 뜻이다. 모든 issue는 입력과 ImagePlan evidence를 함께
인용한다.

## 2. Ready base

```json
{
  "planningInput": {
    "postPlan": {
      "intent": {
        "premise": "퇴근길에 버스를 눈앞에서 놓쳐 다음 버스를 기다렸다.",
        "primaryPurpose": "버스를 놓친 허탈함과 기다리는 상황을 기록한다.",
        "secondaryPurpose": null
      },
      "caption": "문 닫히는 거랑 눈 마주침"
    },
    "imageCount": 2,
    "characterVisualContext": {
      "name": "하나",
      "appearance": "검은 단발머리, 검은 긴팔 재킷",
      "visualStyle": "자연스러운 스마트폰 사진",
      "boundaries": [],
      "relevantContext": ["저녁 퇴근 시간"]
    },
    "identityReferences": [
      {"id":"face-front","description":"하나의 얼굴과 검은 단발머리 정면 참고"}
    ],
    "locations": [
      {
        "id":"bus-stop-a",
        "name":"도심 버스 정류장",
        "description":"유리 쉘터와 도착정보 전광판이 있는 정류장",
        "references":[{"id":"bus-stop-wide","description":"쉘터와 전광판의 넓은 환경 참고"}]
      }
    ]
  },
  "imagePlan": {
    "status":"ready",
    "locationId":"bus-stop-a",
    "continuity":{
      "lockedElements":[
        {"category":"environment","description":"유리 쉘터와 도착정보 전광판이 있는 도심 버스 정류장","appliesToShots":[0,1]}
      ]
    },
    "shots":[
      {
        "sortOrder":0,
        "visualPurpose":"막 출발한 버스와 놓친 순간을 보여 준다.",
        "scene":"유리 쉘터 앞에서 멀어지는 버스의 뒷모습과 정류장 표지판이 보인다. 주 캐릭터는 화면에 없다.",
        "captureSetup":"정류장 안에서 스마트폰을 눈높이에 들고 도로 방향을 정면으로 촬영한다.",
        "characterPresentation":{"mode":"none","visibleParts":[],"faceVisible":false,"identityPreservationRequired":false},
        "referenceBindings":[
          {"bindingId":"env-0","id":"bus-stop-wide","source":"environment","semanticPurposes":["environment","framing"],"preserve":["유리 쉘터와 전광판 배치"],"avoidCopying":[]}
        ]
      },
      {
        "sortOrder":1,
        "visualPurpose":"다음 버스를 기다리는 시간을 보여 준다.",
        "scene":"검은 긴팔 재킷을 입은 주 캐릭터의 손과 손목만 보이고 손 옆 전광판에 다음 버스 도착 시간이 표시된다. 얼굴은 보이지 않는다.",
        "captureSetup":"다른 손으로 스마트폰을 가슴 높이에 들고 손목과 전광판을 함께 내려다보는 근접 구도로 촬영한다.",
        "characterPresentation":{"mode":"partial","visibleParts":["hand","wrist"],"faceVisible":false,"identityPreservationRequired":false},
        "referenceBindings":[
          {"bindingId":"env-1","id":"bus-stop-wide","source":"environment","semanticPurposes":["environment"],"preserve":["전광판 형태"],"avoidCopying":["reference의 시간 숫자"]}
        ]
      }
    ]
  }
}
```

## 3. Ready 단일-construct mutations

| ID | 정확한 mutation | exact oracle |
|---|---|---|
| IP1 | shot 1의 purpose/scene/capture를 shot 0과 완전히 같은 멀어지는 버스 장면으로 교체 | `shot_distinctness=3/major`, issue 1, 나머지 5, pass가 아닌 `issues_found` |
| IP2 | shot 1 scene에 `오른손이 스마트폰을 들고 있으며 같은 오른손과 스마트폰이 외부 시점으로 보인다`로, capture도 오른손 셀카로 교체 | `capture_plausibility=1/critical`, issue 1, 나머지 5, `issues_found` |
| IP3 | shot 0 scene에 `주 캐릭터 손이 보인다`만 추가하고 presentation은 none 유지 | `character_presentation=3/major`, issue 1, 나머지 5, `issues_found` |
| IP5 | shot 0 environment binding id만 존재하지만 다른 location 소속인 `station-wide`로 변경하고 catalog에 station location/reference 추가 | `location_contract=1/critical`, issue 1, reference_contract=5, `issues_found` |
| IP6 | 별도 2컷 base에서 두 scene 모두 `검은 긴팔 재킷 소매와 손`이 보이고 wardrobe lock이 있음 ↔ lock만 제거 | `continuity_contract=3/major`, issue 1, 나머지 5, `issues_found` |
| IP7 | 모든 shot의 purpose/scene을 입력에 없는 카페 방문으로 교체하되 내부적으로 distinct하게 유지 | `post_intent_fidelity=1/critical`, coverage=5, issue 1, `issues_found` |
| IP7b | shot 1만 같은 정류장 꽃 클로즈업으로 바꾸고 새 사건·관계는 만들지 않음 | `visual_story_coverage=3/major`, fidelity/distinctness=5, `issues_found` |
| IP8 | operatorRequest=`전광판을 화면 오른쪽에 반드시 배치해.` 추가. positive는 shot 1 scene에 오른쪽, negative는 왼쪽만 명시 | positive all5/fulfilled/pass ↔ `capture_plausibility=3/major`, unfulfilled, `issues_found` |
| IP11 | shot 1의 비식별 손이라는 이유만으로 identity binding을 추가 | `reference_contract=3/major`, issue 1, 나머지 5, `issues_found` |
| IP12 | shot 0 captureSetup에 `Nano Banana Pro, negative prompt 사용` 추가 | `scope_compliance=1/critical`, issue 1, 나머지 5, `issues_found` |
| IP13 | appearance만 `금발 장발`로 scene에 반영 | `character_visual_grounding=1/critical`, fidelity/reference/presentation=5, `issues_found` |

## 4. Status와 blocked fixtures

### IP4 required identity without catalog

Ready base에서 imageCount=1, operatorRequest=`주 캐릭터의 정면 얼굴을 식별 가능하게
보여 줘.`, identityReferences=[]로 바꾼다.

- positive ImagePlan:
  `{"status":"blocked","reasons":[{"code":"missing_identity_reference","detail":"식별 가능한 주 캐릭터 얼굴에 필요한 identity reference가 없다."}]}`
  → block 3차원 5, assessment=`constrained_by_visual_contract`, `valid_block`
- negative: internally consistent ready shot with mode none and no character
  → `status_validity=1/critical` only, assessment=`constrained_by_visual_contract`,
  `issues_found`

### IP9 direct visual conflict

operatorRequest=`같은 한 컷에서 주 캐릭터 얼굴을 반드시 선명하게 보여 주고 사람은
한 명도 보이지 않게 해.`로 바꾼다.

- exact blocked reason `visual_constraint_conflict` → block all5,
  `blocked_by_visual_requirement_conflict`, `valid_block`
- ready 반환 → `status_validity=1/critical` only, 같은 assessment,
  `issues_found`

### IP10 false blocked state

Ready base에 operatorRequest=`정류장 표지판을 화면 오른쪽에 반드시 넣어.`를 추가하고
`{"status":"blocked","reasons":[{"code":"insufficient_distinct_shots","detail":"두 개의 서로 다른 컷을 만들 수 없다."}]}` 반환.

Expected: qualification=1/critical, grounding/completeness=5,
assessment=`not_assessed_due_invalid_plan_status`, `invalid_block`.

### IP14 valid blocker plus false extra reason

IP4 positive의 reasons 뒤에
`{"code":"unsupported_multi_location","detail":"서울과 부산 두 장소가 필요하다."}`를
추가한다.

Expected: qualification=5, grounding=1/critical, completeness=5,
assessment=`constrained_by_visual_contract`, `incomplete_block`.

### IP15 two independent blockers, one omitted

IP4 입력에 필수로 두 장소가 필요한 operator clause도 추가하고 PostPlan은
missing_identity_reference 하나만 보고한다.

Expected: qualification=5, grounding=5, completeness=3/major,
assessment=`constrained_by_visual_contract`, `incomplete_block`.

## 5. Operator tuple coverage

- 요청 부재 → `not_supplied`
- operatorRequest=`캡션을 한국어로 써.` → `no_visual_requirement`, ready all5
- IP8 positive/negative → `fulfilled` / `unfulfilled`
- `오른쪽 표지판과 얼굴 클로즈업` 중 표지판만 이행 → `partially_fulfilled`
- optional 얼굴 요구가 boundary로 생략되고 다른 호환 요구 이행 →
  `constrained_by_visual_contract`
- IP9 → `blocked_by_visual_requirement_conflict`
- operator와 무관한 unsupported_multi_location blocked →
  `not_assessed_due_input_block`
- IP10 → `not_assessed_due_invalid_plan_status`

최종 freeze 전 두 reviewer가 모든 active score, owner/non-owner, issue 수,
severity, evidence pair, tuple 네 필드와 verdict에 완전히 합의해야 한다.
