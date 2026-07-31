import { CharacterRepository } from "./character.repository";
import { CharactersService } from "./characters.service";

// Prisma를 흉내내지 않고 repository를 대신 세운다
// (docs/02-development-rules.md "Module and Repository Rules").
type RepositoryFake = jest.Mocked<CharacterRepository>;

function repositoryFake(overrides: Partial<CharacterRepository> = {}) {
  return {
    exists: jest.fn().mockResolvedValue(true),
    create: jest.fn(),
    update: jest.fn(),
    updateStatus: jest.fn(),
    findDetail: jest.fn(),
    cursorMatchesFilter: jest.fn().mockResolvedValue(true),
    findManyForList: jest.fn().mockResolvedValue([]),
    findPersonas: jest.fn().mockResolvedValue([]),
    findPersona: jest.fn().mockResolvedValue({ id: "persona-1" }),
    highestPersonaSortOrder: jest.fn().mockResolvedValue(0),
    createPersona: jest.fn(),
    updatePersona: jest.fn(),
    softDeletePersona: jest.fn(),
    findMemories: jest.fn().mockResolvedValue([]),
    findMemory: jest.fn().mockResolvedValue({ id: "memory-1" }),
    createMemory: jest.fn(),
    updateMemory: jest.fn(),
    softDeleteMemory: jest.fn(),
    recordActionLog: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as RepositoryFake;
}

function makeService(repository: RepositoryFake) {
  return new CharactersService(repository);
}

const createdAt = new Date("2026-07-02T00:00:00.000Z");
const deletedAt = new Date("2026-07-02T00:10:00.000Z");

function personaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "persona-1",
    characterId: "character-1",
    title: "Core",
    content: "Warm",
    sortOrder: 30,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
    ...overrides,
  };
}

function memoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "memory-1",
    characterId: "character-1",
    content: "likes concise status reports",
    type: "preference",
    reason: "operator note",
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
    ...overrides,
  };
}

