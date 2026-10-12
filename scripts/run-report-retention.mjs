import { briefConfig, personalConfig } from "../funding/vercel/config.mjs";
import { createReportStore } from "../funding/vercel/store-factory.mjs";
import { pruneReports } from "../funding/vercel/retention.mjs";
import { seoulClock } from "../funding/clock.mjs";

// A systemd timer runs this locally with an instance role, without a public cron key.
const request = new Request(process.env.REPORTS_SITE_URL);
for (const [service, configure] of [["club", briefConfig], ["personal", personalConfig]]) {
  try {
    const result = await pruneReports(createReportStore(configure(request)), seoulClock(new Date()).date);
    console.log(JSON.stringify({ service, ...result }));
    if (result.pendingDeletes) process.exitCode = 1;
  } catch {
    console.error(`${service}: report retention failed`);
    process.exitCode = 1;
  }
}
