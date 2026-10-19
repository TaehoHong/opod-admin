import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { parseBigintId } from "../shared/utils/bigint-id";
import { CharacterService } from "./character.service";
import {
  CharacterReferenceLinkRepository,
  CharacterReferenceLinkRow,
} from "./character-reference-link.repository";

@Injectable()
export class CharacterReferenceLinkService {
  constructor(
    private readonly links: CharacterReferenceLinkRepository,
    private readonly characters: CharacterService,
  ) {}

  async list(characterId: string) {
    await this.characters.requireActivityCharacter(characterId);
    return (await this.links.list(characterId)).map(toLink);
  }

  async create(characterId: string, url: string) {
    await this.characters.requireActivityCharacter(characterId);
    return this.handleDuplicate(async () =>
      toLink(await this.links.create(characterId, this.normalizeUrl(url))),
    );
  }

  async update(characterId: string, linkId: string, url: string) {
    const id = parseBigintId(linkId, "참조 링크 ID가 올바르지 않습니다.");
    await this.characters.requireActivityCharacter(characterId);
    return this.handleDuplicate(async () => {
      const row = await this.links.update(
        characterId,
        id,
        this.normalizeUrl(url),
      );
      if (!row) throw new NotFoundException("참조 링크를 찾을 수 없습니다.");
      return toLink(row);
    });
  }

  async delete(characterId: string, linkId: string) {
    const id = parseBigintId(linkId, "참조 링크 ID가 올바르지 않습니다.");
    await this.characters.requireActivityCharacter(characterId);
    const row = await this.links.delete(characterId, id);
    if (!row) throw new NotFoundException("참조 링크를 찾을 수 없습니다.");
    return { id: String(row.id) };
  }

  private normalizeUrl(value: string) {
    try {
      const url = new URL(value.trim());
      if (
        (url.protocol === "https:" || url.protocol === "http:") &&
        !url.username &&
        !url.password &&
        url.href.length <= 2048
      )
        return url.href;
    } catch {
      // Report the same input error for malformed and unsupported URLs.
    }
    throw new BadRequestException(
      "2048자 이내의 HTTP 또는 HTTPS 주소를 입력해 주세요.",
    );
  }

  private async handleDuplicate<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      let cause: unknown = error;
      while (cause && typeof cause === "object") {
        if ("code" in cause && cause.code === "23505")
          throw new ConflictException("이미 등록된 참조 링크입니다.");
        cause = "cause" in cause ? cause.cause : undefined;
      }
      throw error;
    }
  }
}

function toLink(row: CharacterReferenceLinkRow) {
  return {
    ...row,
    id: String(row.id),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
