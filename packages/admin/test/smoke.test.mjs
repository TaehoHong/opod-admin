import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
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
  assert.match(await response.text(), /AI SNS Admin/);
});

test("proxies admin API requests to the service backend", async (t) => {
  const backend = http.createServer((request, response) => {
    assert.equal(request.url, "/admin/character-action-logs");
    assert.equal(request.headers["x-admin-api-key"], "secret");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify([]));
  });
  const backendPort = await listen(backend);
  t.after(() => backend.close());

  const admin = createServer({
    apiBaseUrl: `http://127.0.0.1:${backendPort}`,
    adminApiKey: "secret",
  });
  const adminPort = await listen(admin);
  t.after(() => admin.close());

  const response = await fetch(
    `http://127.0.0.1:${adminPort}/api/admin/character-action-logs`,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
});