describe("CharactersService", () => {
  it("creates character memory without a scope", async () => {
    const repository = repositoryFake({
      createMemory: jest.fn().mockResolvedValue(memoryRow()),
    });
    const service = makeService(repository);

    await expect(
      service.createCharacterMemory({
        characterId: "character-1",
        content: " likes concise status reports ",
        type: "preference",
        reason: " operator note ",
      }),
    ).resolves.toEqual({
      id: "memory-1",
      characterId: "character-1",
      content: "likes concise status reports",
      type: "preference",
      reason: "operator note",
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    });
    // 저장 전에 공백을 다듬는다.
    expect(repository.createMemory).toHaveBeenCalledWith({
      characterId: "character-1",
      content: "likes concise status reports",
      type: "preference",
      reason: "operator note",
    });
    expect(repository.recordActionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: "character-1",
        actionType: "MEMORY_CREATED",
        targetTable: "character_memories",
        targetId: "memory-1",
      }),
    );
  });

  it("rejects unknown character memory types", async () => {
    const repository = repositoryFake();
    const service = makeService(repository);

    await expect(
      service.createCharacterMemory({
        characterId: "character-1",
        content: "likes concise status reports",
        type: "note",
        reason: "operator note",
      }),
    ).rejects.toThrow("Invalid character memory type");
    expect(repository.createMemory).not.toHaveBeenCalled();
  });

  it("returns character detail with active personas and memory", async () => {
    const service = makeService(
      repositoryFake({
        findDetail: jest.fn().mockResolvedValue({
          id: "character-1",
          publicId: "mina_ai",
          displayName: "Mina",
          bio: "City walks",
          interests: ["art"],
          status: "active",
          createdAt,
          _count: { posts: 12, userFollowers: 340 },
        }),
        findPersonas: jest.fn().mockResolvedValue([
          personaRow({
            title: "Core",
            content: "Warm and concise",
            sortOrder: 10,
          }),
        ]),
        findMemories: jest.fn().mockResolvedValue([
          memoryRow({
            content: "likes night walks",
            type: "routine",
            reason: "operator",
          }),
        ]),
      }),
    );

    await expect(service.getCharacter("character-1")).resolves.toEqual({
      id: "character-1",
      publicId: "mina_ai",
      displayName: "Mina",
      bio: "City walks",
      interests: ["art"],
      status: "active",
      postCount: 12,
      followerCount: 340,
      createdAt: createdAt.toISOString(),
      personas: [
        {
          id: "persona-1",
          characterId: "character-1",
          title: "Core",
          content: "Warm and concise",
          sortOrder: 10,
          createdAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString(),
        },
      ],
      memories: [
        {
          id: "memory-1",
          characterId: "character-1",
          content: "likes night walks",
          type: "routine",
          reason: "operator",
          createdAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString(),
        },
      ],
    });
  });

  it("lists character post and follower counts", async () => {
    const listedAt = new Date("2026-07-12T00:00:00.000Z");
    const repository = repositoryFake({
      findManyForList: jest.fn().mockResolvedValue([
        {
          id: "character-1",
          publicId: "mina_ai",
          displayName: "Mina",
          bio: "City walks",
          interests: ["art"],
          status: "active",
          createdAt: listedAt,
          _count: { posts: 12, userFollowers: 340 },
        },
      ]),
    });
    const service = makeService(repository);

    await expect(
      service.listCharacters({ status: "active", limit: 20 }),
    ).resolves.toEqual({
      items: [
        {
          id: "character-1",
          publicId: "mina_ai",
          displayName: "Mina",
          bio: "City walks",
          interests: ["art"],
          status: "active",
          postCount: 12,
          followerCount: 340,
          createdAt: listedAt.toISOString(),
        },
      ],
    });
    // limit + 1을 요청해야 다음 페이지 유무를 판정할 수 있다.
    expect(repository.findManyForList).toHaveBeenCalledWith({
      status: "active",
      take: 21,
    });
  });

  it("creates, updates, and soft-deletes character personas", async () => {
    const repository = repositoryFake({
      highestPersonaSortOrder: jest.fn().mockResolvedValue(20),
      createPersona: jest.fn().mockResolvedValue(personaRow()),
      updatePersona: jest
        .fn()
        .mockResolvedValue(
          personaRow({ content: "Warmer", updatedAt: deletedAt }),
        ),
      softDeletePersona: jest
        .fn()
        .mockResolvedValue(personaRow({ content: "Warmer", deletedAt })),
    });
    const service = makeService(repository);

    await expect(
      service.createCharacterPersona({
        characterId: "character-1",
        title: " Core ",
        content: " Warm ",
      }),
    ).resolves.toMatchObject({ title: "Core", content: "Warm", sortOrder: 30 });
    await expect(
      service.updateCharacterPersona({
        characterId: "character-1",
        personaId: "persona-1",
        content: " Warmer ",
      }),
    ).resolves.toMatchObject({ content: "Warmer" });
    await expect(
      service.deleteCharacterPersona({
        characterId: "character-1",
        personaId: "persona-1",
      }),
    ).resolves.toEqual({
      id: "persona-1",
      deletedAt: deletedAt.toISOString(),
    });

    // 새 페르소나는 기존 최댓값 다음 칸에 놓인다.
    expect(repository.createPersona).toHaveBeenCalledWith({
      characterId: "character-1",
      title: "Core",
      content: "Warm",
      sortOrder: 30,
    });
    expect(repository.softDeletePersona).toHaveBeenCalledWith(
      "persona-1",
      expect.any(Date),
    );
    expect(
      repository.recordActionLog.mock.calls.map(([input]) => input.actionType),
    ).toEqual(["PERSONA_CREATED", "PERSONA_UPDATED", "PERSONA_DELETED"]);
  });

  it("updates and soft-deletes character memory", async () => {
    const repository = repositoryFake({
      updateMemory: jest
        .fn()
        .mockResolvedValue(
          memoryRow({ content: "likes sunrise", updatedAt: deletedAt }),
        ),
      softDeleteMemory: jest
        .fn()
        .mockResolvedValue(memoryRow({ content: "likes sunrise", deletedAt })),
    });
    const service = makeService(repository);

    await expect(
      service.updateCharacterMemory({
        characterId: "character-1",
        memoryId: "memory-1",
        content: " likes sunrise ",
      }),
    ).resolves.toMatchObject({ content: "likes sunrise" });
    await expect(
      service.deleteCharacterMemory({
        characterId: "character-1",
        memoryId: "memory-1",
      }),
    ).resolves.toEqual({
      id: "memory-1",
      deletedAt: deletedAt.toISOString(),
    });
    // 삭제는 행을 지우지 않고 deletedAt만 채운다.
    expect(repository.softDeleteMemory).toHaveBeenCalledWith(
      "memory-1",
      expect.any(Date),
    );
  });

  it("bulk-creates personas and numbers them in submitted order", async () => {
    let sequence = 0;
    const repository = repositoryFake({
      // 기존 최상단이 40이므로 배치는 50, 60으로 이어진다.
      highestPersonaSortOrder: jest.fn().mockResolvedValue(40),
      createPersona: jest.fn().mockImplementation((data) => {
        sequence += 1;
        return Promise.resolve(
          personaRow({ id: `persona-${sequence}`, ...data }),
        );
      }),
    });
    const service = makeService(repository);

    const result = await service.createCharacterPersonas({
      characterId: "character-1",
      items: [
        { title: " 01. Core ", content: " Warm " },
        { title: "02. Voice", content: "Short poetic captions" },
      ],
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ title: "01. Core", sortOrder: 50 });
    expect(result.items[1]).toMatchObject({
      title: "02. Voice",
      sortOrder: 60,
    });
    expect(repository.recordActionLog).toHaveBeenCalledTimes(2);
    expect(repository.recordActionLog).toHaveBeenLastCalledWith(
      expect.objectContaining({
        actionType: "PERSONA_CREATED",
        targetId: "persona-2",
      }),
    );
  });

  it("reorders personas and rejects a mismatched id set", async () => {
    const repository = repositoryFake({
      findPersonas: jest
        .fn()
        .mockResolvedValue([
          personaRow({ id: "a", title: "a", sortOrder: 10 }),
          personaRow({ id: "b", title: "b", sortOrder: 20 }),
        ]),
      updatePersona: jest
        .fn()
        .mockImplementation((personaId: string, data: { sortOrder: number }) =>
          Promise.resolve(
            personaRow({ id: personaId, title: personaId, ...data }),
          ),
        ),
    });
    const service = makeService(repository);

    const result = await service.reorderCharacterPersonas({
      characterId: "character-1",
      personaIds: ["b", "a"],
    });
    expect(result.items.map((p) => [p.id, p.sortOrder])).toEqual([
      ["b", 10],
      ["a", 20],
    ]);
    expect(repository.recordActionLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "PERSONA_REORDERED" }),
    );

    // 부분 재정렬과 중복은 순서를 망가뜨리므로 전체 집합을 요구한다.
    await expect(
      service.reorderCharacterPersonas({
        characterId: "character-1",
        personaIds: ["a"],
      }),
    ).rejects.toThrow("must match the active personas exactly");
    await expect(
      service.reorderCharacterPersonas({
        characterId: "character-1",
        personaIds: ["a", "a", "b"],
      }),
    ).rejects.toThrow("must not contain duplicates");
  });

  it("rejects an entire bulk batch when any item is invalid", async () => {
    const repository = repositoryFake();
    const service = makeService(repository);

    await expect(
      service.createCharacterMemories({
        characterId: "character-1",
        items: [
          { content: "valid", type: "fact", reason: "valid" },
          { content: "  ", type: "fact", reason: "valid" },
        ],
      }),
    ).rejects.toThrow("Character memory items[1] content is required");
    expect(repository.createMemory).not.toHaveBeenCalled();

    await expect(
      service.createCharacterMemories({
        characterId: "character-1",
        items: Array.from({ length: 51 }, () => ({
          content: "c",
          type: "fact",
          reason: "r",
        })),
      }),
    ).rejects.toThrow("Character memory items must be 50 or fewer");
    expect(repository.createMemory).not.toHaveBeenCalled();
  });

  it("rejects persona fields beyond the length limits", async () => {
    const repository = repositoryFake();
    const service = makeService(repository);

    await expect(
      service.createCharacterPersona({
        characterId: "character-1",
        title: "t".repeat(201),
        content: "fine",
      }),
    ).rejects.toThrow("Character persona title must be at most 200 characters");
    await expect(
      service.createCharacterPersona({
        characterId: "character-1",
        title: "fine",
        content: "c".repeat(8001),
      }),
    ).rejects.toThrow(
      "Character persona content must be at most 8000 characters",
    );
    expect(repository.createPersona).not.toHaveBeenCalled();
  });
});
