import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  decodeCursor,
  Page,
  PageInput,
  pageFromRows,
} from "../domain/database/page";
import { PrismaService } from "../domain/database/prisma.service";

type CharacterStatus = "active" | "inactive";

type AdminCharacter = {
  id: string;
  publicId: string;
  displayName: string;
  bio: string;
  interests: string[];
};

type AdminCharacterListItem = AdminCharacter & {
  status: CharacterStatus;
  createdAt: string;
};

type AdminCharacterDetail = AdminCharacterListItem & {
  personas: CharacterPersona[];
  memories: CharacterMemory[];
};

type PrismaCharacterListItem = Omit<AdminCharacterListItem, "createdAt"> & {
  createdAt: Date;
};

type CharacterStatusReceipt = {
  id: string;
  status: CharacterStatus;
  updatedAt: string;
};

type PrismaCharacterStatusReceipt = Omit<
  CharacterStatusReceipt,
  "updatedAt"
> & {
  updatedAt: Date;
};

type CharacterMemory = {
  id: string;
  characterId: string;
  content: string;
  reason: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

type PrismaCharacterMemory = Omit<
  CharacterMemory,
  "createdAt" | "updatedAt" | "deletedAt"
> & {
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type CharacterPersona = {
  id: string;
  characterId: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

type PrismaCharacterPersona = Omit<
  CharacterPersona,
  "createdAt" | "updatedAt" | "deletedAt"
> & {
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type SoftDeleteReceipt = {
  id: string;
  deletedAt: string;
};

type CharactersPrismaClient = {
  character: {
    create(input: {
      data: {
        publicId: string;
        displayName: string;
        bio: string;
        interests: string[];
      };
      select: typeof characterFields;
    }): Promise<AdminCharacter>;
    findUnique(input: {
      where: { id: string };
      select: typeof characterListFields;
    }): Promise<PrismaCharacterListItem | null>;
    findUnique(input: {
      where: { id: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    findFirst(input: {
      where: { id: string; status?: CharacterStatus };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    findMany(input: {
      where: { status?: CharacterStatus };
      orderBy: [{ createdAt: "desc" }, { id: "desc" }];
      take: number;
      cursor?: { id: string };
      skip?: number;
      select: typeof characterListFields;
    }): Promise<PrismaCharacterListItem[]>;
    update(input: {
      where: { id: string };
      data: {
        displayName?: string;
        bio?: string;
        interests?: string[];
      };
      select: typeof characterFields;
    }): Promise<AdminCharacter>;
    update(input: {
      where: { id: string };
      data: { status: CharacterStatus };
      select: typeof characterStatusFields;
    }): Promise<PrismaCharacterStatusReceipt>;
  };
  characterActionLog: {
    create(input: {
      data: {
        characterId: string;
        actionType: string;
        targetTable: string;
        targetId: string;
        reason: string;
      };
    }): Promise<unknown>;
  };
  characterMemory: {
    create(input: {
      data: {
        characterId: string;
        content: string;
        reason: string;
      };
      select: typeof characterMemoryFields;
    }): Promise<PrismaCharacterMemory>;
    findFirst(input: {
      where: { id: string; characterId: string; deletedAt: null };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    findMany(input: {
      where: { characterId: string; deletedAt: null };
      orderBy: [{ createdAt: "desc" }, { id: "desc" }];
      select: typeof characterMemoryFields;
    }): Promise<PrismaCharacterMemory[]>;
    update(input: {
      where: { id: string };
      data: {
        content?: string;
        reason?: string;
        deletedAt?: Date;
      };
      select: typeof characterMemoryFields;
    }): Promise<PrismaCharacterMemory>;
  };
  characterPersona: {
    create(input: {
      data: {
        characterId: string;
        title: string;
        content: string;
      };
      select: typeof characterPersonaFields;
    }): Promise<PrismaCharacterPersona>;
    findFirst(input: {
      where: { id: string; characterId: string; deletedAt: null };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    findMany(input: {
      where: { characterId: string; deletedAt: null };
      orderBy: [{ createdAt: "desc" }, { id: "desc" }];
      select: typeof characterPersonaFields;
    }): Promise<PrismaCharacterPersona[]>;
    update(input: {
      where: { id: string };
      data: {
        title?: string;
        content?: string;
        deletedAt?: Date;
      };
      select: typeof characterPersonaFields;
    }): Promise<PrismaCharacterPersona>;
  };
};

const characterFields = {
  id: true,
  publicId: true,
  displayName: true,
  bio: true,
  interests: true,
} as const;

const characterListFields = {
  ...characterFields,
  status: true,
  createdAt: true,
} as const;

const characterStatusFields = {
  id: true,
  status: true,
  updatedAt: true,
} as const;

const characterPersonaFields = {
  id: true,
  characterId: true,
  title: true,
  content: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const;

const characterMemoryFields = {
  id: true,
  characterId: true,
  content: true,
  reason: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const;

@Injectable()
export class CharactersService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: CharactersPrismaClient,
  ) {}

  async createCharacter(input: {
    publicId: string;
    displayName: string;
    bio: string;
    interests?: string[];
  }) {
    const character = await this.prisma.character.create({
      data: {
        publicId: input.publicId,
        displayName: input.displayName,
        bio: input.bio,
        interests: input.interests ?? [],
      },
      select: characterFields,
    });
    await this.recordCharacterActionLog({
      characterId: character.id,
      actionType: "CHARACTER_CREATED",
      targetTable: "characters",
      targetId: character.id,
      reason: "character created",
    });
    return character;
  }

  async updateCharacter(input: {
    id: string;
    displayName?: string;
    bio?: string;
    interests?: string[];
  }): Promise<AdminCharacter> {
    const data: {
      displayName?: string;
      bio?: string;
      interests?: string[];
    } = {};
    if (input.displayName !== undefined) {
      const displayName = input.displayName.trim();
      if (!displayName) {
        throw new BadRequestException("character display name is required");
      }
      data.displayName = displayName;
    }
    if (input.bio !== undefined) {
      const bio = input.bio.trim();
      if (!bio) {
        throw new BadRequestException("character bio is required");
      }
      data.bio = bio;
    }
    if (input.interests !== undefined) {
      data.interests = input.interests;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException("character update is empty");
    }
    if (!(await this.hasCharacter(input.id))) {
      throw new BadRequestException("Character not found");
    }

    return this.prisma.character.update({
      where: { id: input.id },
      data,
      select: characterFields,
    });
  }

  async updateCharacterStatus(input: {
    id: string;
    status: string;
    reason: string;
  }): Promise<CharacterStatusReceipt> {
    const status = this.parseCharacterStatus(input.status);
    if (!status) {
      throw new BadRequestException("character status is required");
    }
    const reason = input.reason?.trim();
    if (!reason) {
      throw new BadRequestException("character status reason is required");
    }
    if (!(await this.hasCharacter(input.id))) {
      throw new BadRequestException("Character not found");
    }

    const character = await this.prisma.character.update({
      where: { id: input.id },
      data: { status },
      select: characterStatusFields,
    });
    await this.recordCharacterActionLog({
      characterId: character.id,
      actionType:
        character.status === "inactive"
          ? "CHARACTER_DELETED"
          : "CHARACTER_RESTORED",
      targetTable: "characters",
      targetId: character.id,
      reason,
    });
    return {
      id: character.id,
      status: character.status,
      updatedAt: character.updatedAt.toISOString(),
    };
  }

  deleteCharacter(input: { id: string; reason: string }) {
    return this.updateCharacterStatus({
      id: input.id,
      status: "inactive",
      reason: input.reason,
    });
  }

  async getCharacter(characterId: string): Promise<AdminCharacterDetail> {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: characterListFields,
    });
    if (!character) {
      throw new BadRequestException("Character not found");
    }
    const [personas, memories] = await Promise.all([
      this.prisma.characterPersona.findMany({
        where: { characterId, deletedAt: null },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: characterPersonaFields,
      }),
      this.prisma.characterMemory.findMany({
        where: { characterId, deletedAt: null },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: characterMemoryFields,
      }),
    ]);
    return {
      ...this.toCharacterListItem(character),
      personas: personas.map((persona) => this.toCharacterPersona(persona)),
      memories: memories.map((memory) => this.toCharacterMemory(memory)),
    };
  }

  async listCharacters(
    input: { status?: string } & PageInput,
  ): Promise<Page<AdminCharacterListItem>> {
    const status = this.parseCharacterStatus(input.status);
    const where = status === undefined ? {} : { status };
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.prisma.character.findFirst({
        where: { id: cursorId, ...where },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const characters = await this.prisma.character.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      select: characterListFields,
    });
    return pageFromRows(
      characters.map((character) => this.toCharacterListItem(character)),
      input.limit,
    );
  }

  async listCharacterMemory(
    characterId: string,
  ): Promise<{ items: CharacterMemory[] }> {
    if (!(await this.hasCharacter(characterId))) {
      throw new BadRequestException("Character not found");
    }
    const memories = await this.prisma.characterMemory.findMany({
      where: { characterId, deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: characterMemoryFields,
    });
    return { items: memories.map((memory) => this.toCharacterMemory(memory)) };
  }

  async createCharacterMemory(input: {
    characterId: string;
    content: string;
    reason: string;
  }): Promise<CharacterMemory> {
    if (!(await this.hasCharacter(input.characterId))) {
      throw new BadRequestException("Character not found");
    }
    const content = input.content?.trim();
    const reason = input.reason?.trim();
    if (!content) {
      throw new BadRequestException("Character memory content is required");
    }
    if (!reason) {
      throw new BadRequestException("Character memory reason is required");
    }

    const memory = await this.prisma.characterMemory.create({
      data: {
        characterId: input.characterId,
        content,
        reason,
      },
      select: characterMemoryFields,
    });
    return this.toCharacterMemory(memory);
  }

  async updateCharacterMemory(input: {
    characterId: string;
    memoryId: string;
    content?: string;
    reason?: string;
  }): Promise<CharacterMemory> {
    await this.assertCharacterMemory(input.characterId, input.memoryId);
    const data: { content?: string; reason?: string } = {};
    if (input.content !== undefined) {
      const content = input.content.trim();
      if (!content) {
        throw new BadRequestException("Character memory content is required");
      }
      data.content = content;
    }
    if (input.reason !== undefined) {
      const reason = input.reason.trim();
      if (!reason) {
        throw new BadRequestException("Character memory reason is required");
      }
      data.reason = reason;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException("Character memory update is empty");
    }
    const memory = await this.prisma.characterMemory.update({
      where: { id: input.memoryId },
      data,
      select: characterMemoryFields,
    });
    return this.toCharacterMemory(memory);
  }

  async deleteCharacterMemory(input: {
    characterId: string;
    memoryId: string;
  }): Promise<SoftDeleteReceipt> {
    await this.assertCharacterMemory(input.characterId, input.memoryId);
    const memory = await this.prisma.characterMemory.update({
      where: { id: input.memoryId },
      data: { deletedAt: new Date() },
      select: characterMemoryFields,
    });
    return {
      id: memory.id,
      deletedAt: (memory.deletedAt ?? new Date()).toISOString(),
    };
  }

  async listCharacterPersonas(
    characterId: string,
  ): Promise<{ items: CharacterPersona[] }> {
    if (!(await this.hasCharacter(characterId))) {
      throw new BadRequestException("Character not found");
    }
    const personas = await this.prisma.characterPersona.findMany({
      where: { characterId, deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: characterPersonaFields,
    });
    return {
      items: personas.map((persona) => this.toCharacterPersona(persona)),
    };
  }

  async createCharacterPersona(input: {
    characterId: string;
    title: string;
    content: string;
  }): Promise<CharacterPersona> {
    if (!(await this.hasCharacter(input.characterId))) {
      throw new BadRequestException("Character not found");
    }
    const title = input.title?.trim();
    const content = input.content?.trim();
    if (!title) {
      throw new BadRequestException("Character persona title is required");
    }
    if (!content) {
      throw new BadRequestException("Character persona content is required");
    }
    const persona = await this.prisma.characterPersona.create({
      data: {
        characterId: input.characterId,
        title,
        content,
      },
      select: characterPersonaFields,
    });
    return this.toCharacterPersona(persona);
  }

  async updateCharacterPersona(input: {
    characterId: string;
    personaId: string;
    title?: string;
    content?: string;
  }): Promise<CharacterPersona> {
    await this.assertCharacterPersona(input.characterId, input.personaId);
    const data: { title?: string; content?: string } = {};
    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) {
        throw new BadRequestException("Character persona title is required");
      }
      data.title = title;
    }
    if (input.content !== undefined) {
      const content = input.content.trim();
      if (!content) {
        throw new BadRequestException("Character persona content is required");
      }
      data.content = content;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException("Character persona update is empty");
    }
    const persona = await this.prisma.characterPersona.update({
      where: { id: input.personaId },
      data,
      select: characterPersonaFields,
    });
    return this.toCharacterPersona(persona);
  }

  async deleteCharacterPersona(input: {
    characterId: string;
    personaId: string;
  }): Promise<SoftDeleteReceipt> {
    await this.assertCharacterPersona(input.characterId, input.personaId);
    const persona = await this.prisma.characterPersona.update({
      where: { id: input.personaId },
      data: { deletedAt: new Date() },
      select: characterPersonaFields,
    });
    return {
      id: persona.id,
      deletedAt: (persona.deletedAt ?? new Date()).toISOString(),
    };
  }

  private async recordCharacterActionLog(input: {
    characterId: string;
    actionType: string;
    targetTable: string;
    targetId: string;
    reason: string;
  }) {
    await this.prisma.characterActionLog.create({ data: input });
  }

  private async hasCharacter(characterId: string): Promise<boolean> {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { id: true },
    });
    return character !== null;
  }

  private async assertCharacterMemory(characterId: string, memoryId: string) {
    const memory = await this.prisma.characterMemory.findFirst({
      where: { id: memoryId, characterId, deletedAt: null },
      select: { id: true },
    });
    if (!memory) {
      throw new BadRequestException("Character memory not found");
    }
  }

  private async assertCharacterPersona(characterId: string, personaId: string) {
    const persona = await this.prisma.characterPersona.findFirst({
      where: { id: personaId, characterId, deletedAt: null },
      select: { id: true },
    });
    if (!persona) {
      throw new BadRequestException("Character persona not found");
    }
  }

  private toCharacterListItem(
    character: PrismaCharacterListItem,
  ): AdminCharacterListItem {
    return {
      id: character.id,
      publicId: character.publicId,
      displayName: character.displayName,
      bio: character.bio,
      interests: character.interests,
      status: character.status,
      createdAt: character.createdAt.toISOString(),
    };
  }

  private toCharacterMemory(memory: PrismaCharacterMemory): CharacterMemory {
    return {
      id: memory.id,
      characterId: memory.characterId,
      content: memory.content,
      reason: memory.reason,
      createdAt: memory.createdAt.toISOString(),
      updatedAt: memory.updatedAt.toISOString(),
      ...(memory.deletedAt
        ? { deletedAt: memory.deletedAt.toISOString() }
        : {}),
    };
  }

  private toCharacterPersona(persona: PrismaCharacterPersona): CharacterPersona {
    return {
      id: persona.id,
      characterId: persona.characterId,
      title: persona.title,
      content: persona.content,
      createdAt: persona.createdAt.toISOString(),
      updatedAt: persona.updatedAt.toISOString(),
      ...(persona.deletedAt
        ? { deletedAt: persona.deletedAt.toISOString() }
        : {}),
    };
  }

  private parseCharacterStatus(status?: string): CharacterStatus | undefined {
    if (status === undefined || status === "") {
      return undefined;
    }
    if (status === "active" || status === "inactive") {
      return status;
    }
    throw new BadRequestException("Invalid character status");
  }
}
