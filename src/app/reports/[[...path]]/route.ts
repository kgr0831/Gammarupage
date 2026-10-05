import { after } from "next/server";
import { handleBriefRequest } from "../../../../funding/vercel/handler.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  return handleBriefRequest(request, { after });
}

export async function POST(request: Request) {
  return handleBriefRequest(request, { after });
}
