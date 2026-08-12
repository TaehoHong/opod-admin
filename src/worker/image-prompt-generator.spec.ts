import { buildPromptPackage } from "./image-model-policy";
import {
  assertProviderReferenceOrder,
  parsePromptSet,
} from "./image-prompt-generator";
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
          bindingId: "binding-private",
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
const promptPackage = buildPromptPackage({
  targetModelId: "fal-ai/nano-banana-pro/edit",
  imagePlan,
  appearance: "black bob hair",
});

describe("Image Prompt Generation Agent contract", () => {
  it("accepts model policy output without generation parameters", () => {
    expect(
      parsePromptSet(
        {
          shots: [
            {
              sortOrder: 0,
              prompt:
                "Use Image 1 only for facial identity, not its background. Show the person seated by the window at opposite-eye height.",
              negativePrompt: null,
            },
          ],
        },
        promptPackage,
      ),
    ).toMatchObject({ shots: [{ negativePrompt: null }] });
  });

  it("rejects omitted slots and exposed internal binding IDs", () => {
    expect(() =>
      parsePromptSet(
        {
          shots: [
            {
              sortOrder: 0,
              prompt: "Show the person by the window.",
              negativePrompt: null,
            },
          ],
        },
        promptPackage,
      ),
    ).toThrow("omitted Image 1");
    expect(() =>
      parsePromptSet(
        {
          shots: [
            {
              sortOrder: 0,
              prompt: "Use Image 1 for binding-private.",
              negativePrompt: null,
            },
          ],
        },
        promptPackage,
      ),
    ).toThrow("exposed bindingId");
  });

  it("checks provider media order against the mapped binding order", () => {
    expect(() =>
      assertProviderReferenceOrder({
        shotSortOrder: 0,
        promptPackage,
        referenceMediaIds: ["wrong-media"],
      }),
    ).toThrow("slot/asset order mismatch");
  });
});
