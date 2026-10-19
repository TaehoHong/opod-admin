import { DraftsService } from "./drafts.service";
import { DraftsRepository } from "./drafts.repository";
import { GenerationService } from "../generation/generation.service";
import { GenerationSettingsService } from "../settings/generation-settings.service";

describe("archived existing Agent", () => {
  const repository = {
    findDraftConcept: jest.fn().mockResolvedValue({ conceptJson: {} }),
    createDraft: jest.fn(),
    setAutomation: jest.fn(),
  };
  const service = new DraftsService(
    repository as unknown as DraftsRepository,
    {} as GenerationSettingsService,
    {} as GenerationService,
  );

  it.each([undefined, "existing"] as const)(
    "rejects creating a draft with agent %s before persistence",
    async (postGenerationAgent) => {
      await expect(
        service.createDraft({ characterId: "character", postGenerationAgent }),
      ).rejects.toThrow("기존 Agent는 보관되었습니다");
      expect(repository.createDraft).not.toHaveBeenCalled();
    },
  );

  it("keeps old draft automation and approval read-only", async () => {
    await expect(service.setAutomation("draft", true)).rejects.toThrow(
      "읽기 전용",
    );
    await expect(service.approveDraft("draft")).rejects.toThrow("읽기 전용");
    expect(repository.setAutomation).not.toHaveBeenCalled();
  });
});
