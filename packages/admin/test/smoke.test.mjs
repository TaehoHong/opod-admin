import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { navItems } from "../main.js";

test("ships the admin UI shell", async () => {
  const html = await readFile(
    new URL("../index.html", import.meta.url),
    "utf8",
  );

  assert.match(html, /AI SNS Admin/);
  assert.match(html, /id="sidebarNav"/);
  assert.match(html, /id="mainPanel"/);
  assert.match(html, /data-route="characters"/);
  assert.doesNotMatch(html, /data-route="media"/);
  assert.deepEqual(
    [...html.matchAll(/data-route="([^"]+)"/g)].map((match) => match[1]),
    navItems.map((item) => item.id),
  );
});

test("ships the focused image generation workflow without a runtime dependency", async () => {
  const [source, styles, pkg] = await Promise.all([
    readFile(new URL("../main.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(
      JSON.parse,
    ),
  ]);

  for (const label of [
    "새 이미지 생성",
    "요청 입력",
    "프롬프트 확인",
    "후보 생성",
    "후보 선택",
  ]) {
    assert.match(source, new RegExp(label));
  }
  for (const className of [
    "generation-stepper",
    "generation-step",
    "generation-workflow-card",
    "generation-candidate-grid",
    "generation-candidate",
    "generation-history",
  ]) {
    assert.match(styles, new RegExp(`\\.${className}\\b`));
  }
  assert.deepEqual(pkg.dependencies ?? {}, {});
});
