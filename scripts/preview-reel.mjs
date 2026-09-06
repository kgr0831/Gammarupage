import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("test-results/reel-v2");
const files = {
  "/": [path.resolve("scripts/reel-preview.html"), "text/html; charset=utf-8"],
  "/gammaru-reel-v2.mp4": [path.join(root, "gammaru-reel-v2.mp4"), "video/mp4"],
  "/gammaru-reel-v2-av1.mp4": [path.join(root, "gammaru-reel-v2-av1.mp4"), "video/mp4"],
  "/poster.jpg": [path.join(root, "poster.jpg"), "image/jpeg"],
  "/contact-sheet.jpg": [path.join(root, "contact-sheet.jpg"), "image/jpeg"],
  "/manifest.json": [path.join(root, "manifest.json"), "application/json"],
};

createServer(async (request, response) => {
  try {
    if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405).end(); return; }
    const file = files[new URL(request.url, "http://localhost").pathname];
    if (!file) { response.writeHead(404).end(); return; }
    const size = (await stat(file[0])).size;
    const headers = { "Content-Type": file[1], "Accept-Ranges": "bytes", "Cache-Control": "no-cache" };
    const match = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    let start = 0;
    let end = size - 1;
    if (match) {
      if (match[1]) { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end; }
      else if (match[2]) start = Math.max(0, size - Number(match[2]));
      else { response.writeHead(416, { "Content-Range": `bytes */${size}` }).end(); return; }
      if (start > end || start >= size) { response.writeHead(416, { "Content-Range": `bytes */${size}` }).end(); return; }
      headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    }
    response.writeHead(match ? 206 : 200, { ...headers, "Content-Length": end - start + 1 });
    if (request.method === "HEAD") { response.end(); return; }
    const stream = createReadStream(file[0], { start, end });
    stream.on("error", () => response.destroy());
    response.on("close", () => stream.destroy());
    stream.pipe(response);
  } catch {
    if (!response.headersSent) response.writeHead(404);
    response.end();
  }
}).listen(3188, "127.0.0.1", () => console.log("Reel preview: http://127.0.0.1:3188"));
