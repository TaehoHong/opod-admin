import {
  adminSwaggerTags,
  sortAdminSwaggerTags,
  tagForAdminPath,
} from "../src/admin/swagger";

describe("admin swagger", () => {
  it("groups admin paths by domain", () => {
    expect(adminSwaggerTags.map((tag) => tag.name)).toEqual([
      "인증",
      "캐릭터",
      "게시글",
      "스토리",
      "미디어",
      "크레딧",
      "사용자",
      "이벤트",
      "해시태그",
      "생성 작업",
      "초안",
      "로그",
      "분석",
      "결제",
      "모더레이션",
      "설정",
    ]);
    expect(tagForAdminPath("/api/admin/login")).toBe("인증");
    expect(tagForAdminPath("/api/characters")).toBe("캐릭터");
    expect(tagForAdminPath("/api/generation/jobs")).toBe("생성 작업");
    expect(tagForAdminPath("/api/drafts")).toBe("초안");
    expect(tagForAdminPath("/api/settings/generation")).toBe("설정");
  });

  it("sorts known domains before unknown tags", () => {
    expect(sortAdminSwaggerTags("캐릭터", "인증")).toBeGreaterThan(0);
    expect(sortAdminSwaggerTags("인증", "unknown")).toBeLessThan(0);
    expect(sortAdminSwaggerTags("b", "a")).toBeGreaterThan(0);
  });
});
