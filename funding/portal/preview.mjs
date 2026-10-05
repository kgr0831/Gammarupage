import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { renderReport } from "./views.mjs";
import { exampleReport } from "../tests/fixtures.mjs";
import { validateReport } from "../schema.mjs";
import { seoulClock } from "../config.mjs";

const date = seoulClock().date;
const html = renderReport({ ...validateReport(exampleReport, date), date, generatedAt: new Date().toISOString(), provider: "PREVIEW / 가상 데이터" });
const port = Number(process.env.PORTAL_PREVIEW_PORT || 4312);
createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.url === "/brand/gammaru-mark.png") {
    res.setHeader("Content-Type", "image/png"); res.end(await readFile(new URL("../../public/brand/gammaru-mark.png", import.meta.url))); return;
  }
  if (req.method !== "GET") { res.writeHead(405); res.end("Read-only preview"); return; }
  res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(html);
}).listen(port, "127.0.0.1", () => console.log(`Read-only sample report: http://127.0.0.1:${port}`));
