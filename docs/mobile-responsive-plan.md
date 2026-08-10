# Admin 콘솔 모바일 대응 계획 (2026-07-23 초안)

대상: `packages/admin` (index.html · styles.css · main.js).
현재 반응형은 `styles.css`의 미디어쿼리 2개(`max-width:900px`, `560px`)가 전부다.

## 근본 원인

**반응형 규칙은 CSS에 있는데, 실제 레이아웃은 `main.js`의 인라인 `style`에
하드코딩되어 있다.** 인라인 스타일은 미디어쿼리보다 우선순위가 높으므로,
지금 상태에서는 `styles.css`에 어떤 미디어쿼리를 추가해도 고정 그리드가
무너지지 않는다. 모바일 대응이 CSS만으로는 원천 차단되어 있는 상태다.

- `main.js`에 인라인 `grid-template-columns` **15곳** — `320px 1fr`,
  `1fr 340px`, `repeat(4,1fr)`, `1fr 1fr`(4회), `1fr 1fr 1fr`,
  `150px 1fr`, `120px 1fr`(2회), `minmax(0,1fr) 120px`(2회) 등.
- 인라인 `gap:56px` 4곳, `gap:48px` 4곳 — 1열로 안 무너진 상태에서 간격까지 겹침.

따라서 이 계획의 1순위 작업은 "미디어쿼리 추가"가 아니라
**인라인 레이아웃 → 유틸리티 클래스 치환**이다. `main.js` 전면 리팩터링이
아니라, 반응형을 막는 인라인만 골라 클래스화한다(약 40곳).

## 실측된 파손 목록

### A. 가로 스크롤 (치명 — 페이지 전체가 옆으로 밀림)

1. **테이블 14개, overflow 래퍼 없음.** 5~8열이고 `.table th`에
   `white-space:nowrap`이 걸려 있어 375px에서 최소 450~900px를 요구한다.
   `main.js` 1977(미디어 7열) · 2098(캐릭터 7열) · 2249(게시물 7열) ·
   2531(게시물 8열) · 2651(로그 5열) · 3003(생성작업 6열) · 3079(초안 5열) ·
   3924(사용자 5열) · 4003 · 4075 · 4160(결제 6열) · 4228(신고 6열) ·
   4288 · 4336.
2. **인라인 고정 그리드 15곳.** 특히 `320px 1fr`(4047 크레딧),
   `1fr 340px`(4284 이벤트), `repeat(4,1fr)`(4405 분석)은 375px에서 필연 파손.
3. **`.tabs-row`** — 캐릭터 상세 탭 7개 × `gap:28px`, 줄바꿈·스크롤 없음.
   필요 폭 약 450px vs 가용 335px.
4. **`padding-left:90px`** (2159, 캐릭터 상세 통계 줄) — 통계 4개 ×
   `gap:56px` + 90px 들여쓰기 = 약 458px 필요.
5. **`.section-head`** — `flex` + `justify-content:space-between`에
   `flex-wrap` 없음 → 제목과 세그먼트 컨트롤이 서로 찌그러진다.
   (`.toolbar`는 이미 `flex-wrap:wrap` — 여기는 문제없음.)

### B. 내비게이션 (체감 1순위)

`@media (max-width:900px)`에서 사이드바가 `flex-direction:row; flex-wrap:wrap`
으로 바뀐다. 그룹 제목 5개 + 항목 14개가 화면 상단에 가로로 흩뿌려지고,
375×812 기준 **약 380~420px** — 첫 화면 세로의 절반을 차지한 뒤에야 콘텐츠가
시작된다. 그룹 제목이 항목과 같은 흐름에 섞여 IA 계층도 읽히지 않는다.

### C. 터치 타깃 · 폼 입력

실측(폰트·패딩·라인하이트 합산):

