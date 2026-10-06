import { NextRequest, NextResponse } from "next/server";
import { jobStore } from "@/lib/jobStore";
import { HIGGSFIELD_TASK_PREFIX, getHiggsfieldStatus, settleHiggsfield } from "@/lib/server/higgsfield";

// Higgsfield webhook (hf_webhook). Deliveries are unsigned, so the payload is only
// used to learn which request finished: the status is re-read from the
// authenticated API before the job is settled.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { request_id?: unknown; status?: unknown } | null;
  const requestId = typeof body?.request_id === "string" ? body.request_id : null;
  if (!requestId || !/^[0-9a-f-]{36}$/i.test(requestId) || typeof body?.status !== "string") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const taskId = `${HIGGSFIELD_TASK_PREFIX}${requestId}`;
  const existing = jobStore.get(taskId);
  if (existing && existing.status !== "pending") return NextResponse.json({ received: true });

  try {
    await settleHiggsfield(taskId, await getHiggsfieldStatus(requestId));
  } catch (err) {
    console.error("[higgsfield/callback] status check failed:", err instanceof Error ? err.message : err);
    // 5xx makes Higgsfield retry the delivery; the background poller also covers this job.
    return NextResponse.json({ error: "Status check failed" }, { status: 502 });
  }
  return NextResponse.json({ received: true });
}
