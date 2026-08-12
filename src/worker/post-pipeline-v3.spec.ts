import {
  POST_PIPELINE_V3,
  canonicalJsonHash,
  createPostPipelineV3Concept,
  isArtifactStale,
} from "./post-pipeline-v3";

describe("post pipeline V3 contract", () => {
  it("initializes a new manual draft at the post-plan boundary", () => {
    expect(
      createPostPipelineV3Concept({
        source: "manual",
        mode: "manual",
        operatorRequest: " 카페에서 비 오는 오후 ",
      }),
    ).toEqual({
      pipelineVersion: POST_PIPELINE_V3,
      source: "manual",
      mode: "manual",
      operatorRequest: "카페에서 비 오는 오후",
      pipeline: {
        stage: "post_plan",
        state: "pending",
        imageCount: null,
        reasonCodes: [],
      },
    });
  });

  it("hashes semantically identical JSON independently of object key order", () => {
    expect(canonicalJsonHash({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalJsonHash({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it("marks a downstream artifact stale when an upstream revision changes", () => {
    const artifact = {
      sourceArtifacts: {
        postPlanning: { revision: 1, hash: "sha256:post-1" },
      },
    };

    expect(
      isArtifactStale(artifact, {
        postPlanning: { revision: 1, hash: "sha256:post-1" },
      }),
    ).toBe(false);
    expect(
      isArtifactStale(artifact, {
        postPlanning: { revision: 2, hash: "sha256:post-2" },
      }),
    ).toBe(true);
  });
});
