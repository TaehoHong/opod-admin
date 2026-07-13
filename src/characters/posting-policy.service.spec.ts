import { PostingPolicyService } from "./posting-policy.service";

function prismaMock() {
  return {
    character: { findUnique: jest.fn().mockResolvedValue({ id: "ai-1" }) },
    characterPostingPolicy: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
    },
    characterActionLog: { create: jest.fn().mockResolvedValue({}) },
  };
}

function makeService(prisma: ReturnType<typeof prismaMock>) {
  return new (
    PostingPolicyService as new (prisma: unknown) => PostingPolicyService
  )(prisma);
}

describe("PostingPolicyService", () => {
  it("returns a disabled default before a policy exists", async () => {
    const service = makeService(prismaMock());
    await expect(service.getPolicy("ai-1")).resolves.toEqual({
      characterId: "ai-1",
      enabled: false,
      weeklyCadence: 3,
      hourStartKst: 18,
      hourEndKst: 22,
    });
  });

  it("upserts a policy and records an action log", async () => {
    const prisma = prismaMock();
    prisma.characterPostingPolicy.upsert.mockResolvedValue({
      characterId: "ai-1",
      enabled: true,
      weeklyCadence: 4,
      hourStartKst: 10,
      hourEndKst: 21,
      updatedAt: new Date("2026-07-12T00:00:00.000Z"),
    });
    const service = makeService(prisma);

    await expect(
      service.upsertPolicy({
        characterId: "ai-1",
        enabled: true,
        weeklyCadence: 4,
        hourStartKst: 10,
        hourEndKst: 21,
      }),
    ).resolves.toMatchObject({ enabled: true, weeklyCadence: 4 });
    expect(prisma.characterActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actionType: "POSTING_POLICY_UPDATED" }),
    });
  });

  it("rejects an inverted hour window", async () => {
    const service = makeService(prismaMock());
    await expect(
      service.upsertPolicy({
        characterId: "ai-1",
        hourStartKst: 22,
        hourEndKst: 18,
      }),
    ).rejects.toThrow("hourStartKst must be earlier than hourEndKst");
  });

  it("rejects an out-of-range cadence", async () => {
    const service = makeService(prismaMock());
    await expect(
      service.upsertPolicy({ characterId: "ai-1", weeklyCadence: 99 }),
    ).rejects.toThrow("weeklyCadence must be an integer between 1 and 21");
  });

  it("rejects a missing character", async () => {
    const prisma = prismaMock();
    prisma.character.findUnique.mockResolvedValue(null);
    const service = makeService(prisma);
    await expect(service.getPolicy("missing")).rejects.toThrow(
      "Character not found",
    );
  });
});
