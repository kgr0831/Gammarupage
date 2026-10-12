import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { publicSiteUrl } from "@/lib/paths";

// The selected design is a complete HTML document with its own DOM animation
// lifecycle. Serve it at / without the legacy React layout or duplicate scripts.
// All authenticated report routes continue through their existing handlers.
export const dynamic = "force-static";
export const runtime = "nodejs";

export async function GET() {
  const assets = ["styles.css", "games.js", "reel.js", "script.js", "illustrations.js", "motion.js", "session.js"];
  const [template, ...contents] = await Promise.all([
    readFile(path.join(process.cwd(), "src/landing/index.html"), "utf8"),
    ...assets.map((name) => readFile(path.join(process.cwd(), "public/landing", name), "utf8")),
  ]);
  const version = createHash("sha256").update(contents.join("\0")).digest("hex").slice(0, 12);
  const origin = new URL("/", publicSiteUrl).href.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  const html = template.replaceAll("{{LANDING_VERSION}}", version).replaceAll("{{SITE_URL}}", origin);
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=0, must-revalidate",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  } });
}
