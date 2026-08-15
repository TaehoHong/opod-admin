import {
  POST_PIPELINE_V3,
  POST_PIPELINE_V4,
  canonicalJsonHash,
  createPostPipelineV3Concept,
  generationSetHash,
  isArtifactStale,
  isPostPipelineV3,
  isPostPipelineV4,
} from "./post-pipeline-v3";

describe("post pipeline V3 contract", () => {
  // V4(검수 없음)는 같은 기계 위의 새 흐름이라 새 초안은 v4로 핀한다. 배포 전
  // v3 초안은 v3 경로로 완주해야 하므로 두 판별자가 다르게 답한다.
  it("pins new drafts to V4 while V3 drafts remain part of the V3 family", () => {
    expect(isPostPipelineV3({ pipelineVersion: POST_PIPELINE_V3 })).toBe(true);
    expect(isPostPipelineV3({ pipelineVersion: POST_PIPELINE_V4 })).toBe(true);
    expect(isPostPipelineV4({ pipelineVersion: POST_PIPELINE_V3 })).toBe(false);
    expect(isPostPipelineV4({ pipelineVersion: POST_PIPELINE_V4 })).toBe(true);
  });

  // 캡션 단계·평가·read model이 같은 함수로 같은 값을 내야 stale이 맞는다.
  it("hashes the generation set independently of item order", () => {
    const a = generationSetHash([
      { sortOrder: 1, jobId: "j1", mediaId: "m1" },
      { sortOrder: 0, jobId: "j0", mediaId: "m0" },
    ]);
    const b = generationSetHash([
      { sortOrder: 0, jobId: "j0", mediaId: "m0" },
      { sortOrder: 1, jobId: "j1", mediaId: "m1" },
    ]);
    expect(a).toBe(b);
    expect(
      generationSetHash([{ sortOrder: 0, jobId: "j0", mediaId: "m9" }]),
    ).not.toBe(generationSetHash([{ sortOrder: 0, jobId: "j0", mediaId: "m0" }]));
  });

  it("initializes a new manual draft at the post-plan boundary", () => {
    expect(
      createPostPipelineV3Concept({
        source: "manual",
        mode: "manual",
        operatorRequest: " 카페에서 비 오는 오후 ",
      }),
    ).toEqual({
      pipelineVersion: POST_PIPELINE_V4,
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