| 요소 | 현재 높이 | 기준(iOS 44 / Material 48) |
| --- | --- | --- |
| `.btn` | 약 34px | 미달 |
| `.btn-ghost` | 약 30px | 미달 |
| `.seg-opt` | 약 29px | 미달 |
| `.nav-item` | 약 34px | 미달 |
| `.tab-link` | 약 38px | 미달 |
| `.table tr.clickable` | 약 39px | 미달 |

- **`.input` / `.btn` 폰트가 13.5px** — iOS Safari는 16px 미만 입력에 포커스하면
  **자동 확대되고 되돌아오지 않는다.** 폼 위주 콘솔에서 가장 치명적인 항목.

### D. 뷰포트 · 플랫폼

- `100vh` 3곳(styles.css 655 `.admin-shell`, 669 `.sidebar`,
  973 `.login-wrap`) — 모바일 주소창 때문에 실제 뷰포트보다 커서 하단이 잘린다.
  `100dvh` 필요.
- `<meta name="viewport">`에 `viewport-fit=cover` 없음 →
  `env(safe-area-inset-*)` 사용 불가. 노치/홈 인디케이터 영역 침범.
- `-webkit-text-size-adjust` 미설정 → 가로 회전 시 폰트 자동 확대.

### E. 오버레이

- `.toast` — `right:24px` + `max-width:380px`. 375px 화면에서 왼쪽 밖으로 나간다.
- `.dialog` — 375px에서 실 콘텐츠 폭 287px(배경 패딩 20 + 다이얼로그 패딩 24).
  파손까진 아니지만 내부 `120px 1fr` / `1fr 1fr 1fr` 그리드가 매우 협소하다.
  모바일에선 바텀시트가 적절.
- `.lightbox-close` — `top/right:20px`, 노치와 겹칠 수 있음.

### F. 타이포 밀도

`h1` 36px / `h2` 28px, 인라인 `font-size:36px`(2134 캐릭터명) ·
`32px`(1868 대시보드) · `.todo-count` 42px — 모두 모바일에서 과대.

## 브레이크포인트 재정의

현재 900 / 560px는 실기기 폭과 어긋난다(아이패드 세로 768, 아이폰 393~430).

| 신규 | 대상 | 동작 |
| --- | --- | --- |
| `≤1024px` | 태블릿 가로·세로 | 사이드바 → 드로어, 2열 유지 |
| `≤768px` | 모바일 전반 | 전 그리드 1열, 터치 타깃 확대, 16px 입력 |
| `≤430px` | 소형 폰 | 패딩·타이포 최소화 |

## 단계별 계획

### Phase 0 — 기반

- `100vh` → `100dvh` (3곳).
- `viewport-fit=cover` 추가 + `.admin-shell` / `.toast` / `.lightbox`에
  `env(safe-area-inset-*)` 적용.
- `-webkit-text-size-adjust:100%`.
- `≤768px`에서 `.input`, `select.input`, `textarea.input` **font-size 16px**
  (iOS 자동 확대 차단). 시각 밀도 보정은 `padding`으로.
- 기존 900/560 미디어쿼리를 1024/768/430으로 재편.

### Phase 1 — 모바일 내비게이션 ← 체감 1순위

- `≤1024px`: 사이드바를 **off-canvas 드로어**로. 상단에 고정 앱바
  (햄버거 · 현재 라우트 제목 · 아이덴티티).
- 드로어 내부는 **지금의 세로 그룹 구조를 그대로 유지** — 가로로 흩뿌리는
  현재 방식을 폐기해 IA 계층을 되살린다.
- 백드롭 탭 / ESC / 라우트 이동 시 자동 닫기, `aria-expanded`, 포커스 트랩,
  `body` 스크롤 잠금.
- 배지(`applyBadge`, main.js:5742)는 `sidebarNav` 안을 그대로 조회하므로
  드로어로 옮겨도 수정 불필요. 앱바에 미처리 건수 합계 배지 추가는 선택.

