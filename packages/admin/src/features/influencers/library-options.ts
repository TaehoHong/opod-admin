import { fetchCharacterReferenceDirectory } from "../characters/api";
import { searchInfluencers } from "./api";
export async function characterOptions(search: string, cursor?: string) {
  const page = await fetchCharacterReferenceDirectory({ search, cursor });
  return {
    ...page,
    items: page.items.map((item) => ({
      value: item.id,
      label: `${item.displayName} (@${item.publicId})`,
    })),
  };
}
export async function accountOptions(
  search: string,
  cursor?: string,
  characterId?: string,
) {
  const page = await searchInfluencers(search, cursor, characterId);
  return {
    ...page,
    items: page.items.map((item) => ({
      value: item.id,
      label: `@${item.username}`,
    })),
  };
}
