# Generated Image Evaluation visual fixture manifest

- 상태: asset production candidate — 실제 이미지와 hash가 채워지기 전 calibration 미실행
- 대상: `2026-08-12-generated-image-evaluation-agent.md`

## 1. 고정 단위

각 case는 다음 파일을 하나의 불변 묶음으로 갖는다.

```text
fixtures/generated-image/<case-id>/
├── contract.json
├── positive.png
├── negative.png
├── references/
│   └── <binding-id>.png
├── expected-positive.json
├── expected-negative.json
└── MANIFEST.sha256
```

두 이미지의 원본 해상도, intended display scale, 바뀐 observable construct 하나,
의도하지 않은 다른 결함이 없다는 사람 검수 기록을 `contract.json`에 남긴다.
설명만 있는 fixture는 calibration에 사용할 수 없다.

## 2. Exact output oracle

각 expected 파일은 모든 shot dimension의 applicable/score, 모든 shot issue 전문,
모든 set dimension, set issue, verdict를 포함한다. issue에는 generatedEvidence,
contractEvidence, referenceBindingId와 detail이 있어야 한다. positive는 별도 표기가
없으면 모든 applicable score 5, issues 없음, pass다.

## 3. 필수 asset cases

| ID | 한 observable 차이 | negative exact oracle |
|---|---|---|
| GI1 | 중심 빨간 컵 존재 ↔ 완전 누락 | shot 0 `scene_fidelity=1/critical`, issue 1, verdict issues_found |
| GI2 | 정면 eye-level ↔ 명백한 overhead | `capture_and_composition=3/major` only |
| GI3 | 손만 보이는 partial ↔ 얼굴 선명 노출 | `character_presentation=1/critical` only |
| GI4 | identity-purpose-only reference와 동일 인물 ↔ 명백히 다른 인물 | `identity_and_appearance=1/critical`; reference_adherence=false/null |
| GI5 | environment preserve 구조 유지 ↔ 구조 변경 | `reference_adherence=3/major` only |
| GI6 | 고유 벽화 avoidCopying 미재현 ↔ 형상·배치 실질 재현 | `reference_adherence=3/major` only |
| GI7 | 두 컷 core locked 빨간 외투 ↔ 한 컷 파란 외투 | set `set_continuity=1/critical` only |
| GI8 | 각 scene은 독립 충족하며 컵/창문 emphasis 구분 ↔ 둘 다 같은 emphasis | set `set_distinctness=3/major`, shot 차원 all5 |
| GI9 | 핵심 exact 간판 `OPEN` ↔ 의미가 다른 `CLOSED` | `text_fidelity=1/critical` only |
| GI10 | 중심 손 정상 ↔ 손가락 융합 | `visual_integrity=3/major` only |
| GI11 | photo visualStyle ↔ 수채화 | `style_fidelity=1/critical` only |
| GI12 | reference 없는 비식별 silhouette | identity/reference/style/text N/A; 나머지 5/pass |
| GI13 | 같은 작고 가려진 인물 픽셀, identity 보존 요구 없음 ↔ 필수 | positive identity N/A/pass ↔ negative identity applicable 1/critical/issues_found |
| GI14 | partial hand의 required red nails ↔ black nails | `identity_and_appearance=3/major`, presentation=5 |
| GI15a | ImagePlan exact text 없음, prompt만 `CAFE` 발명; 이미지 text가 다름 | text false/null, 다른 계약 충족 시 pass |
| GI15b | GI15a와 같은 픽셀·prompt, ImagePlan만 exact text=`CAFE` 요구 | text true, `text_fidelity=3/major`, issue 1, issues_found |
| GI17 | intended scale에서 식별 가능하지만 의미·계약을 바꾸지 않는 국소 artifact 하나 | `visual_integrity=4/minor`, issue 1, 다른 applicable 5, pass |
| GI18 | 같은 shot의 독립적인 중심 손 융합과 중심 반사 파손 | `visual_integrity=2`, major issue 2, 다른 applicable 5, issues_found |
| GI16 | 두 컷 중 둘째가 첫째 복제되어 자기 scene 실패 | 둘째 `scene_fidelity=1/critical`, set_distinctness=5 |

## 4. False-positive controls

- 동일 인물의 허용된 표정·조명·원근 변화
- 평범한 흰 벽처럼 흔한 reference 유사성
- visualStyle이 의도한 해부학적 과장
- exact text가 요구되지 않은 배경 글자
- appliesToShots가 겹치지 않는 의상 변화
- 같은 장소지만 서로 다른 사건 beat와 visualPurpose
- 작은 비핵심 artifact가 intended display scale에서 보이지 않는 경우

위 목록도 asset 제작 시 각각 FP1~FP7 case ID, full contract, positive/negative 또는
단일 control asset, 전 차원 exact oracle과 hash를 갖춘다.

fixture는 두 종류를 명시적으로 허용한다.

- pixel mutation: 계약은 같고 observable pixel construct 하나만 변경
- contract/applicability mutation: 픽셀은 같고 applicability를 결정하는 계약 필드
  하나만 변경

GI13과 GI15는 두 번째 유형이며 나머지는 첫 번째 유형이다.

score threshold calibration은 GI17과 GI18로 고정한다.

## 5. Freeze와 리뷰

asset 제작 후 모든 PNG와 JSON의 SHA-256을 `MANIFEST.sha256`에 기록한다. 최소 두
vision reviewer는 동일 원본 파일을 보고 서로의 결과 없이 평가한다. applicable,
owner/non-owner, issue 수, score/severity, evidence와 verdict가 완전히 일치해야 한다.
불일치는 평균하지 않고 ground truth 또는 prompt 기준을 수정한 뒤 전 case를 다시
실행한다.
`contract.json`과 manifest에는 이 asset set이 검증하는
`evaluatorContractSha256`도 기록하고 hash 검증 대상에 포함한다.
