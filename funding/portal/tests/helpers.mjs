import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { portalConfiguration } from "../config.mjs";
import { createPortal } from "../server.mjs";
import { digest } from "../../schema.mjs";
import { seoulClock } from "../../config.mjs";
import { exampleReport } from "../../tests/fixtures.mjs";

export const date = seoulClock().date;
export const input = () => ({ date, checkedAt: new Date().toISOString(), report: structuredClone(exampleReport) });
export const identity = (id = "100000000000000001") => ({ id, username: `member-${id}`, global_name: "테스트 회원", avatar: null });
export async function setup(overrides = {}, dependencies = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "gammaru-portal-test-"));
  const config = { ...portalConfiguration({ FUNDING_ADMIN_TOKEN: randomBytes(32).toString("hex"), FUNDING_PUBLISHER_TOKEN: randomBytes(32).toString("hex"), FUNDING_PORT: "0", FUNDING_DATA_DIR: directory }), ...overrides };
  const portal = createPortal(config, dependencies);
  const server = createServer(async (req, res) => {
    if (await portal.handle(req, res)) return;
    if (req.url === "/brand/gammaru-mark.png") {
      res.setHeader("Content-Type", "image/png"); res.end(await readFile(new URL("../../../public/brand/gammaru-mark.png", import.meta.url))); return;
    }
    res.writeHead(404); res.end("Public site handled by Next in production");
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  config.origin = `http://127.0.0.1:${server.address().port}`;
  const session = (role, subject = role) => {
    const proof = role === "admin" ? digest([config.adminUsername, config.token]) : role === "publisher" ? digest(config.publisherToken) : "discord";
    return `gammaru=${portal.store.newSession(role, subject, proof, 3600)}`;
  };
  const request = (route, cookie = "", fields, origin = config.origin) => fetch(`${config.origin}${route}`, {
    redirect: "manual", headers: { cookie, ...(fields === undefined ? {} : { origin, "content-type": "application/x-www-form-urlencoded" }) },
    ...(fields === undefined ? {} : { method: "POST", body: new URLSearchParams(fields) }),
  });
  const close = async () => {
    await portal.service.running;
    await new Promise((resolve) => server.close(resolve)); portal.store.close();
    const target = path.resolve(directory), tempRoot = path.resolve(tmpdir());
    if (path.dirname(target) !== tempRoot || !path.basename(target).startsWith("gammaru-portal-test-")) throw new Error("Unexpected test cleanup target");
    await rm(target, { recursive: true, force: true });
  };
  return { ...portal, config, directory, request, session, close, server };
}
