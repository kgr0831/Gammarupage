import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { configuration, seoulClock } from "./config.mjs";
import { Store } from "./store.mjs";
import { validateReport } from "./schema.mjs";
import { listen } from "./server.mjs";
import { exampleReport } from "./tests/fixtures.mjs";

const config = { ...configuration({ FUNDING_ADMIN_TOKEN: randomBytes(32).toString("hex"), FUNDING_PORT: process.env.FUNDING_PREVIEW_PORT || "4311", FUNDING_DATA_DIR: await mkdtemp(path.join(tmpdir(), "gammaru-preview-")) }), demo: true };
const store = new Store(config.dataDir);
const { date } = seoulClock();
store.startRun(date);
store.saveReport({ ...validateReport(exampleReport, date), date, generatedAt: new Date().toISOString(), provider: "codex", fallbackReason: null }, "");
store.notification(date, "not_configured");
await listen(config, { store });
console.log(`Read-only sample preview: ${config.origin}`);
