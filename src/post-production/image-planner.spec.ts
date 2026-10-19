import { buildPromptPackage } from "./image-model-policy";
import {
  ImagePlannerInput,
  ImagePlanReady,
  parseImagePlan,
} from "./image-planner";

const input: ImagePlannerInput = {
  contentProfile: {
    accountConcept: "",
    imageStyle: "ordinary phone photo",
    constraints: "",
  },
  postPlan: {
    intent: {
      premise: "카페에서 친구를 기다린다.",
      primaryPurpose: "기다림을 기록한다.",
      secondaryPurpose: null,
    },
  },
  imageCount: 1,
  characterVisualContext: {
    name: "서린",
    appearance: "black bob hair",
    boundaries: [],
    capturePreferences: [],
    personaContext: [],
  },
  memories: [],
  recentVisualHistory: [],
  identityReferences: [{ id: "person-1", description: "face reference" }],
  locations: [],
};

const ready: ImagePlanReady = {
  status: "ready",
  locationId: null,
  continuity: { lockedElements: [] },
  shots: [
    {
      sortOrder: 0,
      visualPurpose: "기다림을 보여준다",
      scene: "테이블의 거의 빈 잔과 창밖 거리",
      captureSetup: "앉은 눈높이의 휴대폰 후면 카메라",
      characterPresentation: {
        mode: "none",
        visibleParts: [],
        faceVisible: false,
        identityPreservationRequired: false,
      },
      subjectState: "",
      motionEvidence: "",
      notInFrame: [],
      subjectCameraRelation: "not_applicable",
      referenceBindings: [],
    },
  ],
};

