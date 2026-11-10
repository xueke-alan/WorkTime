"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { gzipSync } = require("node:zlib");
const { createHash, randomInt } = require("node:crypto");

/** Serve real release bytes with compression and a cache shared by HTTP requests. */
async function startupServer(directory) {
  const root = path.resolve(directory),
    cache = new Map();
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webmanifest": "application/manifest+json",
  };
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, "http://local").pathname,
      );
      const file = path.resolve(
        root,
        "." + (pathname === "/" ? "/index.html" : pathname),
      );
      if (!file.startsWith(root + path.sep))
        return response.writeHead(403).end();
      if (!cache.has(file)) {
        const data = await fs.readFile(file),
          type = types[path.extname(file)] || "application/octet-stream";
        const compressed = /text|json|svg/.test(type);
        cache.set(file, {
          body: compressed ? gzipSync(data) : data,
          type,
          compressed,
          etag: '"' + createHash("sha256").update(data).digest("hex") + '"',
        });
      }
      const item = cache.get(file);
      response.setHeader("Content-Type", item.type);
      response.setHeader("Cache-Control", "public, max-age=3600");
      response.setHeader("ETag", item.etag);
      response.setHeader("Vary", "Accept-Encoding");
      if (request.headers["if-none-match"] === item.etag)
        return response.writeHead(304).end();
      if (item.compressed) response.setHeader("Content-Encoding", "gzip");
      response.setHeader("Content-Length", item.body.length);
      response.end(item.body);
    } catch {
      response.writeHead(404).end();
    }
  });
  // Windows can assign port 0 to a browser-blocked low port (for example 6668).
  for (let attempt = 0; ; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(randomInt(20000, 60000), "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      break;
    } catch (error) {
      if (error.code !== "EADDRINUSE" || attempt >= 19) throw error;
    }
  }
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
module.exports = { startupServer };
