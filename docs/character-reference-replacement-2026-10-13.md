# 나희·해나 체형 레퍼런스 재생성·교체 — 2026-10-13

사용자 요청에 따라 수정 필수였던 나희 20·30과 해나 40·60을 재생성하고 개발 서버의 활성 레퍼런스로 교체했다. 등록 후 새 조회와 S3 원본 해시로 교체 결과를 검증했다. 기존 4장은 삭제하지 않고 비활성으로 보존했다.

## 변경과 검수

- 나희: 상체 볼륨과 얼굴·헤어는 유지하면서 상완·몸통·골반·허벅지를 함께 작은 체격으로 조정했다. 새 정면을 기준으로 사선 패션 컷의 체형을 맞췄다.
- 해나: 어깨·상완·몸통을 가볍게 조정하고, 정면의 팔 길이는 한 차례 더 보정해 팔꿈치·손목·손끝의 관계를 함께 바꿨다. 새 정면을 기준으로 팔을 든 보조 사진을 생성했다. 차콜 조거 팬츠는 부피가 적게 보이도록 조정했다.
- 두 캐릭터: 회색 배경과 부드러운 확산광, 약한 피부 반사로 정리했다. 해나 체형 자료의 기존 체육관 배경을 중립 배경으로 바꿨다.
- 내장 `image_gen`으로 총 5회 생성했다. 해나 정면 v2는 팔 길이 변경이 약해 채택하지 않았고 v3를 교체본으로 선택했다. 나머지 3장과 합쳐 최종 4장을 등록했다.
- 얼굴 정체성·신체 연결·지지와 접촉·두 체형 컷의 일관성을 직접 검수했다. 이는 기준 사진 용도의 검수이며 실제 새 SNS 장면에서의 조명 통합 효과를 검증한 결과는 아니다.
- 한소이·유하의 머리 비율 검토는 앞선 판정에서 수정 필수가 아니어서 이번 교체 범위에 포함하지 않았다.

[전후 비교](../../content-work/body-reference-replacement-20261013/before-after.jpg) · [사진별 검수](../../content-work/body-reference-replacement-20261013/visual-review.json)

## 교체된 파일

| 캐릭터·순서 | 최종 파일 | 새 mediaId |
| --- | --- | --- |
| 나희 20 | [nahee-front-v2.png](../../character-assets/nahee/references/body-correction-20261013/nahee-front-v2.png) | `01a132b8-1b8f-74b8-822a-b9f31f56f4f2` |
| 나희 30 | [nahee-three-quarter-v2.png](../../character-assets/nahee/references/body-correction-20261013/nahee-three-quarter-v2.png) | `01a132b8-1cd1-730b-8f29-bc4f1a34d5a6` |
| 해나 40 | [haena-front-v3.png](../../character-assets/haena/references/body-correction-20261013/haena-front-v3.png) | `01a132b8-1d80-7068-850f-11a52c410dc8` |
| 해나 60 | [haena-flex-v2.png](../../character-assets/haena/references/body-correction-20261013/haena-flex-v2.png) | `01a132b8-1e2c-761e-aefe-c33db66330ec` |

전체 기존 ID→새 ID, 설명, SHA-256, 크기와 해상도는 [교체 명세](../../content-work/body-reference-replacement-20261013/replacement-plan.json)와 [등록 저널](../../content-work/body-reference-replacement-20261013/journal.json)에 있다. 생성 입력과 프롬프트는 [정면 생성](../../content-work/body-reference-replacement-20261013/front-generation.json), [팔 길이 재보정·사선 생성](../../content-work/body-reference-replacement-20261013/second-generation.json), [팔을 든 사진 생성](../../content-work/body-reference-replacement-20261013/last-generation.json)에 보존했다.

## 등록 경로와 검증

기존 owner를 재사용했다(`owner-found`): `MediaService.startUpload` → presigned PUT → S3 SHA-256 대조 → `confirmUpload`, `VisualProfileService.setReferences`·`updateReferenceDescription`·`saveReferenceEmbedding`. 기존 `ReferenceEmbeddingClient`로 새 설명 4개의 1024차원 벡터만 만들고 본문 CAS 저장을 확인했다. 전체 참조 색인 작업은 실행하지 않았다. 앱 소스·스키마·DDL·배포를 바꾸지 않았다.

- 새 mediaId 4개가 기존 자리(나희 20·30, 해나 40·60)에 활성화됐다. 전체 활성 인물 참조 수는 35장을 유지한다.
- 기존 4개의 관계·설명·원본을 보존하고 활성만 해제했다. 다른 얼굴·체형 참조의 ID·순서·설명·활성 상태는 유지됐다.
- 6명의 Canon 및 비주얼 프로필의 외형·스타일·네거티브·provider 설정은 전후 같았다.
- 새 S3 원본 4개의 SHA-256이 선택한 로컬 생성본과 모두 같고, 이미지 크기·해상도·업로드 확정을 확인했다.
- 새 설명 4개와 `Qwen/Qwen3-Embedding-0.6B` 색인이 준비됐다. 교체 외 참조의 색인 메타데이터도 유지됐다.
- `register.cjs verify`를 교체 후 새로 실행해 모든 검증을 통과했다. 문서·링크 검증과 작업 스크립트 구문 검사도 수행했다. 앱 코드 수정이 없어 앱 단위/E2E 테스트는 실행하지 않았다.

[최종 검증](../../content-work/body-reference-replacement-20261013/verification.json) · [교체 전 백업](../../content-work/body-reference-replacement-20261013/before.json) · [교체 후 조회](../../content-work/body-reference-replacement-20261013/after.json)

## 현재 기준과 한계

기존 덩치·팔 길이 불합격 판정은 이전 mediaId에 대한 기록으로 유지한다. 이후 활성 참조는 이번 새 mediaId를 기준으로 삼는다. 후보 이미지의 8% 팔 길이 조정 요청은 생성 지침이며 실제 해부학적 실측값이라고 주장하지 않는다. 새 레퍼런스가 모든 장소의 조명 분리를 해결했다는 일반 효과는 아직 검증하지 않았다.

교체 직전에 목록·프로필 전체를 대조하고 변경 후 다시 검증했다. 기존 레퍼런스 세트 저장 owner에는 전체 세트 expected-version CAS가 없으므로 원자적 버전 CAS를 수행했다고 기록하지 않는다. 캡션 임베딩 저장의 본문 CAS는 별도로 확인했다.

## Knowledge Delta

사용자가 확인한 나희의 덩치, 해나의 덩치·팔 길이 불합격을 이번 교체 근거로 유지하고 새 활성 버전·검수·검증을 이 문서에 기록했다(`user-confirmed`, `repo-evidenced`). 모듈 소유 경계·개발 규칙은 바뀌지 않아 codebase guide는 수정하지 않았다.
