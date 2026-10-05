import { createServer } from "node:http";
import next from "next";
import { portalConfiguration } from "./portal/config.mjs";
import { createPortal } from "./portal/server.mjs";

// One origin: the existing Next site plus the persistent membership/report backend.
// The report paths never enter the public static export or Next's public directory.
const config = portalConfiguration();
const dev = process.argv.includes("--dev");
if (process.env.GITHUB_ACTIONS === "true") throw new Error("The member portal requires a persistent Node server, not a static Pages export.");
const app = next({ dev, hostname: config.host, port: config.port });
await app.prepare();
const nextHandler = app.getRequestHandler();
const portal = createPortal(config);
portal.store.recover();
const server = createServer(async (req, res) => {
  try { if (!await portal.handle(req, res)) await nextHandler(req, res); }
  catch { if (!res.headersSent) res.writeHead(500); res.end("Request could not be completed."); }
});
server.requestTimeout = 35000;
server.headersTimeout = 10000;
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(config.port, config.host, resolve); });
const tick = () => portal.tick().catch(() => console.error("Daily worker needs review in the admin page."));
const timer = setInterval(tick, 60000); timer.unref();
await tick();
console.log(`GAMMARU platform: ${config.origin} | Members: /members | Admin: /admin`);
let closing = false;
async function close() {
  if (closing) return; closing = true; clearInterval(timer);
  // In-flight external operations retain persisted claims and recover as uncertain.
  server.close();
  await app.close();
  process.exit(0);
}
process.on("SIGINT", close); process.on("SIGTERM", close);
