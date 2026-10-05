import { after } from "next/server";
import { handleSiteRequest } from "../../../../funding/vercel/router.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  return handleSiteRequest(request, { after });
}

export async function POST(request: Request) {
  return handleSiteRequest(request, { after });
}
