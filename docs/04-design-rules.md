# 04. Design Rules

## Product Tone

내부 운영자가 많은 상태와 위험한 작업을 빠르게 이해하는 도구다. 장식보다
정보 위계, 현재 상태, 영향 범위, 오류 복구와 다음 행동의 명확성을
우선한다.

- 기본 언어는 한국어다.
- 문구는 짧고 전문적으로 작성하며 사용자를 탓하지 않는다.
- 오류는 `문제 → 가능한 원인 → 다음 행동` 순서로 안내한다.
- raw ID, provider payload와 상세 진단정보는 기본 화면에 노출하지 않고
  필요할 때 펼쳐 본다.

## Visual Direction

Admin은 일반 사용자 제품이 아니라 운영 판단을 위한 콘솔이다. 어두운 shell과
밝은 작업 canvas를 분리해 전역 이동과 현재 작업의 경계를 분명히 한다.

- dark ink navigation shell
- warm cream operational canvas
- chartreuse primary accent는 선택, 실행과 현재 단계에만 사용
- 흰 surface, 중간 radius와 얇은 경계선으로 정보 덩어리를 구분
- 본문은 system sans, ID·시각·수치처럼 정렬이 필요한 값만 monospace
- 성공·주의·실패는 teal·amber·red와 상태 문구를 함께 사용

색상과 spacing 값은 Mantine Theme token으로 정의한다. 새로운 화면이
현재 CSS 값을 그대로 복사하기보다 승인된 token을 재사용하게 한다.

## Frontend Standard

승인된 목표 stack:

- React + TypeScript + Vite
- React Router
- TanStack Query
- Mantine
- `@mantine/form` uncontrolled mode
- Mantine Theme token + CSS Modules

현재 `packages/admin`은 이 stack으로 구현된 React 단일 frontend다.
`packages/admin/index.html`과 `src/main.tsx`가 entry이며 legacy 정적 SPA는
제거했다.

## Styling

- 공통 색상, typography, spacing, radius와 component default는 Mantine
  Theme에서 관리한다.
- 화면·feature 고유 스타일은 CSS Modules를 사용한다.
- Mantine 내부 element 조정은 Styles API와 `classNames`를 사용한다.
- inline style은 runtime 값처럼 동적으로 계산해야 하는 경우에만 사용한다.
- Tailwind와 styled-components를 기본 styling 방식으로 추가하지 않는다.
- 별도 공통 component는 실제 반복과 동일한 변경 이유가 생길 때만 만든다.

## Layout and Responsiveness

- Desktop-first로 설계한다.
- mobile-first 또는 desktop과 완전히 동일한 배치를 요구하지 않는다.
- 전역 navigation은 개요·콘텐츠·운영·시스템으로 묶고 현재 위치를 하나만
  강조한다.
- 모든 화면은 `DataPage`의 page title과 action 영역을 기본 위계로 사용한다.
- 복합 detail은 요약 header 뒤에 tab 또는 단계 rail을 두어 작업 맥락을
  유지한다.
- 긴 설정 form은 공급자나 책임 단위로 접어 필요한 부분만 열 수 있게 한다.
- 작은 화면에서도 로그인, 핵심 상태 조회와 긴급 자동화 중단이 가능해야
  한다.
- 고밀도 table은 정보를 숨기기보다 horizontal scroll을 허용할 수 있다.
- filter와 segmented control은 작은 화면에서 잘리지 않고 가로로 탐색할 수
  있어야 한다.
- primary action과 위험 상태는 viewport가 작아도 찾을 수 있어야 한다.

breakpoint, table column 축약과 chart 단위 같은 화면별 결정은 구현할 때
정한다.

## Interaction

- 화면은 현재 상태, 진행 중 상태, 완료 결과와 다음 행동을 구분한다.
- background 작업은 queued/running/completed/failed 상태를 숨기지 않는다.
- 중복 실행 위험이 있는 action은 pending 동안 재실행을 막는다.
- 결제, 환불, 크레딧, 제재와 자동화 중단은 대상과 영향을 보여준다.
- irreversible action은 현재 승인된 범위에 없으며 필요해지면 별도
  확인한다.
- form은 Mantine built-in `validate` function을 기본으로 사용한다.
- 실시간 field 반응이 꼭 필요한 form만 controlled mode를 사용한다.
- 최종 입력 검증은 Nest DTO가 담당한다.

## Accessibility

정식 인증을 목표로 하지는 않지만 핵심 흐름은 WCAG 2.2 AA 수준을
기본으로 삼는다.

- keyboard로 모든 핵심 기능을 사용할 수 있어야 한다.
- focus state를 제거하지 않는다.
- form control은 연결된 label과 오류 설명을 가진다.
- 텍스트와 상태 표현은 충분한 contrast를 유지한다.
- 색상만으로 성공, 경고와 실패를 구분하지 않는다.
- semantic HTML을 우선하고 필요한 경우에만 ARIA를 사용한다.
- Mantine component의 기본 접근성을 임의 스타일로 훼손하지 않는다.
