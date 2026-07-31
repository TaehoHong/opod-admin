import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../domain/database/prisma.service";

// entity repository — PrismaService는 이 계층에서만 쓴다
// (docs/02-development-rules.md "Module and Repository Rules").
//
// 캐릭터와 그에 딸린 페르소나·메모리는 한 애그리게이트로 다룬다. 어느 것도
// 캐릭터 없이 존재하지 않고 항상 같이 조회된다.

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
  _count: { select: { posts: true, userFollowers: true } },
} as const;

const characterStatusFields = {
  id: true,
  status: true,
  updatedAt: true,
} as const;

const personaFields = {
  id: true,
  characterId: true,
  title: true,
  content: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const;

const memoryFields = {
  id: true,
  characterId: true,
  content: true,
  type: true,
  reason: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const;

export type CharacterRow = Prisma.CharacterGetPayload<{
  select: typeof characterFields;
}>;
export type CharacterListRow = Prisma.CharacterGetPayload<{
  select: typeof characterListFields;
}>;
export type CharacterStatusRow = Prisma.CharacterGetPayload<{
  select: typeof characterStatusFields;
}>;
export type PersonaRow = Prisma.CharacterPersonaGetPayload<{
  select: typeof personaFields;
}>;
export type MemoryRow = Prisma.CharacterMemoryGetPayload<{
  select: typeof memoryFields;
}>;

// schema의 character_status enum과 같은 두 값만 존재한다.
export type CharacterStatus = "active" | "inactive";

@Injectable()
export class CharacterRepository {
  constructor(private readonly prisma: PrismaService) {}

  // — 캐릭터 —

  async exists(characterId: string): Promise<boolean> {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { id: true },
    });
    return character !== null;
  }

  create(data: {
    publicId: string;
    displayName: string;
    bio: string;
    interests: string[];
  }): Promise<CharacterRow> {
    return this.prisma.character.create({ data, select: characterFields });
  }

  update(
    characterId: string,
    data: { displayName?: string; bio?: string; interests?: string[] },
  ): Promise<CharacterRow> {
    return this.prisma.character.update({
      where: { id: characterId },
      data,
      select: characterFields,
    });
  }

  updateStatus(
    characterId: string,
    status: CharacterStatus,
  ): Promise<CharacterStatusRow> {
    return this.prisma.character.update({
      where: { id: characterId },
      data: { status },
      select: characterStatusFields,
    });
  }

  findDetail(characterId: string): Promise<CharacterListRow | null> {
    return this.prisma.character.findUnique({
      where: { id: characterId },
      select: characterListFields,
    });
  }

  // cursor가 현재 필터에 실제로 속하는지 확인한다 — 다른 필터의 cursor를
  // 그대로 넘기면 조용히 엉뚱한 페이지가 나온다.
  async cursorMatchesFilter(
    cursorId: string,
    status?: CharacterStatus,
  ): Promise<boolean> {
    const row = await this.prisma.character.findFirst({
      where: { id: cursorId, ...(status === undefined ? {} : { status }) },
      select: { id: true },
    });
    return row !== null;
  }

  findManyForList(input: {
    status?: CharacterStatus;
    take: number;
    cursor?: string;
  }): Promise<CharacterListRow[]> {
    return this.prisma.character.findMany({
      where: input.status === undefined ? {} : { status: input.status },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.take,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      select: characterListFields,
    });
  }

  // — 페르소나 —

  findPersonas(characterId: string): Promise<PersonaRow[]> {
    return this.prisma.characterPersona.findMany({
      where: { characterId, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: personaFields,
    });
  }

  async findPersona(
    characterId: string,
    personaId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.characterPersona.findFirst({
      where: { id: personaId, characterId, deletedAt: null },
      select: { id: true },
    });
  }

  async highestPersonaSortOrder(characterId: string): Promise<number> {
    const top = await this.prisma.characterPersona.findFirst({
      where: { characterId, deletedAt: null },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    return top?.sortOrder ?? 0;
  }

  createPersona(data: {
    characterId: string;
    title: string;
    content: string;
    sortOrder: number;
  }): Promise<PersonaRow> {
    return this.prisma.characterPersona.create({
      data,
      select: personaFields,
    });
  }

  updatePersona(
    personaId: string,
    data: { title?: string; content?: string; sortOrder?: number },
  ): Promise<PersonaRow> {
    return this.prisma.characterPersona.update({
      where: { id: personaId },
      data,
      select: personaFields,
    });
  }

  softDeletePersona(personaId: string, deletedAt: Date): Promise<PersonaRow> {
    return this.prisma.characterPersona.update({
      where: { id: personaId },
      data: { deletedAt },
      select: personaFields,
    });
  }

  // — 메모리 —

  findMemories(characterId: string): Promise<MemoryRow[]> {
    return this.prisma.characterMemory.findMany({
      where: { characterId, deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: memoryFields,
    });
  }

  async findMemory(
    characterId: string,
    memoryId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.characterMemory.findFirst({
      where: { id: memoryId, characterId, deletedAt: null },
      select: { id: true },
    });
  }

  createMemory(data: {
    characterId: string;
    content: string;
    type: string;
    reason: string;
  }): Promise<MemoryRow> {
    return this.prisma.characterMemory.create({ data, select: memoryFields });
  }

  updateMemory(
    memoryId: string,
    data: { content?: string; type?: string; reason?: string },
  ): Promise<MemoryRow> {
    return this.prisma.characterMemory.update({
      where: { id: memoryId },
      data,
      select: memoryFields,
    });
  }

  softDeleteMemory(memoryId: string, deletedAt: Date): Promise<MemoryRow> {
    return this.prisma.characterMemory.update({
      where: { id: memoryId },
      data: { deletedAt },
      select: memoryFields,
    });
  }

  // — 감사 로그 —

  async recordActionLog(input: {
    characterId: string;
    actionType: string;
    targetTable: string;
    targetId: string;
    reason: string;
  }): Promise<void> {
    await this.prisma.characterActionLog.create({ data: input });
  }
}
