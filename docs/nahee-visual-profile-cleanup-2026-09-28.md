# 나희 비주얼 설정 정리 — 2026-09-28

사용자가 승인한 캐릭터 설정 정리만 개발 DB에 적용했다. 이번 사례를 막는 Agent 프롬프트 규칙은 추가하지 않았다.

- 캐릭터: `01a03bad-e68e-76c6-a42b-1bdecca1cb57`
- 적용: 2026-09-28 16:57 KST. 별도 프로세스에서 기존 VisualProfileService로 재조회하고 기대값과 일치함을 확인했다.
- 외형: 정면 시선과 반미소를 고정하는 구절만 제거했다. 나이·키·체형·피부색·얼굴·헤어는 유지했다.
- 레퍼런스 설명: 얼굴/헤어, 전신 체형, 패션 스타일의 역할을 명확히 했다. 원본의 표정·포즈 등을 매번 보존하라는 지시는 제거했다. 원본 이미지·URL·ID·순서·활성 상태는 유지했다.
- 제외 조건: 반복된 해부학 오류 주문과 일반적인 plastic skin 문구를 정리했다. 체형의 긍정형 설명은 외형에 보존했다. 실존인 닮은꼴, 아동 같은 외형, 노출 관련 제한, 강한 에어브러싱, 어안 왜곡, 로고·텍스트·워터마크 제외는 유지했다.
- 사진 스타일과 character_content_profiles, character_posting_policies, 채팅 페르소나·메모리는 이번 작업에서 수정하지 않았다.

## 저장 경로와 검증

기존 owner인 VisualProfileService에 `updateReferenceDescription`만 추가했다. 캐릭터 소유 참조 확인, 빈 값/길이 검증, 기존 Repository를 통한 갱신과 작업 로그를 수행한다. 새 HTTP 경로나 UI는 추가하지 않았다.

검증한 컴파일 결과 중 이 서비스만 개발 컨테이너의 별도 유지보수 프로세스에 로드하여 적용했다. 애플리케이션 파일을 교체하거나 재시작하지 않았다. 설정 반영 시점에는 코드를 커밋·푸시·배포하지 않았고, 데이터 변경만 반영했다. 따라서 서비스의 앱 배포와 데이터 적용 시점은 별개다.

- 단위 테스트: 해당 서비스 13개, 전체 52 suites / 523 tests 통과.
- lint / build / 변경 파일 Prettier 검사 통과.
- 변경 전 프로필과 재조회 값 일치를 확인한 후 저장했고, 저장 후 기대값 및 보존할 필드를 다시 비교했다. 이 확인은 원자적 CAS 보장을 새로 추가한 것은 아니다.
- 생성된 기존 초안/프롬프트는 수정하지 않았다. 변경 효과 확인은 이미지 기획부터 다시 실행해야 한다.
- 이미지 생성·LLM 호출은 하지 않았다. 실제 이미지 자연스러움 개선은 검증하지 않았다.

## 변경된 텍스트

### appearancePrompt

변경 전:

Original fictional Korean woman named Nahee, age 26, about 165 cm, realistic 7.5-head adult proportions, noticeably full upper-body volume, defined but not pinched waist, moderately curvy pelvis only slightly wider than the shoulders, natural hip dips and balanced thighs. Warm ivory skin, softly angular oval face, subtly upturned dark-brown eyes, defined straight brows, a tiny beauty mark below the outer corner of her left eye, softly full lips, long dark cherry-brown center-parted hair in polished loose waves, calm direct gaze and a restrained confident half-smile.

변경 후:

Original fictional Korean woman named Nahee, age 26, about 165 cm, realistic 7.5-head adult proportions, noticeably full upper-body volume, defined but not pinched waist, moderately curvy pelvis only slightly wider than the shoulders, natural hip dips and balanced thighs. Warm ivory skin, softly angular oval face, subtly upturned dark-brown eyes, defined straight brows, a tiny beauty mark below the outer corner of her left eye, softly full lips, long dark cherry-brown center-parted hair in polished loose waves.

### negativePrompt

변경 전:

real celebrity or influencer resemblance, copied likeness, childlike appearance, oversized head, extreme breast enlargement, pinched waist, shelf-like hips, abrupt waist-to-hip curve, mismatched pelvis and thighs, elongated legs, distorted anatomy, extra fingers or limbs, explicit nudity, transparent fabric, wardrobe malfunction, pornographic pose, fetish styling, plastic skin, heavy airbrushing, fisheye distortion, readable brand logo, text, watermark

변경 후:

real celebrity or influencer resemblance or copied likeness, childlike appearance, explicit nudity, transparent fabric, wardrobe malfunction, pornographic pose, fetish styling, heavy airbrushing, fisheye distortion, readable brand logo, text, watermark

### 레퍼런스 01a03bad-e693-760e-846f-8740d0aa88d3

변경 전:

나희의 얼굴과 헤어 정체성 기준 상반신 포트레이트. 26세 한국 여성, 부드럽게 각진 타원형 얼굴, 살짝 올라간 짙은 갈색 눈매, 일자형 눈썹, 왼쪽 눈 바깥 아래의 작은 점, 체리브라운 중앙 가르마 장발과 절제된 반미소를 보존한다. 얼굴 기준으로 우선 사용하며 배경·크롭·의상은 복제하지 않는다.

변경 후:

나희의 얼굴과 헤어 정체성 기준 상반신 포트레이트. 왼쪽 눈 바깥 아래의 작은 점과 체리브라운 중앙 가르마 장발은 주요 식별 특징이다. 원본의 표정·시선·조명·배경·크롭·의상은 정체성 보존 범위에 포함하지 않는다.

### 레퍼런스 01a03bad-e695-772c-b4cb-e11599054599

변경 전:

나희의 전신 체형 기준. 풍만한 상체 볼륨, 과도하게 조이지 않은 허리, 어깨보다 약간 넓은 현실적인 골반과 자연스러운 허리·장골·허벅지 연결, 균형 잡힌 7.5등신을 보여준다. 이후 이미지에서 상체 볼륨은 유지하되 골반을 넓히거나 허리를 비현실적으로 줄이지 않는다.

변경 후:

나희의 성인 전신 체형과 비율 기준. 얼굴용 레퍼런스와 함께 사용해 나희의 고유한 체형을 참고한다. 원본의 의상·포즈·프레이밍·조명은 체형 보존 범위에 포함하지 않는다.

### 레퍼런스 01a03bad-e696-7049-bdf0-b153dae49205

변경 전:

나희의 메인 글래머 노출 스타일 기준. 검은 스트랩리스 미니드레스, 드러난 어깨·쇄골·팔·다리, 정면을 장악하는 시선과 자신감 있는 3/4 포즈를 보여준다. 노출은 수줍거나 우연한 상황이 아니라 본인이 선택하고 통제하는 성인 패션 연출로 사용한다.

변경 후:

나희의 글래머 패션 스타일 참고 이미지. 검은 스트랩리스 미니드레스와 드러난 어깨·쇄골·팔·다리, 자신감 있는 3/4 포즈를 보여준다. 본인이 선택하고 통제하는 성인 패션 연출을 참고하되, 이 사진의 의상·표정·시선·포즈를 모든 게시물에 고정하지 않는다.

이 문서는 적용된 설정의 이력이다. 이 변경이 사진 합성 느낌의 원인을 해결했다고 일반화하지 않는다.
