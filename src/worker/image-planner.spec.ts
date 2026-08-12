import {
  ImagePlannerInput,
  ImagePlanReady,
  parseImagePlan,
} from "./image-planner";

const input: ImagePlannerInput = {
  postPlan: {
    intent: {
      premise: "카페에서 친구를 기다린다.",
      primaryPurpose: "기다림을 기록한다.",
      secondaryPurpose: null,
    },
    caption: "조금 일찍 왔다",
  },
  imageCount: 1,
  characterVisualContext: {
    name: "서린",
    appearance: "black bob hair",
    visualStyle: "ordinary phone photo",
    boundaries: [],
    relevantContext: [],
  },
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

  it("requires identity-purpose binding when recognizable identity is required", () => {
    const visible = structuredClone(ready);
    visible.shots[0].characterPresentation = {
      mode: "full",
      visibleParts: ["face"],
      faceVisible: true,
      identityPreservationRequired: true,
    };
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
            },
          ],
        },
        input,
      ),
    ).toMatchObject({ status: "blocked" });
  });
});
