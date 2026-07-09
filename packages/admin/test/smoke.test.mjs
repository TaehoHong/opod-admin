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
  assert.deepEqual(
    [...html.matchAll(/data-route="([^"]+)"/g)].map((match) => match[1]),
    navItems.map((item) => item.id),
  );
});
