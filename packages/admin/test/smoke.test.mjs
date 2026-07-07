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
    assert.equal(request.headers.authorization, "Bearer secret");
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
    { headers: { authorization: "Bearer secret" } },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
});

test("does not inject or override the admin session token", async (t) => {
  const seenHeaders = [];
  const backend = http.createServer((request, response) => {
    seenHeaders.push(request.headers.authorization);
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
    headers: { authorization: "Bearer client-token" },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  const responseWithoutHeader = await fetch(
    `http://127.0.0.1:${adminPort}/api/users`,
  );

  assert.equal(responseWithoutHeader.status, 200);
  assert.deepEqual(await responseWithoutHeader.json(), { ok: true });
  assert.deepEqual(seenHeaders, ["Bearer client-token", undefined]);
});

test("returns JSON when the API backend is unavailable", async (t) => {
  const admin = createServer({
    apiBaseUrl: "http://127.0.0.1:1",
  });
  const adminPort = await listen(admin);
  t.after(() => admin.close());

  const response = await fetch(`http://127.0.0.1:${adminPort}/api/characters`);

  assert.equal(response.status, 502);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  const body = await response.json();
  assert.equal(body.error, "Admin API backend is unavailable");
  assert.match(body.detail, /fetch failed|bad port|ECONNREFUSED/i);
});
