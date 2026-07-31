import { apiRequest } from "../../shared/api/apiClient";
import { toQuery, type CursorPage } from "../../shared/api/useCursorList";

export type MediaType = "image" | "video";

export type MediaItem = {
  id: string;
  mediaType: MediaType;
  url: string;
  contentType?: string;
  byteSize?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  uploadedAt: string | null;
  createdAt: string;
};

export type MediaUploadTicket = {
  media: MediaItem;
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
};

export function fetchMediaList(params: {
  mediaType?: string;
  uploaded?: string;
  cursor?: string;
}): Promise<CursorPage<MediaItem>> {
  return apiRequest(`/media${toQuery(params)}`);
}

export function fetchMedia(mediaId: string): Promise<MediaItem> {
  return apiRequest(`/media/${encodeURIComponent(mediaId)}`);
}

export function startMediaUpload(body: {
  mediaType: MediaType;
  contentType: string;
  fileName: string;
  byteSize?: number;
  width?: number;
  height?: number;
  storagePrefix?: string;
}): Promise<MediaUploadTicket> {
  return apiRequest("/media/uploads", { method: "POST", body });
}

export function confirmMediaUpload(mediaId: string): Promise<MediaItem> {
  return apiRequest(`/media/${encodeURIComponent(mediaId)}/confirm-upload`, {
    method: "POST",
  });
}

// 캐릭터 프로필처럼 파일 선택부터 연결까지 한 화면에서 끝나야 하는 흐름은
// presign → object storage PUT → confirm을 순서대로 수행한다. 각 단계가
// 성공하기 전에는 다음 단계로 넘어가지 않는다.
export async function uploadMediaFile(
  file: File,
  mediaType: MediaType,
  storagePrefix?: string,
): Promise<MediaItem> {
  const ticket = await startMediaUpload({
    mediaType,
    contentType: file.type || `${mediaType}/octet-stream`,
    fileName: file.name,
    ...(file.size > 0 ? { byteSize: file.size } : {}),
    ...(storagePrefix ? { storagePrefix } : {}),
  });
  const uploaded = await fetch(ticket.uploadUrl, {
    method: ticket.method,
    headers: ticket.headers,
    body: file,
  });
  if (!uploaded.ok) {
    throw new Error(
      `${file.name} 업로드에 실패했습니다 (${uploaded.status}). 다시 시도해 주세요.`,
    );
  }
  return confirmMediaUpload(ticket.media.id);
}

// URL 마지막 segment가 실제 파일 이름이다. 실패하면 ID로 되돌린다.
export function mediaFileName(media: MediaItem): string {
  try {
    const path = new URL(media.url, "http://media.local").pathname;
    return decodeURIComponent(path.split("/").pop() ?? "") || media.id;
  } catch {
    return media.id;
  }
}

export function mediaSizeLabel(media: MediaItem): string {
  return media.byteSize ? `${(media.byteSize / 1048576).toFixed(1)} MB` : "—";
}

export function mediaDimensionsLabel(media: MediaItem): string {
  const size =
    media.width && media.height ? `${media.width}×${media.height}` : "";
  const duration = media.durationSeconds ? `${media.durationSeconds}s` : "";
  return [size, duration].filter(Boolean).join(" · ") || "—";
}
