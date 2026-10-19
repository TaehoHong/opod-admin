import { apiRequest } from "../../shared/api/apiClient";
import type { Draft } from "../drafts/api";

export const REFERENCE_STAGES = [
  { id: "reference_select", label: "원본 선택" },
  { id: "image_prompt", label: "프롬프트" },
  { id: "generation", label: "이미지 생성" },
  { id: "caption", label: "캡션" },
] as const;
export type ReferenceStage = (typeof REFERENCE_STAGES)[number]["id"];
export type ReferenceShot = {
  shotId: string;
  sortOrder: number;
  mediaId: string;
  influencerId: string;
  postId: string;
  slideIndex: number;
  mediaKey: string;
  sha256: string;
  sourceCaption: string | null;
  reason: string;
  visualReferences?: Record<string, unknown>[];
  sourceComposition?: { content?: { personCount?: number } };
  url?: string;
};
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
export function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}
export function referenceView(draft: Draft) {
  const concept = record(draft.conceptJson);
  const selection = record(concept.referenceSelection);
  const prompt = record(concept.promptBuild);
  const caption = record(concept.captionBuild);
  const shots = rows(selection.shots)
    .filter(
      (s) =>
        typeof s.shotId === "string" &&
        typeof s.sortOrder === "number" &&
        typeof s.mediaId === "string" &&
        typeof s.sha256 === "string" &&
        typeof s.influencerId === "string" &&
        typeof s.postId === "string" &&
        typeof s.slideIndex === "number",
    )
    .map(
      (s) =>
        ({
          ...s,
          url: typeof s.url === "string" ? s.url : undefined,
          mediaKey: text(s.mediaKey),
          reason: text(s.reason),
          sourceCaption:
            typeof s.sourceCaption === "string" ? s.sourceCaption : null,
        }) as ReferenceShot,
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return { selection, prompt, caption, shots };
}
export async function fetchReferenceSource(
  shot: ReferenceShot,
): Promise<string | null> {
  if (shot.url) return shot.url;
  const query = new URLSearchParams({
    influencerId: shot.influencerId,
    postId: shot.postId,
    slideIndex: String(shot.slideIndex),
    limit: "100",
  });
  const response = await apiRequest<{
    items: { id: string; sha256?: string; url?: string; imageUrl?: string }[];
  }>(`/influencer-media?${query}`);
  const match = response.items.find(
    (item) => item.id === shot.mediaId && item.sha256 === shot.sha256,
  );
  return match?.url ?? match?.imageUrl ?? null;
}

export async function fetchReferenceIdentity(
  characterId: string,
  reference: Record<string, unknown>,
): Promise<string | null> {
  const media = record(reference.media);
  if (text(media.url)) return text(media.url);
  const storageKey = text(media.storageKey);
  if (!storageKey) return null;
  const profile = await apiRequest<{
    referenceMedia: { storageKey?: string; url: string }[];
  }>(`/characters/${encodeURIComponent(characterId)}/visual-profile`);
  return (
    profile.referenceMedia.find((item) => item.storageKey === storageKey)
      ?.url ?? null
  );
}
