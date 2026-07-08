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
    const actionLogCreate = jest.fn().mockResolvedValue({});
    const service = new (
      CharactersService as new (...args: unknown[]) => CharactersService
    )({
      character: {
        findUnique: jest.fn().mockResolvedValue({ id: "character-1" }),
      },
      characterMemory: { create },
      characterActionLog: { create: actionLogCreate },
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
    expect(actionLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        characterId: "character-1",
        actionType: "MEMORY_CREATED",
        targetTable: "character_memories",
        targetId: "memory-1",
      }),
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
            sortOrder: 10,
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
      sortOrder: 30,
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
        sortOrder: 30,
        createdAt,
        updatedAt: deletedAt,
        deletedAt: null,
      })
      .mockResolvedValueOnce({
        id: "persona-1",
        characterId: "character-1",
        title: "Core",
        content: "Warmer",
        sortOrder: 30,
        createdAt,
        updatedAt: deletedAt,
        deletedAt,
      });
    const actionLogCreate = jest.fn().mockResolvedValue({});
    const service = new (
      CharactersService as new (...args: unknown[]) => CharactersService
    )({
      character: {
        findUnique: jest.fn().mockResolvedValue({ id: "character-1" }),
      },
      characterPersona: {
        create,
        update,
        // Returns the current max sortOrder for the create path, and a truthy
        // ownership row for the update/delete paths.
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: "persona-1", sortOrder: 20 }),
      },
      characterActionLog: { create: actionLogCreate },
    });

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

    expect(create).toHaveBeenCalledWith({
      data: {
        characterId: "character-1",
        title: "Core",
        content: "Warm",
        sortOrder: 30,
      },
      select: expect.any(Object),
    });
    expect(update).toHaveBeenLastCalledWith({
      where: { id: "persona-1" },
      data: { deletedAt: expect.any(Date) },
      select: expect.any(Object),
    });
    expect(
      actionLogCreate.mock.calls.map(([input]) => input.data.actionType),
    ).toEqual(["PERSONA_CREATED", "PERSONA_UPDATED", "PERSONA_DELETED"]);
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
      characterActionLog: { create: jest.fn().mockResolvedValue({}) },
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

  it("bulk-creates personas and numbers them in submitted order", async () => {
    const createdAt = new Date("2026-07-08T00:00:00.000Z");
    let sequence = 0;
    const create = jest.fn().mockImplementation(({ data }) => {
      sequence += 1;
      return Promise.resolve({
        id: `persona-${sequence}`,
        characterId: data.characterId,
        title: data.title,
        content: data.content,
        sortOrder: data.sortOrder,
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      });
    });
    const actionLogCreate = jest.fn().mockResolvedValue({});
    const service = new (
      CharactersService as new (...args: unknown[]) => CharactersService
    )({
      character: {
        findUnique: jest.fn().mockResolvedValue({ id: "character-1" }),
      },
      characterPersona: {
        create,
        // Existing top persona sits at 40, so the batch continues at 50, 60.
        findFirst: jest.fn().mockResolvedValue({ sortOrder: 40 }),
      },
      characterActionLog: { create: actionLogCreate },
    });

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
    expect(create).toHaveBeenCalledTimes(2);
    expect(actionLogCreate).toHaveBeenCalledTimes(2);
    expect(actionLogCreate).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        actionType: "PERSONA_CREATED",
        targetId: "persona-2",
      }),
    });
  });

  it("reorders personas and rejects a mismatched id set", async () => {
    const createdAt = new Date("2026-07-08T00:00:00.000Z");
    const personaRow = (id: string, sortOrder: number) => ({
      id,
      characterId: "character-1",
      title: id,
      content: "c",
      sortOrder,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    });
    const findMany = jest
      .fn()
      .mockResolvedValue([personaRow("a", 10), personaRow("b", 20)]);
    const update = jest
      .fn()
      .mockImplementation(({ where, data }) =>
        Promise.resolve(personaRow(where.id, data.sortOrder)),
      );
    const actionLogCreate = jest.fn().mockResolvedValue({});
    const service = new (
      CharactersService as new (...args: unknown[]) => CharactersService
    )({
      character: {
        findUnique: jest.fn().mockResolvedValue({ id: "character-1" }),
      },
      characterPersona: { findMany, update },
      characterActionLog: { create: actionLogCreate },
    });

    const result = await service.reorderCharacterPersonas({
      characterId: "character-1",
      personaIds: ["b", "a"],
    });
    expect(result.items.map((p) => [p.id, p.sortOrder])).toEqual([
      ["b", 10],
      ["a", 20],
    ]);
    expect(actionLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ actionType: "PERSONA_REORDERED" }),
    });

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
    const create = jest.fn();
    const service = new (
      CharactersService as new (...args: unknown[]) => CharactersService
    )({
      character: {
        findUnique: jest.fn().mockResolvedValue({ id: "character-1" }),
      },
      characterMemory: { create },
      characterActionLog: { create: jest.fn() },
    });

    await expect(
      service.createCharacterMemories({
        characterId: "character-1",
        items: [
          { content: "valid", reason: "valid" },
          { content: "  ", reason: "valid" },
        ],
      }),
    ).rejects.toThrow("Character memory items[1] content is required");
    expect(create).not.toHaveBeenCalled();

    await expect(
      service.createCharacterMemories({
        characterId: "character-1",
        items: Array.from({ length: 51 }, () => ({
          content: "c",
          reason: "r",
        })),
      }),
    ).rejects.toThrow("Character memory items must be 50 or fewer");
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects persona fields beyond the length limits", async () => {
    const create = jest.fn();
    const service = new (
      CharactersService as new (...args: unknown[]) => CharactersService
    )({
      character: {
        findUnique: jest.fn().mockResolvedValue({ id: "character-1" }),
      },
      characterPersona: { create },
      characterActionLog: { create: jest.fn() },
    });

    await expect(
      service.createCharacterPersona({
        characterId: "character-1",
        title: "t".repeat(201),
        content: "fine",
      }),
    ).rejects.toThrow(
      "Character persona title must be at most 200 characters",
    );
    await expect(
      service.createCharacterPersona({
        characterId: "character-1",
        title: "fine",
        content: "c".repeat(8001),
      }),
    ).rejects.toThrow(
      "Character persona content must be at most 8000 characters",
    );
    expect(create).not.toHaveBeenCalled();
  });
});