describe("Image Planning Agent contract", () => {
  const production = {
    format: "single_image" as const,
    location: { id: null, description: "카페 창가" },
    shots: [{ sortOrder: 0, content: "커피와 창문" }],
    requirements: [],
    contextFacts: [],
  };
  const visualDetails = {
    subject: "커피잔",
    wardrobe: null,
    setting: "창가 테이블",
    poseAction: null,
    expressionGaze: null,
    props: [],
    framing: "테이블 일부",
    camera: "앉은 위치에서 내려다봄",
    lighting: "창빛",
  };
  const structuredShot = {
    sortOrder: 0,
    visualDetails,
    characterPresentation: ready.shots[0].characterPresentation,
    notInFrame: [],
    subjectCameraRelation: "not_applicable",
    referenceBindings: [],
  };
  const referenceInput = {
    ...input,
    referenceSelection: "server_ids",
    imageCount: 2,
    postPlan: {
      ...input.postPlan,
      production: {
        ...production,
        format: "carousel",
        shots: [
          { sortOrder: 0, content: "전신" },
          { sortOrder: 1, content: "얼굴" },
        ],
      },
    },
  } as ImagePlannerInput;
  const referenceOutput = {
    ...ready,
    shots: [0, 1].map((sortOrder) => ({
      sortOrder,
      visualDetails,
      characterPresentation: {
        mode: "partial",
        visibleParts: ["face"],
        faceVisible: true,
        identityPreservationRequired: true,
      },
      subjectCameraRelation: "deliberately_posed",
      notInFrame: [],
      references: [
        {
          referenceId: "person-1",
          source: "identity",
          purposes: ["identity"],
          preserve: [sortOrder === 0 ? "body proportions" : "facial identity"],
          avoidCopying: ["lighting"],
        },
      ],
    })),
  };
  it("assigns internal IDs while preserving per-shot use of the same reference", () => {
    const result = parseImagePlan(
      referenceOutput,
      referenceInput,
    ) as ImagePlanReady;
    const packageInput = buildPromptPackage({
      imagePlan: result,
      appearance: "face",
      targetModelId: "gpt-image-2.5-sunburst",
    });
    expect(packageInput.referenceSlots).toMatchObject([
      {
        shotSortOrder: 0,
        referenceId: "person-1",
        slot: "Image 1",
        preserve: ["body proportions"],
      },
      {
        shotSortOrder: 1,
        referenceId: "person-1",
        slot: "Image 1",
        preserve: ["facial identity"],
      },
    ]);
    expect(result.shots.map((shot) => shot.referenceBindings)).toEqual([
      [
        {
          bindingId: "shot-0-ref-0",
          id: "person-1",
          source: "identity",
          semanticPurposes: ["identity"],
          preserve: ["body proportions"],
          avoidCopying: ["lighting"],
        },
      ],
      [
        {
          bindingId: "shot-1-ref-0",
          id: "person-1",
          source: "identity",
          semanticPurposes: ["identity"],
          preserve: ["facial identity"],
          avoidCopying: ["lighting"],
        },
      ],
    ]);
  });
  it("rejects more references per shot than the target image model accepts", () => {
    const output = structuredClone(referenceOutput);
    output.shots[0].references.push({
      ...output.shots[0].references[0],
      referenceId: "person-2",
      preserve: ["hair"],
    });
    const twoReferences = {
      ...referenceInput,
      identityReferences: [
        ...referenceInput.identityReferences,
        { id: "person-2", description: "body reference" },
      ],
    };
    expect(() => parseImagePlan(output, twoReferences)).not.toThrow();
    expect(() =>
      parseImagePlan(output, { ...twoReferences, maxReferencesPerShot: 1 }),
    ).toThrow("exceeds the image model limit of 1 references");
  });
  it.each([
    ["bindingId", "llm-name"],
    ["id", "person-1"],
    ["semanticPurposes", ["identity"]],
  ])(
    "rejects legacy reference field %s in the new raw contract",
    (key, value) => {
      const output = structuredClone(referenceOutput);
      Object.assign(output.shots[0].references[0], { [key as string]: value });
      expect(() => parseImagePlan(output, referenceInput)).toThrow();
    },
  );
  it("keeps source validation when the same asset belongs to both reference lists", () => {
    const output = structuredClone(referenceOutput);
    const locatedOutput = { ...output, locationId: "cafe" };
    output.shots[0].references[0].source = "environment";
    expect(() =>
      parseImagePlan(locatedOutput, {
        ...referenceInput,
        locationResolution: "match_planned",
        locations: [
          {
            id: "cafe",
            name: "cafe",
            description: "cafe",
            references: [{ id: "person-1", description: "room" }],
          },
        ],
      }),
    ).toThrow("environment binding has character purpose");
  });
  it.each([
    [0, 0],
    [0, 1],
  ])("rejects invalid single-shot continuity [%s, %s]", (...scope) => {
    expect(() =>
      parseImagePlan(
        {
          ...ready,
          continuity: {
            lockedElements: [
              {
                category: "wardrobe",
                description: "black shirt",
                appliesToShots: scope,
              },
            ],
          },
        },
        input,
      ),
    ).toThrow();
  });
  it("preserves continuity limited to two of three shots", () => {
    const output = {
      ...ready,
      shots: [0, 1, 2].map((sortOrder) => ({ ...ready.shots[0], sortOrder })),
      continuity: {
        lockedElements: [
          {
            category: "prop",
            description: "same blue cup",
            appliesToShots: [0, 2],
          },
        ],
      },
    };
    expect(parseImagePlan(output, { ...input, imageCount: 3 })).toEqual(output);
  });
  it.each([
    ["postPlan.production.requirements.0", "얼굴 비공개"],
    ["postPlan.production.shots.0.content", "얼굴이 보이는 사진"],
    ["postPlan.production.location.description", "카페 창가"],
    ["postPlan.production.contextFacts.0.quote", "얼굴 공개를 원하지 않는다"],
  ])("accepts exact approved production evidence at %s", (path, quote) => {
    const blocked = {
      status: "blocked",
      reasons: [
        {
          code: "visual_constraint_conflict",
          detail: "필수 얼굴 노출과 비공개가 충돌한다",
          evidence: {
            requirements: [{ path, quote }],
            referenceChecks: [],
            alternatives: [
              {
                description: "얼굴을 가리면 필수 노출 조건을 충족하지 못한다",
                satisfiesRequirements: false,
              },
            ],
          },
        },
      ],
    };
    const productionInput = {
      ...input,
      postPlan: {
        ...input.postPlan,
        production: {
          ...production,
          requirements: ["얼굴 비공개"],
          shots: [{ sortOrder: 0, content: "얼굴이 보이는 사진" }],
          contextFacts: [
            { path: "memories.0.content", quote: "얼굴 공개를 원하지 않는다" },
          ],
        },
      },
    };
    expect(parseImagePlan(blocked, productionInput)).toEqual(blocked);
    blocked.reasons[0].evidence.requirements[0].quote = "입력에 없는 조건";
    expect(() => parseImagePlan(blocked, productionInput)).toThrow(
      "does not match input",
    );
  });
  it("accepts sparse visual specifications without inventing action or wardrobe", () => {
    const result = parseImagePlan(
      { ...ready, shots: [structuredShot] },
      { ...input, postPlan: { ...input.postPlan, production } },
    );
    expect(result).toMatchObject({
      shots: [{ visualDetails, motionEvidence: "", subjectState: "" }],
    });
  });
  it.each(["cafe", null])(
    "resolves the planned setting to %s without requiring a registered place",
    (locationId) => {
      const matchingInput = {
        ...input,
        locationResolution: "match_planned" as const,
        locations: [
          {
            id: "cafe",
            name: "카페",
            description: "카페 창가",
            references: [],
          },
        ],
        postPlan: { ...input.postPlan, production },
      };
      expect(
        parseImagePlan(
          { ...ready, locationId, shots: [structuredShot] },
          matchingInput,
        ),
      ).toMatchObject({ locationId });
    },
  );
  it("rejects a different valid location instead of silently replanning", () => {
    expect(() =>
      parseImagePlan(
        { ...ready, locationId: "other", shots: [structuredShot] },
        {
          ...input,
          locations: [
            { id: "other", name: "다른 카페", description: "", references: [] },
          ],
          postPlan: { ...input.postPlan, production },
        },
      ),
    ).toThrow("changed the approved location");
  });
  it("accepts exactly imageCount model-independent shots", () => {
    expect(parseImagePlan(ready, input)).toEqual(ready);
  });

  it("rejects contradictory character presentation", () => {
    const contradictory = structuredClone(ready);
    contradictory.shots[0].characterPresentation.faceVisible = true;
    expect(() => parseImagePlan(contradictory, input)).toThrow(
      "none presentation is contradictory",
    );
  });

  it("rejects a missing or unknown subject-camera relation", () => {
    const missing = structuredClone(ready) as unknown as {
      shots: Record<string, unknown>[];
    };
    delete missing.shots[0].subjectCameraRelation;
    expect(() => parseImagePlan(missing, input)).toThrow("invalid fields");

    const unknown = structuredClone(ready) as unknown as {
      shots: { subjectCameraRelation: string }[];
    };
    unknown.shots[0].subjectCameraRelation = "casual";
    expect(() => parseImagePlan(unknown, input)).toThrow(
      "subjectCameraRelation is invalid",
    );
  });

  it("requires identity-purpose binding when recognizable identity is required", () => {
    const visible = structuredClone(ready);
    visible.shots[0].characterPresentation = {
      mode: "full",
      visibleParts: ["face"],
      faceVisible: true,
      identityPreservationRequired: true,
    };
    visible.shots[0].subjectCameraRelation = "deliberately_posed";
    expect(() => parseImagePlan(visible, input)).toThrow(
      "lacks an identity binding",
    );
  });

  it("accepts a blocker without partial shots", () => {
    expect(
      parseImagePlan(
        {
          status: "blocked",
          reasons: [
            {
              code: "insufficient_distinct_shots",
              detail: "의미를 바꾸지 않고 두 번째 역할을 만들 수 없다",
              evidence: {
                requirements: [
                  {
                    path: "postPlan.intent.premise",
                    quote: "카페에서 친구를 기다린다.",
                  },
                ],
                referenceChecks: [],
                alternatives: [
                  {
                    description:
                      "같은 순간을 다른 구도로 촬영해도 필수 조건이 공존하지 못한다",
                    satisfiesRequirements: false,
                  },
                ],
              },
            },
          ],
        },
        input,
      ),
    ).toMatchObject({ status: "blocked" });
  });

  it("rejects a blocked response that has no verifiable evidence", () => {
    expect(() =>
      parseImagePlan(
        {
          status: "blocked",
          reasons: [
            {
              code: "missing_identity_reference",
              detail: "참조는 충분하므로 실제 차단 사유는 없다",
            },
          ],
        },
        input,
      ),
    ).toThrow("evidence");
  });

  const identityBlock = {
    status: "blocked",
    reasons: [
      {
        code: "missing_identity_reference",
        detail: "필수로 보이는 머리의 정체성을 보존할 참조가 없다",
        evidence: {
          requirements: [
            {
              path: "characterVisualContext.appearance",
              quote: "black bob hair",
            },
          ],
          referenceChecks: [{ id: "person-1", suitable: false }],
          alternatives: [
            {
              description: "얼굴을 가려도 필수 머리 특징을 보존할 참조가 없다",
              satisfiesRequirements: false,
            },
          ],
        },
      },
    ],
  };
  it("accepts an identity blocker after all supplied references are assessed as unsuitable", () => {
    expect(parseImagePlan(identityBlock, input)).toEqual(identityBlock);
  });
  it("rejects an identity blocker that acknowledges a suitable reference", () => {
    const value = structuredClone(identityBlock);
    value.reasons[0].evidence.referenceChecks[0].suitable = true;
    expect(() => parseImagePlan(value, input)).toThrow(
      "suitable identity reference",
    );
  });
  it("rejects a blocker that acknowledges a satisfying alternative", () => {
    const value = structuredClone(identityBlock);
    value.reasons[0].evidence.alternatives[0].satisfiesRequirements = true;
    expect(() => parseImagePlan(value, input)).toThrow(
      "satisfying alternative",
    );
  });
  it.each([
    ["unknown path", "operatorRequest", "black bob hair"],
    ["invented quote", "characterVisualContext.appearance", "long red hair"],
    ["metadata path", "identityReferences.0.id", "person-1"],
  ])("rejects a requirement with %s", (_label, path, quote) => {
    const value = structuredClone(identityBlock);
    value.reasons[0].evidence.requirements = [{ path, quote }];
    expect(() => parseImagePlan(value, input)).toThrow("does not match input");
  });
  it("rejects unavailable reference IDs", () => {
    const value = structuredClone(identityBlock);
    value.reasons[0].evidence.referenceChecks[0].id = "unknown";
    expect(() => parseImagePlan(value, input)).toThrow(
      "reference check is invalid",
    );
  });
  it("requires every supplied identity reference to be checked before claiming none are suitable", () => {
    const value = structuredClone(identityBlock);
    value.reasons[0].evidence.referenceChecks = [];
    expect(() => parseImagePlan(value, input)).toThrow(
      "check all supplied identity references",
    );
  });
});
