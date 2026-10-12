import { handleRetention } from "../../../../../funding/vercel/maintenance.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  return handleRetention(request);
}
