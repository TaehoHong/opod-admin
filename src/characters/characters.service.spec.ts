import { CharactersService } from "./characters.service";

describe("CharactersService", () => {
  it("creates character memory without a scope", async () => {
    const createdAt = new Date("2026-07-02T00:00:00.000Z");
    const create = jest.fn().mockResolvedValue({
      id: "memory-1",
      characterId: "character-1",
      content: "likes concise status reports",
      reason: "operator note",
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    });
    const service = new (
      CharactersService as new (...args: unknown[]) => CharactersService
    )({
      character: {
        findUnique: jest.fn().mockResolvedValue({ id: "character-1" }),
      },
      characterMemory: { create },
    });

    await expect(
      service.createCharacterMemory({
        characterId: "character-1",
        content: " likes concise status reports ",
        reason: " operator note ",
      }),
    ).resolves.toEqual({
      id: "memory-1",
      characterId: "character-1",
      content: "likes concise status reports",
      reason: "operator note",
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        characterId: "character-1",
        content: "likes concise status reports",
        reason: "operator note",
      },
      select: expect.any(Object),
    });
  });

  it("returns character detail with active personas and memory", async () => {
    const createdAt = new Date("2026-07-02T00:00:00.000Z");
    const service = new (
      CharactersService as new (...args: unknown[]) => CharactersService
    )({
      character: {
        findUnique: jest.fn().mockResolvedValue({
          id: "character-1",
          publicId: "mina_ai",
          displayName: "Mina",
          bio: "City walks",
          interests: ["art"],
          status: "active",
          createdAt,
        }),
      },
      characterPersona: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "persona-1",
            characterId: "character-1",
            title: "Core",
            content: "Warm and concise",
            createdAt,
            updatedAt: createdAt,
            deletedAt: null,
          },
        ]),
      },
      characterMemory: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "memory-1",
            characterId: "character-1",
            content: "likes night walks",
            reason: "operator",
            createdAt,
            updatedAt: createdAt,
            deletedAt: null,
          },
        ]),
      },
    });

    await expect(service.getCharacter("character-1")).resolves.toEqual({
      id: "character-1",
      publicId: "mina_ai",
      displayName: "Mina",
      bio: "City walks",
      interests: ["art"],
      status: "active",
      createdAt: createdAt.toISOString(),
      personas: [
        {
          id: "persona-1",
          characterId: "character-1",
          title: "Core",
          content: "Warm and concise",
          createdAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString(),
        },
      ],
      memories: [
        {
          id: "memory-1",
          characterId: "character-1",
          content: "likes night walks",
          reason: "operator",
          createdAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString(),
        },
      ],
    });
  });

  it("creates, updates, and soft-deletes character personas", async () => {
    const createdAt = new Date("2026-07-02T00:00:00.000Z");
    const deletedAt = new Date("2026-07-02T00:10:00.000Z");
    const create = jest.fn().mockResolvedValue({
      id: "persona-1",
      characterId: "character-1",
      title: "Core",
      content: "Warm",
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    });
    const update = jest
      .fn()
      .mockResolvedValueOnce({
        id: "persona-1",
        characterId: "character-1",
        title: "Core",
        content: "Warmer",
        createdAt,
        updatedAt: deletedAt,
        deletedAt: null,
      })
      .mockResolvedValueOnce({
        id: "persona-1",
        characterId: "character-1",
        title: "Core",
        content: "Warmer",
        createdAt,
        updatedAt: deletedAt,
        deletedAt,
      });
    const service = new (
      CharactersService as new (...args: unknown[]) => CharactersService
    )({
      character: {
        findUnique: jest.fn().mockResolvedValue({ id: "character-1" }),
      },
      characterPersona: {
        create,
        update,
        findFirst: jest.fn().mockResolvedValue({ id: "persona-1" }),
      },
    });

    await expect(
      service.createCharacterPersona({
        characterId: "character-1",
        title: " Core ",
        content: " Warm ",
      }),
    ).resolves.toMatchObject({ title: "Core", content: "Warm" });
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

    expect(create).toHaveBeenCalledWith({
      data: {
        characterId: "character-1",
        title: "Core",
        content: "Warm",
      },
      select: expect.any(Object),
    });
    expect(update).toHaveBeenLastCalledWith({
      where: { id: "persona-1" },
      data: { deletedAt: expect.any(Date) },
      select: expect.any(Object),
    });
  });

  it("updates and soft-deletes character memory", async () => {
    const createdAt = new Date("2026-07-02T00:00:00.000Z");
    const deletedAt = new Date("2026-07-02T00:10:00.000Z");
    const update = jest
      .fn()
      .mockResolvedValueOnce({
        id: "memory-1",
        characterId: "character-1",
        content: "likes sunrise",
        reason: "operator",
        createdAt,
        updatedAt: deletedAt,
        deletedAt: null,
      })
      .mockResolvedValueOnce({
        id: "memory-1",
        characterId: "character-1",
        content: "likes sunrise",
        reason: "operator",
        createdAt,
        updatedAt: deletedAt,
        deletedAt,
      });
    const service = new (
      CharactersService as new (...args: unknown[]) => CharactersService
    )({
      characterMemory: {
        update,
        findFirst: jest.fn().mockResolvedValue({ id: "memory-1" }),
      },
    });

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
    expect(update).toHaveBeenLastCalledWith({
      where: { id: "memory-1" },
      data: { deletedAt: expect.any(Date) },
      select: expect.any(Object),
    });
  });
});
