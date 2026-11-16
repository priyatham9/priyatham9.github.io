import { createServer } from "node:http";
import { readFile, stat, realpath } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import handler from "../api/analysis.mjs";
const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};
export function createDevServer() {
  return createServer(async (req, res) => {
    try {
      const path = decodeURIComponent((req.url || "/").split("?")[0]);
      if (path === "/api/analysis") return handler(req, res);
      if (path.startsWith("/api/")) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      if (!["GET", "HEAD"].includes(req.method)) {
        res.writeHead(405, { Allow: "GET, HEAD" });
        res.end("Method not allowed");
        return;
      }
      if (
        path.includes("\0") ||
        path.includes("\\") ||
        path
          .split("/")
          .some(
            (p) =>
              p.startsWith(".") ||
              ["node_modules", "scripts", "tests"].includes(p),
          )
      ) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      let file = resolve(root, "." + path);
      if (file !== root && !file.startsWith(root + sep)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
      file = await realpath(file);
      if (!file.startsWith(root + sep)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": mime[extname(file)] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch (error) {
      res.writeHead(error instanceof URIError ? 400 : 404);
      res.end(error instanceof URIError ? "Bad request" : "Not found");
    }
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT || 8000);
  createDevServer().listen(port, "127.0.0.1", () =>
    console.log(`Portfolio and API: http://127.0.0.1:${port}`),
  );
}
