import { apiRequest } from "../../shared/api/apiClient";
import { toQuery, type CursorPage } from "../../shared/api/useCursorList";

export type LocationScope = "all" | "global" | "character";

export type LocationReference = {
  mediaId: string;
  url: string;
  width: number | null;
  height: number | null;
  uploadedAt: string | null;
  sortOrder: number;
  description: string;
};

export type LocationItem = {
  id: string;
  characterId: string | null;
  character: { id: string; displayName: string; publicId: string } | null;
  locationKey: string;
  displayName: string;
  description: string;
  visualPrompt: string;
  negativePrompt: string;
  referenceCount: number;
  references: LocationReference[];
  createdAt: string;
  updatedAt: string;
};

export type LocationInput = {
  characterId: string | null;
  locationKey: string;
  displayName: string;
  description: string;
  visualPrompt: string;
  negativePrompt: string;
};

export function fetchLocations(params: {
  cursor?: string;
  scope?: LocationScope;
  characterId?: string;
}): Promise<CursorPage<LocationItem>> {
  return apiRequest(`/locations${toQuery(params)}`);
}

export function fetchLocation(locationId: string): Promise<LocationItem> {
  return apiRequest(locationPath(locationId));
}

export function createLocation(body: LocationInput): Promise<LocationItem> {
  return apiRequest("/locations", { method: "POST", body });
}

export function updateLocation(
  locationId: string,
  body: LocationInput,
): Promise<LocationItem> {
  return apiRequest(locationPath(locationId), { method: "PATCH", body });
}

export function deleteLocation(
  locationId: string,
): Promise<{ id: string; deletedAt: string }> {
  return apiRequest(locationPath(locationId), { method: "DELETE" });
}

export function setLocationReferences(
  locationId: string,
  references: Array<{ mediaId: string; description: string }>,
): Promise<LocationItem> {
  return apiRequest(`${locationPath(locationId)}/references`, {
    method: "PUT",
    body: { references },
  });
}

function locationPath(locationId: string): string {
  return `/locations/${encodeURIComponent(locationId)}`;
}