> **제약**: `test/smoke.test.mjs`가 `index.html`의 `data-route="…"` 등장
> 순서 == `main.js`의 `navItems` 순서를 검증한다. 햄버거·앱바 버튼에는
> `data-route`를 쓰면 안 된다 → `data-act` 사용. `.nav-item[data-route]`
> 셀렉터(main.js:5189, 5714, 5743)도 유지해야 한다.

### Phase 2 — 가로 스크롤 제거 ← 체감 2순위

- **테이블**: `.table-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch }`
  래퍼를 헬퍼 함수로 만들어 14곳 일괄 적용. 페이지는 고정되고 표만 스크롤한다.
  가장자리 페이드로 스크롤 가능함을 알린다.
- **인라인 그리드 15곳 → 유틸리티 클래스** 치환:
  `.grid-2` `.grid-3` `.grid-4` `.grid-side`(320px 1fr) `.grid-label`(150px 1fr).
  `≤768px`에서 전부 1열 + `gap` 축소(56/48px → 20px).
- `.tabs-row` → `overflow-x:auto`, 항목 `flex:none`, 스크롤바 숨김.
- `padding-left:90px` → 모바일 0, 통계 줄은 `flex-wrap:wrap`.
- `.section-head`에 `flex-wrap:wrap` 추가.

### Phase 3 — 터치 · 오버레이

- `≤768px`: `.btn` `min-height:44px`, `.btn-ghost` 40px, `.seg-opt` 44px,
  `.tab-link` 44px, `.nav-item` 48px, `.table td` 세로 패딩 확대.
- 툴바: 검색 `input` 100% 폭, 세그먼트 컨트롤 전폭 균등 분할.
- `.dialog` → `≤768px`에서 **바텀시트**(하단 고정, 상단 라운드,
  `max-height:90dvh`, 내부 스크롤, safe-area 하단 패딩).
  다이얼로그 내부 `120px 1fr` / `1fr 1fr 1fr` 1열화.
- `.toast` → `≤768px`에서 `left:12px; right:12px; max-width:none`.

### Phase 4 — 타이포 · 밀도

- `clamp()` 도입: `h2 clamp(22px,5.5vw,28px)`, `.todo-count clamp(32px,9vw,42px)`,
  인라인 36px/32px도 클래스화 후 clamp.
- `.admin-main` 패딩: `≤768px` 20px 16px, `≤430px` 16px 12px.
- 캐릭터 상세 헤더(아바타 68px + flex row) → `≤430px` 세로 스택.

### Phase 5 — 검증

- 실기기 폭 3종 확인: **393px**(iPhone 15) · **430px**(15 Pro Max) ·
  **768px**(iPad mini 세로).
- **가로 스크롤 회귀 테스트**: 라우트별로
  `document.documentElement.scrollWidth <= clientWidth` 단언.
  파손이 눈에 잘 안 띄는 종류라 자동화 가치가 크다.
- `npm run admin:check` · `npm run format` 통과.

## 표 처리 방식: **결정됨 (2026-07-23, 사용자 확정)**

전면 카드화는 14개 화면 × 열별 라벨 재작성이라 작업량이 이 계획의 나머지
전부와 맞먹는다. 다음으로 확정한다:

1. **Phase 2에서 14개 전부 스크롤 래퍼로 파손을 막는다** — 페이지 가로
   밀림은 여기서 전부 해소된다.
2. 모바일에서 자주 볼 화면 **초안 검수 · 생성 작업 · 신고 처리 · 게시물**
   3~4개만 이후 별도 단계에서 카드 뷰로 승격한다.
3. 나머지 정산·분석성 표(결제 · 크레딧 원장 · 분석 · 이벤트)는 데스크톱
   작업으로 남기고 카드화하지 않는다.

## 작업량 개요

- Phase 0~2가 핵심: `styles.css` +250~300줄, `main.js` 인라인 치환 약 40곳.
- Phase 3~4는 CSS 위주, `main.js` 변경 소량.
- 백엔드·API·스키마 변경 없음. `navItems` 구조 변경 없음.
