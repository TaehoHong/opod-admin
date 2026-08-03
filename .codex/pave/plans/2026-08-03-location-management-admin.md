# Location management admin

Status: approved and in progress

## Scope and decisions

- [user-confirmed] 운영자는 별도 `장소` 화면에서 장소와 레퍼런스 이미지를 관리한다.
- [user-confirmed] 목록은 캐릭터로 필터링할 수 있다.
- [repo-evidenced] `characterId = null`은 범용 장소이며 UUID 값은 캐릭터 전용 장소다.
- [repo-evidenced] 기존 admin 인증·CSRF와 media presign → PUT → confirm 흐름을 재사용한다.
- [agent-assumed] 캐릭터 필터는 선택한 캐릭터의 전용 장소만 보여주고, 범용 장소는 별도 범위 필터로 조회한다.
- [agent-assumed] 레퍼런스 연결 해제는 관계만 지우며 media 원본은 보존한다.

## Implementation slices

- [x] Add location CRUD, filtering, soft deletion, and ordered reference APIs with focused behavior tests.
- [x] Add location list, character/scope filters, detail editing, upload, reorder, and unlink UI with contract tests.
- [x] Sync durable docs and run the full declared verification suite.
- [ ] Commit, push, deploy to development, and verify health.

## Acceptance

- Global and character-specific locations can be created, viewed, edited, and soft-deleted.
- The list can be filtered by character and scope.
- Only confirmed image media can be linked, descriptions and order are persisted, and unlinking does not delete media.
- Existing five Seorin gym references are visible and manageable through the same endpoints.

## Out of scope

- Automatic reference captioning.
- Deleting source media while unlinking a reference.
- Canonical schema or public service API changes.
