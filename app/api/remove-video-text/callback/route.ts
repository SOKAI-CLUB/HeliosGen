import { NextRequest, NextResponse } from "next/server";
import { findRemovalJob, syncRemoval, validateJobId, verifyWebhookSignature, replicateToken } from "@/lib/server/videoTextRemoval";
import { replicateRequest, TextRemovalError } from "@/lib/videoTextRemoval";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("jobId");
    validateJobId(id);
    if (!verifyWebhookSignature(id, req.nextUrl.searchParams.get("signature") ?? "")) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
    const row = await findRemovalJob(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (row.status !== "pending") return NextResponse.json({ ok: true });
    // Re-fetch from Replicate; webhook body is never trusted for output URLs.
    const body = await req.json();
    if (!/^[a-z0-9]+$/.test(body?.id ?? "")) return NextResponse.json({ error: "Invalid prediction" }, { status: 400 });
    const prediction = await replicateRequest(replicateToken(), `/${body.id}`);
    await syncRemoval(row, prediction);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: "Callback could not be saved" }, { status: error instanceof TextRemovalError ? error.status : 503 });
  }
}
