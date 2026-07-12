# Admin Post Media Upload Design

## Goal

Make post creation the only Admin UI entry point for media uploads. Operators
can drag and drop multiple images and videos into the new-post dialog, the
browser uploads those files directly to S3, and the post is created with the
stored media records in the same order.

## Current State

The Admin backend already supports the required presigned upload flow:

1. `POST /api/media/uploads` creates a pending `Media` row and returns a
   presigned S3 PUT URL.
2. The browser can PUT the file directly to S3.
3. `POST /api/media/:id/confirm-upload` marks the media as uploaded.
4. `POST /api/posts` accepts `media: [{ mediaId }, ...]` and connects confirmed
   media to the post with a `sortOrder` matching the array order.

The current UI does not use that flow from the visible new-post dialog. It asks
the operator to enter one media URL manually, while a separate Media screen
exposes pending media, upload initiation, and confirmation. A tested
`postPayload()` helper supports one selected file, but the active new-post
submit handler bypasses it.

When a custom `storagePrefix` such as `pod/feed/character/<id>` is supplied,
the upload service currently stores the S3 object key in `Media.url` rather
than the generated public URL.

## Scope

- Remove the Media item from Admin navigation.
- Remove the Media list, detail view, filters, selection state, pending badge,
  separate upload dialog, and their UI event handlers.
- Keep the Admin media upload and confirmation API endpoints because post
  creation uses them.
- Replace the new-post media type and URL fields with one drag-and-drop file
  picker.
- Accept multiple image and video files in one post, including a mixture of
  both media types.
- Show selected-file previews in selection order and allow an individual file
  to be removed before submission.
- Upload all selected files directly from the browser to S3 using presigned
  URLs, confirm every successful upload, and create the post only after all
  files are confirmed.
- Preserve selected-file order in the post's `media` array and therefore in
  `PostMedia.sortOrder`.
- Store the generated public S3/CDN URL in `Media.url` for every upload while
  retaining the object key in `Media.storageKey`.
- Render every attached image or video in the post detail view and display its
  media type and stored URL.

## Non-Goals

- Do not remove or redesign backend media APIs.
- Do not change the Prisma schema or create a database migration.
- Do not add a standalone media library, media picker, upload history, or
  pending-media management screen.
- Do not add drag-to-reorder behavior; drop and selection order is
  authoritative.
- Do not change story or generation-job media workflows.
- Do not add automatic S3 object deletion or database cleanup for an upload
  that succeeds before a later file or post request fails.

## Chosen Approach

Use the existing client-direct presigned upload flow for each file. This avoids
routing large image and video bodies through the NestJS Admin server and
requires no new storage API. The browser collects the confirmed media IDs and
sends one post creation request after the complete batch succeeds.

The alternatives were proxying multipart uploads through the Admin server and
creating the post before its uploads finish. Proxying increases server load
and timeout risk, while creating the post first can leave visible incomplete
posts. Both are less suitable than extending the already implemented
presigned-upload contract.

## UI Design

The new-post dialog keeps the character, body, hashtag, and log-reason fields.
The existing media type selector and URL input are replaced by a drop zone
backed by a hidden `input[type=file]` with `multiple` and
`accept="image/*,video/*"`.

The drop zone supports clicking to open the native picker and browser drag
events for adding files. Each accepted file appears in a preview card with an
image thumbnail or video preview, file name, detected media type, and remove
button. Adding another selection appends files rather than replacing the
current selection. The displayed card order is the upload and post order.

The post detail view adds a media gallery before the post statistics. Each
item uses an `<img>` or `<video controls>` according to `mediaType`, followed
by its type and escaped stored URL. The existing comments, reactions,
hashtags, and action-log sections remain unchanged.

## Data Flow

1. The operator adds one or more files to the new-post dialog.
2. The UI rejects a file unless its MIME type starts with `image/` or
   `video/`. The media type is derived from that MIME prefix.
3. On submit, the existing post fields and at least one accepted file are
   validated before network requests begin.
4. In selection order, the UI requests a presigned upload for one file with
   its media type, MIME content type, file name, byte size, and the existing
   `pod/feed/character/<characterId>` storage prefix.
5. The browser PUTs that file to its returned S3 URL using the returned method
   and headers, confirms the media record, and then advances to the next file.
6. After every file has completed those three steps, the UI creates the post
   with `media: [{ mediaId: firstId }, { mediaId: secondId }, ...]` in the
   original selection order.
7. The Admin service verifies that every referenced media record exists and
   is confirmed, then creates the post and its ordered `PostMedia` rows.
8. Post detail reads the existing `media` response array and renders the
   previews and stored URLs.

## URL Storage

`MediaService.startUpload()` always persists `signed.publicUrl` as
`Media.url`, including when a custom storage prefix is present. It continues
to persist `signed.storageKey` separately. Existing consumers remain
compatible because the public service already accepts HTTP media URLs and can
also resolve legacy key-only records through `storageKey`.

## Error Handling

- Unsupported files are rejected before upload and identify the offending
  file by name.
- Submitting without an accepted file is rejected before upload.
- A presign, S3 PUT, or confirmation failure identifies the file and prevents
  the post creation request.
- A post creation failure leaves the dialog open and reports the backend
  error through the existing error-toast behavior.
- Controls remain disabled while submission is running so one operator action
  cannot start duplicate upload batches.
- Media records or S3 objects that succeeded before a later failure can remain
  unlinked. Automatic cleanup is excluded because a lost post-create response
  is ambiguous: deleting uploaded objects could break a post that the server
  created successfully.

## Testing

Tests protect observable behavior with focused red-green cycles:

- Navigation no longer exposes a Media route, and authenticated routing falls
  back from `#media` to the default route.
- The new-post dialog contains a multiple image/video file input and no media
  type or media URL inputs.
- File collection accepts mixed images and videos, preserves selection order,
  appends later selections, removes one selected file, and rejects unsupported
  MIME types.
- Post submission performs presign, S3 PUT, and confirmation for every file,
  then sends one post request containing ordered media IDs.
- Any file upload failure prevents the post request and surfaces the file
  name.
- The post-detail media gallery renders image and video elements with escaped
  URLs.
- `MediaService` stores the public URL, not the object key, when a custom
  storage prefix is used.

Finish verification with the focused Admin UI test file, focused Media service
tests, the full Admin UI check, Nest unit tests, lint, and build.

## Change Boundaries

- UI work is limited to `packages/admin/index.html`,
  `packages/admin/main.js`, `packages/admin/styles.css`, and meaningful Admin
  UI tests.
- Backend work is limited to the URL value persisted by
  `src/admin/media/media.service.ts` and its focused test.
- Existing unrelated screens, routes, payloads, design tokens, and service
  behavior remain unchanged.
