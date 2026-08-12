import {
  buildPromptPackage,
  resolveImageModelPolicy,
  UnsupportedImagePlanError,
} from "./image-model-policy";
import { ImagePlanReady } from "./image-planner";

const imagePlan: ImagePlanReady = {
  status: "ready",
  locationId: null,
  continuity: { lockedElements: [] },
  shots: [
    {
      sortOrder: 0,
      visualPurpose: "인물을 보여준다",
      scene: "창가에 앉은 인물",
      captureSetup: "맞은편 눈높이",
      characterPresentation: {
        mode: "full",
        visibleParts: ["face"],
        faceVisible: true,
        identityPreservationRequired: true,
      },
      referenceBindings: [
        {
          bindingId: "identity-1",
          id: "media-1",
          source: "identity",
          semanticPurposes: ["identity"],
          preserve: ["facial identity"],
          avoidCopying: ["background"],
        },
      ],
    },
  ],
};

describe("image model policy", () => {
  it("maps every binding exactly once to provider-readable positional slots", () => {
    const result = buildPromptPackage({
      targetModelId: "fal-ai/nano-banana-pro/edit",
      imagePlan,
      appearance: "black bob hair",
    });
    expect(result.referenceSlots).toEqual([
      expect.objectContaining({
        bindingId: "identity-1",
        referenceId: "media-1",
        slot: "Image 1",
      }),
    ]);
  });

  it("rejects unknown exact model IDs before an Agent call", () => {
    expect(() => resolveImageModelPolicy("nano-banana-pro/edit")).toThrow(
      UnsupportedImagePlanError,
    );
  });

  it("does not silently drop references on a text-only route", () => {
    expect(() =>
      buildPromptPackage({
        targetModelId: "fal-ai/nano-banana-pro",
        imagePlan,
        appearance: "black bob hair",
      }),
    ).toThrow("references_not_supported");
  });
});
