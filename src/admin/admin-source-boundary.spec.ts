import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("admin character source boundary", () => {
  it("keeps character APIs in the characters package", () => {
    const charactersSource = join(__dirname, "../characters");

    expect(existsSync(join(charactersSource, "characters.controller.ts"))).toBe(
      true,
    );
    expect(existsSync(join(charactersSource, "characters.service.ts"))).toBe(
      true,
    );

    const controller = readFileSync(
      join(__dirname, "admin.controller.ts"),
      "utf8",
    );
    expect(controller).not.toContain('@Get("characters")');
    expect(controller).not.toContain('@Post("characters")');
    expect(controller).not.toContain("CharacterPersona");

    const service = readFileSync(join(__dirname, "admin.service.ts"), "utf8");
    for (const method of [
      "createCharacter(",
      "updateCharacter(",
      "getCharacter(",
      "createCharacterPersona(",
      "createCharacterMemory(",
    ]) {
      expect(service).not.toContain(method);
    }
  });
});
