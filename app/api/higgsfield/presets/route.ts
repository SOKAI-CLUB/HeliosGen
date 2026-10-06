import { NextRequest, NextResponse } from "next/server";
import { resolveUserId } from "@/lib/guestMode";
import { HiggsfieldError, getRestylePresets } from "@/lib/server/higgsfield";

/** Genjutsu Restyle style presets, proxied so the Higgsfield key stays server-side. */
export async function GET(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const items = await getRestylePresets();
    return NextResponse.json({ items: items.map(({ id, name, preview_url }) => ({ id, name, preview_url })) });
  } catch (err) {
    const status = err instanceof HiggsfieldError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Presets unavailable", items: [] }, { status });
  }
}
