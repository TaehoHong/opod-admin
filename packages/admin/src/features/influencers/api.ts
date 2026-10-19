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

export function fetchInfluencers(
  cursor?: string,
): Promise<CursorPage<Influencer>> {
  return apiRequest(`/influencers${toQuery({ cursor, limit: "30" })}`);
}

export function fetchInfluencerMedia(
  influencerId: string,
  cursor?: string,
): Promise<CursorPage<InfluencerMedia>> {
  return apiRequest(
    `/influencer-media${toQuery({ influencerId, cursor, limit: "30" })}`,
  );
}
