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
}): Promise<MediaUploadTicket> {
  return apiRequest("/media/uploads", { method: "POST", body });
}

export function confirmMediaUpload(mediaId: string): Promise<MediaItem> {
  return apiRequest(`/media/${encodeURIComponent(mediaId)}/confirm-upload`, {
    method: "POST",
  });
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
