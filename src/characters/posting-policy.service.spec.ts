import { PostingPolicyService } from "./posting-policy.service";

// application service는 concrete repository를 주입받는다
// (docs/02-development-rules.md:55).
function repositoryMock() {
  return {
    characterExists: jest.fn().mockResolvedValue(true),
    findByCharacter: jest.fn().mockResolvedValue(null),
    upsert: jest.fn(),
    recordPolicyChange: jest.fn().mockResolvedValue(undefined),
  };
}

function makeService(policies: ReturnType<typeof repositoryMock>) {
  return new (
    PostingPolicyService as new (policies: unknown) => PostingPolicyService
  )(policies);
}

describe("PostingPolicyService", () => {
  it("returns a disabled default before a policy exists", async () => {
    const service = makeService(repositoryMock());
    await expect(service.getPolicy("ai-1")).resolves.toEqual({
      characterId: "ai-1",
      enabled: false,
      weeklyCadence: 3,
      hourStartKst: 18,
      hourEndKst: 22,
    });
  });

  it("upserts a policy and records an action log", async () => {
    const policies = repositoryMock();
    policies.upsert.mockResolvedValue({
      characterId: "ai-1",
      enabled: true,
      weeklyCadence: 4,
      hourStartKst: 10,
      hourEndKst: 21,
      updatedAt: new Date("2026-07-12T00:00:00.000Z"),
    });
    const service = makeService(policies);

    await expect(
      service.upsertPolicy({
        characterId: "ai-1",
        enabled: true,
        weeklyCadence: 4,
        hourStartKst: 10,
        hourEndKst: 21,
      }),
    ).resolves.toMatchObject({ enabled: true, weeklyCadence: 4 });
    expect(policies.recordPolicyChange).toHaveBeenCalledWith(
      "ai-1",
      expect.stringContaining("posting policy enabled"),
    );
  });

  it("rejects an inverted hour window", async () => {
    const service = makeService(repositoryMock());
    await expect(
      service.upsertPolicy({
        characterId: "ai-1",
        hourStartKst: 22,
        hourEndKst: 18,
      }),
    ).rejects.toThrow("hourStartKst must be earlier than hourEndKst");
  });

  it("rejects an out-of-range cadence", async () => {
    const service = makeService(repositoryMock());
    await expect(
      service.upsertPolicy({ characterId: "ai-1", weeklyCadence: 99 }),
    ).rejects.toThrow("weeklyCadence must be an integer between 1 and 21");
  });

  it("rejects a missing character", async () => {
    const policies = repositoryMock();
    policies.characterExists.mockResolvedValue(false);
    const service = makeService(policies);
    await expect(service.getPolicy("missing")).rejects.toThrow(
      "Character not found",
    );
  });
});
