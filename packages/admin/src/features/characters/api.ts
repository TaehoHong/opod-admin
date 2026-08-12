import { apiRequest } from "../../shared/api/apiClient";
import { toQuery, type CursorPage } from "../../shared/api/useCursorList";

// feature가 자신의 endpoint와 contract를 소유한다
// (docs/06-architecture.md "Frontend").

export type CharacterStatus = "active" | "inactive";

export type CharacterCreate = {
  publicId: string;
  displayName: string;
  bio: string;
  interests: string[];
};

export type Character = CharacterCreate & {
  id: string;
};

export type CharacterListItem = Character & {
  status: CharacterStatus;
  postCount: number;
  followerCount: number;
  createdAt: string;
};

export type CharacterPersona = {
  id: string;
  characterId: string;
  title: string;
  content: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type CharacterMemory = {
  id: string;
  characterId: string;
  content: string;
  type: string;
  reason: string;
  createdAt: string;
  updatedAt: string;
};

export type CharacterDetail = CharacterListItem & {
  personas: CharacterPersona[];
  memories: CharacterMemory[];
};

export type CharacterProfileImage = {
  characterId: string;
  image: {
    id: string;
    url: string;
    width?: number;
    height?: number;
  } | null;
  crop: { x: number; y: number; zoom: number };
};

export type VisualProfile = {
  characterId: string;
  appearancePrompt: string;
  stylePrompt: string;
  negativePrompt: string;
  providerConfig?: unknown;
  referenceMedia: Array<{
    mediaId: string;
    url: string;
    sortOrder: number;
    isActive: boolean;
    description: string;
  }>;
  updatedAt?: string;
};

export type PostingPolicy = {
  characterId: string;
  enabled: boolean;
  weeklyCadence: number;
  hourStartKst: number;
  hourEndKst: number;
  updatedAt?: string;
};

export type CharacterActionLog = {
  id: string;
  characterId: string;
  actionType: string;
  targetTable?: string;
  targetId?: string;
  reason: string;
  createdAt: string;
};

export function fetchCharacters(params: {
  status?: string;
  cursor?: string;
  limit?: string;
}): Promise<CursorPage<CharacterListItem>> {
  return apiRequest(`/characters${toQuery(params)}`);
}

export function fetchCharacterActionLogs(params: {
  characterId: string;
  cursor?: string;
  limit?: string;
}): Promise<CursorPage<CharacterActionLog>> {
  return apiRequest(`/character-action-logs${toQuery(params)}`);
}

export function createCharacter(body: CharacterCreate): Promise<Character> {
  return apiRequest("/characters", { method: "POST", body });
}

export function fetchCharacter(characterId: string): Promise<CharacterDetail> {
  return apiRequest(characterPath(characterId));
}

export function updateCharacter(
  characterId: string,
  body: Pick<CharacterCreate, "displayName" | "bio" | "interests">,
): Promise<Character> {
  return apiRequest(characterPath(characterId), {
    method: "PATCH",
    body,
  });
}

export function updateCharacterStatus(
  characterId: string,
  body: { status: CharacterStatus; reason: string },
): Promise<{ id: string; status: CharacterStatus; updatedAt: string }> {
  return apiRequest(`${characterPath(characterId)}/status`, {
    method: "PATCH",
    body,
  });
}

export function deleteCharacter(
  characterId: string,
  reason: string,
): Promise<{ id: string; status: "inactive"; updatedAt: string }> {
  return apiRequest(characterPath(characterId), {
    method: "DELETE",
    body: { reason },
  });
}

export function fetchCharacterProfileImage(
  characterId: string,
): Promise<CharacterProfileImage> {
  return apiRequest(`${characterPath(characterId)}/profile-image`);
}

export function setCharacterProfileImage(
  characterId: string,
  body: {
    mediaId: string;
    crop: { x: number; y: number; zoom: number };
  },
): Promise<CharacterProfileImage> {
  return apiRequest(`${characterPath(characterId)}/profile-image`, {
    method: "PUT",
    body,
  });
}

export function clearCharacterProfileImage(
  characterId: string,
): Promise<CharacterProfileImage> {
  return apiRequest(`${characterPath(characterId)}/profile-image`, {
    method: "DELETE",
  });
}

export function createPersona(
  characterId: string,
  body: { title: string; content: string; sortOrder?: number },
): Promise<CharacterPersona> {
  return apiRequest(`${characterPath(characterId)}/personas`, {
    method: "POST",
    body,
  });
}

export function createPersonas(
  characterId: string,
  items: Array<{ title: string; content: string }>,
): Promise<{ items: CharacterPersona[] }> {
  return apiRequest(`${characterPath(characterId)}/personas/bulk`, {
    method: "POST",
    body: { items },
  });
}

export function reorderPersonas(
  characterId: string,
  personaIds: string[],
): Promise<{ items: CharacterPersona[] }> {
  return apiRequest(`${characterPath(characterId)}/personas/order`, {
    method: "PUT",
    body: { personaIds },
  });
}

export function updatePersona(
  characterId: string,
  personaId: string,
  body: { title: string; content: string; sortOrder: number },
): Promise<CharacterPersona> {
  return apiRequest(
    `${characterPath(characterId)}/personas/${encodeURIComponent(personaId)}`,
    { method: "PATCH", body },
  );
}

export function deletePersona(
  characterId: string,
  personaId: string,
): Promise<{ id: string; deletedAt: string }> {
  return apiRequest(
    `${characterPath(characterId)}/personas/${encodeURIComponent(personaId)}`,
    { method: "DELETE" },
  );
}

export function createMemory(
  characterId: string,
  body: { content: string; type: string; reason: string },
): Promise<CharacterMemory> {
  return apiRequest(`${characterPath(characterId)}/memory`, {
    method: "POST",
    body,
  });
}

export function createMemories(
  characterId: string,
  items: Array<{ content: string; type: string; reason: string }>,
): Promise<{ items: CharacterMemory[] }> {
  return apiRequest(`${characterPath(characterId)}/memory/bulk`, {
    method: "POST",
    body: { items },
  });
}

export function updateMemory(
  characterId: string,
  memoryId: string,
  body: { content: string; type: string; reason: string },
): Promise<CharacterMemory> {
  return apiRequest(
    `${characterPath(characterId)}/memory/${encodeURIComponent(memoryId)}`,
    { method: "PATCH", body },
  );
}

export function deleteMemory(
  characterId: string,
  memoryId: string,
): Promise<{ id: string; deletedAt: string }> {
  return apiRequest(
    `${characterPath(characterId)}/memory/${encodeURIComponent(memoryId)}`,
    { method: "DELETE" },
  );
}

export function fetchVisualProfile(
  characterId: string,
): Promise<VisualProfile> {
  return apiRequest(`${characterPath(characterId)}/visual-profile`);
}

export function updateVisualProfile(
  characterId: string,
  body: Pick<
    VisualProfile,
    "appearancePrompt" | "stylePrompt" | "negativePrompt"
  >,
): Promise<VisualProfile> {
  return apiRequest(`${characterPath(characterId)}/visual-profile`, {
    method: "PUT",
    body,
  });
}

export function setVisualProfileReferences(
  characterId: string,
  mediaIds: string[],
): Promise<VisualProfile> {
  return apiRequest(`${characterPath(characterId)}/visual-profile/references`, {
    method: "PUT",
    body: { mediaIds },
  });
}

export function captionVisualProfileReferences(characterId: string): Promise<{
  captioned: number;
  failed: Array<{ mediaId: string; error: string }>;
  pending: number;
}> {
  return apiRequest(`${characterPath(characterId)}/visual-profile/captions`, {
    method: "POST",
  });
}

export function enqueueVisualProfileTest(
  characterId: string,
  scene: string,
): Promise<{ jobId: string; prompt: string; status: string }> {
  return apiRequest(
    `${characterPath(characterId)}/visual-profile/test-generation`,
    { method: "POST", body: { scene } },
  );
}

export function fetchPostingPolicy(
  characterId: string,
): Promise<PostingPolicy> {
  return apiRequest(`${characterPath(characterId)}/posting-policy`);
}

export function updatePostingPolicy(
  characterId: string,
  body: Omit<PostingPolicy, "characterId" | "updatedAt">,
): Promise<PostingPolicy> {
  return apiRequest(`${characterPath(characterId)}/posting-policy`, {
    method: "PUT",
    body,
  });
}

function characterPath(characterId: string): string {
  return `/characters/${encodeURIComponent(characterId)}`;
}
