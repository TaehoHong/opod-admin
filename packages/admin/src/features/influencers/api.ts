import { apiRequest } from "../../shared/api/apiClient";
import { toQuery, type CursorPage } from "../../shared/api/useCursorList";

export type Influencer = {
  id: string;
  platform: string;
  username: string;
  url: string;
};

export type InfluencerMedia = {
  id: string;
  influencerId: string;
  influencer?: Influencer;
  postId: string;
  postUrl: string;
  slideIndex: number;
  assetType: "image" | "video_thumbnail";
  imageUrl: string;
  analysis: {
    model: string | null;
    version: string | null;
    content: {
      description: string;
      personCount?: number | null;
      framing?: string | null;
      pose?: string | null;
      hands?: string | null;
      gaze?: string | null;
      camera?: string | null;
      placement?: string | null;
      background?: string | null;
      wardrobe?: string | null;
      lighting?: string | null;
    };
  } | null;
};

export type MediaFilters = {
  characterId?: string;
  influencerId?: string;
  search?: string;
  assetType?: string;
  analysisStatus?: string;
};

export function fetchLibraryMedia(filters: MediaFilters, cursor?: string) {
  return apiRequest<CursorPage<InfluencerMedia>>(
    `/influencer-media${toQuery({ ...filters, cursor, order: "newest", limit: "30" })}`,
  );
}

export function registerInfluencer(url: string) {
  return apiRequest<Influencer>("/influencers", {
    method: "POST",
    body: { url },
  });
}

export function uploadInfluencerMedia(
  file: File,
  metadata: {
    influencerId: string;
    postUrl: string;
    postId: string;
    slideIndex: number;
    assetType: InfluencerMedia["assetType"];
  },
) {
  const body = new FormData();
  body.append("file", file);
  body.append("metadata", JSON.stringify({ ...metadata, analysis: null }));
  return apiRequest<{ id: string; created: boolean }>("/influencer-media", {
    method: "POST",
    body,
  });
}

export function searchInfluencers(
  search: string,
  cursor?: string,
  characterId?: string,
) {
  return apiRequest<CursorPage<Influencer>>(
    `/influencers${toQuery({ search, cursor, characterId, limit: "20" })}`,
  );
}
