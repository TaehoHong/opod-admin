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
      subjectState: "",
      motionEvidence: "",
      notInFrame: [],
      subjectCameraRelation: "deliberately_posed",
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
    expect(result.modelPolicy.version).toBe("nano-banana-policy-v2");
    expect(result.modelPolicy.instructions).toContain(
      "Never copy its pose, crop, background, camera geometry, or composition",
    );
    expect(result.modelPolicy.instructions).toContain(
      "requested identity or wardrobe attributes",
    );
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

  it("builds ordered person and environment contracts for FLUX.1 Kontext", () => {
    const fluxPlan: ImagePlanReady = {
      ...imagePlan,
      shots: [
        {
          ...imagePlan.shots[0],
          referenceBindings: [
            imagePlan.shots[0].referenceBindings[0],
            {
              bindingId: "environment-1",
              id: "media-2",
              source: "environment",
              semanticPurposes: ["environment"],
              preserve: [
                "cream plaster walls",
                "black metal window frames",
                "window placement",
              ],
              avoidCopying: ["people", "camera viewpoint"],
            },
          ],
        },
      ],
    };

    const result = buildPromptPackage({
      targetModelId: "black-forest-labs/FLUX.1-Kontext-dev",
      imagePlan: fluxPlan,
      appearance: "black bob hair",
    });

    expect(result.referenceSlots).toEqual([
      expect.objectContaining({
        referenceId: "media-1",
        slot: "Reference image 1",
        source: "identity",
      }),
      expect.objectContaining({
        referenceId: "media-2",
        slot: "Reference image 2",
        source: "environment",
        preserve: [
          "cream plaster walls",
          "black metal window frames",
          "window placement",
        ],
      }),
    ]);
    expect(result.modelPolicy).toMatchObject({
      version: "flux-kontext-policy-v1",
      usesNegativePrompt: false,
    });
  });
});

// image-plan-v3 이전 초안에는 subjectCameraRelation이 없고, 더 오래된 초안에는
// subjectState·motionEvidence·notInFrame도 없다.
// 재실행·프롬프트 재빌드 경로가 그걸 만나 터지면 옛 초안이 통째로 막힌다.
it("builds a prompt package from a pre-v2 plan that lacks the new fields", () => {
  const legacyShot = {
    sortOrder: 0,
    visualPurpose: "핏 기록",
    scene: "거울 앞",
    captureSetup: "후면 카메라",
    characterPresentation: {
      mode: "reflection" as const,
      visibleParts: ["전신"],
      faceVisible: false,
      identityPreservationRequired: false,
    },
    referenceBindings: [],
  };
  const plan = {
    status: "ready" as const,
    locationId: null,
    continuity: { lockedElements: [] },
    shots: [legacyShot],
  } as unknown as Parameters<typeof buildPromptPackage>[0]["imagePlan"];

  const built = buildPromptPackage({
    targetModelId: "fal-ai/nano-banana-pro/edit",
    imagePlan: plan,
    appearance: "long black hair",
  });

  expect(built.imagePlan.shots[0].sortOrder).toBe(0);
  expect(built.referenceSlots).toEqual([]);
});
