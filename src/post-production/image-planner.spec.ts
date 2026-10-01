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
