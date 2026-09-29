import { buildPromptPackage } from "./image-model-policy";
import {
  assertProviderReferenceOrder,
  ImagePromptGenerationAgent,
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
      subjectState: "",
      motionEvidence: "",
      notInFrame: [],
      subjectCameraRelation: "deliberately_posed",
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
const fluxImagePlan: ImagePlanReady = {
  ...imagePlan,
  shots: [
    {
      ...imagePlan.shots[0],
      referenceBindings: [
        imagePlan.shots[0].referenceBindings[0],
        {
          bindingId: "environment-private",
          id: "media-2",
          source: "environment",
          semanticPurposes: ["environment"],
          preserve: ["cream plaster walls", "window placement"],
          avoidCopying: ["people", "camera viewpoint"],
        },
      ],
    },
  ],
};
const fluxPromptPackage = buildPromptPackage({
  targetModelId: "black-forest-labs/FLUX.1-Kontext-dev",
  imagePlan: fluxImagePlan,
  appearance: "black bob hair",
});

describe("Image Prompt Generation Agent contract", () => {
  it("sends visual decisions and reference roles once without internal bookkeeping", async () => {
    const run = jest.fn().mockResolvedValue({
      value: {
        shots: [
          {
            sortOrder: 0,
            prompt:
              "Image 1 supplies facial identity. A person sits by the window.",
            negativePrompt: null,
          },
        ],
      },
      producerLogId: "log-1",
    });
    const original = structuredClone(promptPackage);
    const agent = new ImagePromptGenerationAgent({ run } as never);

    await agent.generate(promptPackage);

    const sent = run.mock.calls[0][0];
    expect(sent.input).toEqual({
      imagePlan: {
        continuity: imagePlan.continuity,
        shots: [
          {
            sortOrder: 0,
            scene: imagePlan.shots[0].scene,
            captureSetup: imagePlan.shots[0].captureSetup,
            characterPresentation: imagePlan.shots[0].characterPresentation,
            subjectState: "",
            motionEvidence: "",
            notInFrame: [],
            subjectCameraRelation: "deliberately_posed",
          },
        ],
      },
      subjectContract: promptPackage.subjectContract,
      referenceSlots: [
        {
          shotSortOrder: 0,
          slot: "Image 1",
          source: "identity",
          semanticPurposes: ["identity"],
          preserve: ["facial identity"],
          avoidCopying: ["background"],
        },
      ],
    });
    expect(sent.systemPrompt).toContain(promptPackage.modelPolicy.instructions);
    expect(promptPackage).toEqual(original);
  });

  it("omits character appearance for object-only plans while retaining finish and exclusions", async () => {
    const objectPlan: ImagePlanReady = {
      ...imagePlan,
      shots: [
        {
          ...imagePlan.shots[0],
          scene: "A cup on a table",
          captureSetup: "Viewed from above",
          characterPresentation: {
            mode: "none",
            visibleParts: [],
            faceVisible: false,
            identityPreservationRequired: false,
          },
          subjectCameraRelation: "not_applicable",
          referenceBindings: [],
        },
      ],
    };
    const input = buildPromptPackage({
      targetModelId: "fal-ai/nano-banana-pro",
      imagePlan: objectPlan,
      appearance: "black bob hair",
      visualStyle: "film photograph",
      exclusions: ["logos"],
    });
    const run = jest.fn().mockResolvedValue({
      value: {
        shots: [
          {
            sortOrder: 0,
            prompt:
              "A film photograph of an unbranded cup on a table, viewed from above.",
            negativePrompt: null,
          },
        ],
      },
      producerLogId: null,
    });

    await new ImagePromptGenerationAgent({ run } as never).generate(input);

    expect(run.mock.calls[0][0].input.subjectContract).toEqual({
      appearance: "",
      visualStyle: "film photograph",
      exclusions: ["logos"],
    });
    expect(input.subjectContract.appearance).toBe("black bob hair");
  });

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

  it("enforces FLUX.1 Kontext reference labels", () => {
    expect(
      parsePromptSet(
        {
          shots: [
            {
              sortOrder: 0,
              prompt:
                "Create a natural photograph. Reference image 1 supplies only the main character identity. Reference image 2 supplies only the cream plaster walls and window placement. Show the person seated by the window.",
              negativePrompt: null,
            },
          ],
        },
        fluxPromptPackage,
      ),
    ).toMatchObject({ shots: [{ negativePrompt: null }] });

    expect(() =>
      parsePromptSet(
        {
          shots: [
            {
              sortOrder: 0,
              prompt:
                "Create a natural photograph. Reference image 1 supplies only the main character identity. Show the person by the window.",
              negativePrompt: null,
            },
          ],
        },
        fluxPromptPackage,
      ),
    ).toThrow("omitted Reference image 2");

    expect(() =>
      assertProviderReferenceOrder({
        shotSortOrder: 0,
        promptPackage: fluxPromptPackage,
        referenceMediaIds: ["media-1", "media-2"],
      }),
    ).not.toThrow();
    expect(() =>
      assertProviderReferenceOrder({
        shotSortOrder: 0,
        promptPackage: fluxPromptPackage,
        referenceMediaIds: ["media-2", "media-1"],
      }),
    ).toThrow("slot/asset order mismatch");
  });
});
