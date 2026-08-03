# React 전환에서 유실된 legacy 기능

전환 완료 commit `24855b5` 직전의 정적 SPA(`packages/admin/main.js`,
`styles.css`)와 React 화면(`packages/admin/src/`)을 대조한 기록이다.
대조 방법: legacy의 `data-action`(폼 29종)·`data-act`(클릭 58종), 라우트
파서, 테이블 헤더, 필터 상태(`ui.filters`)를 모두 뽑아 React에서 대응을 찾았다.

증거 확인 방법:

```
git show 24855b5^:packages/admin/main.js
git log -S"<키워드>" -- packages/admin
```

**2026-08-03에 확인된 15건을 모두 복원했다.** 아래는 무엇을 어떻게 되살렸는지와
남은 한계다.

## 복원 완료

| #   | 유실 기능                    | 복원 방식                                                                                      |
| --- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| 0   | 이미지 클릭 확대             | `shared/ui/ZoomableImage` — 초안 후보·레퍼런스, 생성 후보, LLM 로그, 미디어, 게시글, 캐릭터 전반 |
| 0   | 원본/마감 비교 슬라이더      | `ImageLightbox`의 compare 모드 (마감 프리셋이 걸린 후보는 확대가 곧 비교)                       |
| 0   | 초안 생성 후 상세 이동       | `DraftsPage`가 생성 응답의 id로 상세를 열고 그 자리로 스크롤                                    |
| ①   | URL 상세 라우트              | `app/routes.tsx`의 `DETAIL_ROUTES` + `shared/routing/useDetailSelection`                        |
| ②   | 비주얼 프로필 최근 생성·승격 | `CharacterVisualPanel`의 `RecentGenerations`                                                    |
| ③   | 캐릭터 기획 큐 등록·최근 초안 | `CharacterAutomationPanel`의 `CharacterDraftQueue`                                              |
| ④   | 생성 목록 → 초안 링크        | `GenerationPage`의 `JobActions`에 "초안 보기"                                                   |
| ⑤   | 누르고 원본 비교             | `CandidateCard` — 누르는 동안(마우스·터치·키보드 포커스) 썸네일이 원본으로                      |
| ⑥   | 크레딧 금액 프리셋           | `CreditGrantModal`의 `AMOUNT_PRESETS`                                                            |
| ⑦   | 캐릭터·사용자 이름 해석      | `shared/ui/EntityName`의 `CharacterName` / `UserName` (미해석은 8자 축약 + title에 전체 ID)      |
| ⑧   | 게시글 목록 작성 캐릭터·미디어 | `PostsPage` 열 추가, `mediaLabel()`로 종류 ×장수 요약                                          |
| ⑨   | 신고 목록 신고자             | `ModerationPage` 열 추가                                                                        |
| ⑩   | 캐릭터 목록 Bio·관심사       | `CharactersPage` 열 추가                                                                        |
| ⑪   | LLM 로그 연결 ID·미디어      | `LlmLogsPage` 열 추가 (연결은 generationJobId, 없으면 캐릭터)                                   |
| ⑫   | 미디어 목록 생성일           | `MediaPage` 열 추가                                                                             |
| ⑬   | 프로필 크롭 슬라이더·실시간 미리보기 | `ProfileCrop.module.css` + controlled form (정사각형 크롭이 즉시 반영)                     |
| ⑭   | 프로필 이미지 썸네일 선택    | 파일명 Select → 썸네일 그리드 + "이미지 더 보기"(cursor 페이지네이션)                            |
| ⑮   | 성공 피드백                  | `shared/ui/MutationAlert`를 초안·미디어·신고·생성 화면까지 확대                                  |

## URL 라우트 계약

`/posts/:postId`, `/media/:mediaId`, `/drafts/:draftId`, `/generation/new`,
`/generation/:jobId`, `/llm-logs/:logId`, `/users/:userId`,
`/payments/:paymentId`. 캐릭터와 장소는 상세가 독립 페이지라
`/characters/:characterId`, `/locations/:locationId`를 각각의 페이지 컴포넌트가
받는다.

legacy와 같은 형태라 예전 북마크가 그대로 열린다. 상세의 표현(인라인 패널 또는
modal)은 React 화면 그대로 두고 "무엇을 열어 두었는가"만 URL이 소유한다.
legacy의 캐릭터 탭 URL(`/characters/:id/:tab`)은 복원하지 않았다 — 캐릭터 관리가
모달에서 페이지로 옮겨졌고(`CharacterManagerPage`), 탭은 그 페이지가 내부
상태로 가진다.

## 남은 한계

- 사용자 이름은 `/users?limit=100` 한 번을 캐시해서 맞춘다. 그 밖의 사용자는
  legacy와 동일하게 8자 축약으로 보인다. 정확히 하려면 크레딧·결제·이벤트
  응답에 사용자 label을 포함하는 백엔드 변경이 필요하다.
- legacy의 토스트는 복원하지 않았다. 성공·실패는 각 화면 안의 인라인 알림으로
  알린다(`MutationAlert`). 화면 전환이 있는 modal 계열은 닫히는 것이 곧 성공
  신호다.
