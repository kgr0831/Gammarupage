import { createServer } from "node:http";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { briefConfig } from "./vercel/config.mjs";
import { createBriefHandler } from "./vercel/handler.mjs";
import { BriefStore } from "./vercel/storage.mjs";
import { LocalFiles } from "./vercel/local-files.mjs";
import { savePersonalProfile } from "./vercel/personal-profile.mjs";

const origin = process.env.REPORTS_SITE_URL || "http://127.0.0.1:4320";
const address = new URL(origin);
if (address.hostname !== "127.0.0.1" || address.protocol !== "http:" || process.env.REPORTS_SERVICE !== "personal") throw new Error("Local personal configuration required.");
const config = briefConfig(new Request(`${origin}/reports`));
if (!config.configured) throw new Error("Set personal login credentials in .env.personal first.");
const store = new BriefStore(new LocalFiles("funding/data/personal-local"), "personal/briefs");
try {
  const seed = JSON.parse(await readFile("funding/data/personal-profile.json", "utf8"));
  await store.update(state => { if (!state.personalProfile) savePersonalProfile(state, { ...seed, revision: 0 }); });
} catch (error) { if (error.code !== "ENOENT") throw new Error("Check the private personal profile file."); }
const handle = createBriefHandler({ config, store, after: task => { Promise.resolve().then(task).catch(() => console.error("Local notification requires review.")); } });
const server = createServer(async (incoming, outgoing) => {
  try {
    if (incoming.headers.host !== address.host) { outgoing.writeHead(400); outgoing.end(); return; }
    const url = new URL(incoming.url, origin);
    if (url.origin !== origin) { outgoing.writeHead(400); outgoing.end(); return; }
    if (url.pathname === "/") { outgoing.writeHead(303, { location: "/reports" }); outgoing.end(); return; }
    if (!url.pathname.startsWith("/reports")) { outgoing.writeHead(404); outgoing.end(); return; }
    const request = new Request(url, { method: incoming.method, headers: incoming.headers, ...(!["GET", "HEAD"].includes(incoming.method) ? { body: Readable.toWeb(incoming), duplex: "half" } : {}) });
    const response = await handle(request);
    outgoing.writeHead(response.status, { ...Object.fromEntries(response.headers), "set-cookie": response.headers.getSetCookie() });
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500); outgoing.end("Local request failed."); }
});
server.listen(Number(address.port) || 80, "127.0.0.1", () => console.log(`Personal brief: ${origin}/reports`));
