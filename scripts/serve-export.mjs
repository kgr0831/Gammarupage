import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const root = path.resolve(process.cwd(), "out");
const basePath = process.env.PAGES_BASE_PATH || "/Gammarupage";
const port = Number(process.env.PORT || 4173);

const mimeTypes = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8",
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (url.pathname === basePath) {
      response.writeHead(308, { location: `${basePath}/` });
      response.end();
      return;
    }
    if (!url.pathname.startsWith(`${basePath}/`)) throw Object.assign(new Error("Not found"), { code: "ENOENT" });

    const relative = decodeURIComponent(url.pathname.slice(basePath.length)).replace(/^\/+/, "");
    let target = path.resolve(root, relative || "index.html");
    if (!target.startsWith(`${root}${path.sep}`) && target !== root) throw Object.assign(new Error("Not found"), { code: "ENOENT" });
    const info = await stat(target);
    if (info.isDirectory()) target = path.join(target, "index.html");
    const finalInfo = await stat(target);

    const type = mimeTypes[path.extname(target)] || "application/octet-stream";
    const range = request.headers.range?.match(/bytes=(\d*)-(\d*)/);
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), finalInfo.size - 1) : finalInfo.size - 1;
      if (start > end || start >= finalInfo.size) {
        response.writeHead(416, { "content-range": `bytes */${finalInfo.size}` });
        response.end();
        return;
      }
      response.writeHead(206, {
        "accept-ranges": "bytes",
        "content-length": end - start + 1,
        "content-range": `bytes ${start}-${end}/${finalInfo.size}`,
        "content-type": type,
      });
      if (request.method === "HEAD") response.end();
      else createReadStream(target, { start, end }).pipe(response);
      return;
    }

    response.writeHead(200, { "accept-ranges": "bytes", "content-length": finalInfo.size, "content-type": type });
    if (request.method === "HEAD") response.end();
    else createReadStream(target).pipe(response);
  } catch (error) {
    response.writeHead(error?.code === "ENOENT" ? 404 : 500, { "content-type": "text/plain; charset=utf-8" });
    response.end(error?.code === "ENOENT" ? "Not found" : "Server error");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Serving ${root} at http://127.0.0.1:${port}${basePath}/`);
});
