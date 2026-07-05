import { createServer as createHttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const defaultApiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";
const defaultAdminApiKey = process.env.ADMIN_API_KEY;
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

export function createServer({
  apiBaseUrl = defaultApiBaseUrl,
  adminApiKey = defaultAdminApiKey,
} = {}) {
  return createHttpServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://admin.local");

      if (url.pathname.startsWith("/api/")) {
        await proxyApi(request, response, url, apiBaseUrl, adminApiKey);
        return;
      }

      await serveStatic(url.pathname, response);
    } catch {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end("Internal server error");
    }
  });
}

async function proxyApi(request, response, url, apiBaseUrl, adminApiKey) {
  const target = new URL(
    url.pathname.replace(/^\/api/, "") + url.search,
    apiBaseUrl,
  );
  const method = request.method ?? "GET";
  const body =
    method === "GET" || method === "HEAD" ? undefined : await readBody(request);
  const headers = copyHeaders(request.headers);

  if (adminApiKey && target.pathname.startsWith("/admin/")) {
    headers["x-admin-api-key"] = adminApiKey;
  }

  const upstream = await fetch(target, {
    method,
    headers,
    body,
  });

  response.writeHead(upstream.status, Object.fromEntries(upstream.headers));
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

async function serveStatic(pathname, response) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(rootDir, decodeURIComponent(requestedPath)));

  if (!filePath.startsWith(rootDir)) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type":
        contentTypes[extname(filePath)] ?? "application/octet-stream",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

async function readBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

function copyHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([key, value]) => key !== "host" && value !== undefined)
      .map(([key, value]) => [
        key,
        Array.isArray(value) ? value.join(", ") : value,
      ]),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 4173);
  createServer().listen(port, () => {
    console.log(`Admin UI: http://localhost:${port}`);
  });
}
