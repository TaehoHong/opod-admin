import { BadRequestException, Injectable } from "@nestjs/common";
import { isUUID } from "class-validator";
import { decodeCursor, PageInput, pageFromRows } from "../shared/utils/page";
import { CharacterService } from "./character.service";
import { CharacterReferenceLinkService } from "./character-reference-link.service";

type ReferenceLink = Awaited<
  ReturnType<CharacterReferenceLinkService["list"]>
>[number];
type DirectoryItem = {
  id: string;
  publicId: string;
  displayName: string;
  referenceLinks: ReferenceLink[];
};

@Injectable()
export class CharacterReferenceDirectoryApplicationService {
  constructor(
    private readonly characters: CharacterService,
    private readonly links: CharacterReferenceLinkService,
  ) {}

  async list(input: PageInput & { search?: string; registration?: string }) {
    const registration = input.registration || "all";
    if (!["all", "registered", "missing"].includes(registration)) {
      throw new BadRequestException("등록 상태가 올바르지 않습니다.");
    }
    let afterId = decodeCursor(input.cursor);
    if (afterId && !isUUID(afterId)) {
      throw new BadRequestException("Invalid cursor");
    }

    const items: DirectoryItem[] = [];
    // Each domain reads its own table in bounded batches. Filtering precedes
    // pagination, so a match beyond the first candidate batch remains reachable.
    while (items.length <= input.limit) {
      const candidates = await this.characters.referenceDirectoryCandidates({
        search: input.search,
        afterId,
        take: 50,
      });
      if (!candidates.length) break;
      const references = await this.links.listForCharacters(
        candidates.map((c) => c.id),
      );
      const byCharacter = new Map<string, ReferenceLink[]>();
      for (const link of references) {
        const group = byCharacter.get(link.characterId) ?? [];
        group.push(link);
        byCharacter.set(link.characterId, group);
      }
      for (const character of candidates) {
        const referenceLinks = byCharacter.get(character.id) ?? [];
        if (registration === "registered" && !referenceLinks.length) continue;
        if (registration === "missing" && referenceLinks.length) continue;
        items.push({ ...character, referenceLinks });
        if (items.length > input.limit) break;
      }
      if (candidates.length < 50) break;
      afterId = candidates[candidates.length - 1].id;
    }
    return pageFromRows(items, input.limit);
  }
}
