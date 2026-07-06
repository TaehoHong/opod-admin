import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { navItems } from "../main.js";
import { createServer } from "../server.mjs";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

test("serves the admin UI shell", async (t) => {
  const server = createServer();
  const port = await listen(server);
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${port}/`);

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /AI SNS Admin/);
  assert.match(html, /id="sidebarNav"/);
  assert.match(html, /id="mainPanel"/);
  assert.match(html, /data-route="characters"/);
  assert.deepEqual(
    [...html.matchAll(/data-route="([^"]+)"/g)].map((match) => match[1]),
    navItems.map((item) => item.id),
  );
});

test("proxies admin API requests to the service backend", async (t) => {
  const backend = http.createServer((request, response) => {
    assert.equal(request.url, "/api/character-action-logs");
    assert.equal(request.headers["x-admin-api-key"], "secret");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify([]));
  });
  const backendPort = await listen(backend);
  t.after(() => backend.close());

  const admin = createServer({
    apiBaseUrl: `http://127.0.0.1:${backendPort}`,
  });
  const adminPort = await listen(admin);
  t.after(() => admin.close());

  const response = await fetch(
    `http://127.0.0.1:${adminPort}/api/character-action-logs`,
    { headers: { "x-admin-api-key": "secret" } },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
});

test("does not inject or override the admin API key", async (t) => {
  const previousAdminApiKey = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "server-secret";
  t.after(() => {
    if (previousAdminApiKey === undefined) {
      delete process.env.ADMIN_API_KEY;
    } else {
      process.env.ADMIN_API_KEY = previousAdminApiKey;
    }
  });

  const seenHeaders = [];
  const backend = http.createServer((request, response) => {
    seenHeaders.push(request.headers["x-admin-api-key"]);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true }));
  });
  const backendPort = await listen(backend);
  t.after(() => backend.close());

  const admin = createServer({
    apiBaseUrl: `http://127.0.0.1:${backendPort}`,
  });
  const adminPort = await listen(admin);
  t.after(() => admin.close());

  const response = await fetch(`http://127.0.0.1:${adminPort}/api/users`, {
    headers: { "x-admin-api-key": "client-secret" },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  const responseWithoutHeader = await fetch(
    `http://127.0.0.1:${adminPort}/api/users`,
  );

  assert.equal(responseWithoutHeader.status, 200);
  assert.deepEqual(await responseWithoutHeader.json(), { ok: true });
  assert.deepEqual(seenHeaders, ["client-secret", undefined]);
});
