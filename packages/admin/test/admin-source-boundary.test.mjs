import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const srcRoot = join(import.meta.dirname, "../../../src");
const adminSrc = join(srcRoot, "admin");
const charactersSrc = join(srcRoot, "characters");

test("admin character API lives in the characters package", () => {
  assert.equal(
    existsSync(join(charactersSrc, "characters.controller.ts")),
    true,
  );
  assert.equal(existsSync(join(charactersSrc, "characters.service.ts")), true);

  const controller = readFileSync(
    join(adminSrc, "admin.controller.ts"),
    "utf8",
  );
  assert.equal(controller.includes('@Get("characters")'), false);
  assert.equal(controller.includes('@Post("characters")'), false);
  assert.equal(controller.includes("CharacterPersona"), false);

  const service = readFileSync(join(adminSrc, "admin.service.ts"), "utf8");
  for (const method of [
    "createCharacter(",
    "updateCharacter(",
    "getCharacter(",
    "createCharacterPersona(",
    "createCharacterMemory(",
  ]) {
    assert.equal(service.includes(method), false);
  }
});
