import { NextRequest, NextResponse } from "next/server";
import { GUEST_MODE, resolveUserId } from "@/lib/guestMode";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSharedKieToken } from "@/lib/getKieToken";

function sharedTokenIsConfigured(): boolean {
  return !!getSharedKieToken();
}

export async function GET(req: NextRequest) {
  if (GUEST_MODE) {
    const { getKieApiTokenSource } = await import("@/lib/guest/db");
    const source = getKieApiTokenSource();
    return NextResponse.json({
      hasToken: source !== null,
      hasPersonalToken: source === "personal",
      hasSharedToken: sharedTokenIsConfigured(),
      source,
    });
  }

  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabaseAdmin
    .from("user_settings")
    .select("kie_api_token")
    .eq("user_id", userId)
    .maybeSingle();

  const hasPersonalToken = !!data?.kie_api_token?.trim();
  const hasSharedToken = sharedTokenIsConfigured();
  const source = hasPersonalToken ? "personal" : hasSharedToken ? "shared" : null;

  return NextResponse.json({
    hasToken: source !== null,
    hasPersonalToken,
    hasSharedToken,
    source,
  });
}

export async function POST(req: NextRequest) {
  if (GUEST_MODE) {
    const { kieApiToken } = await req.json();
    if (typeof kieApiToken !== "string" || !kieApiToken.trim()) {
      return NextResponse.json({ error: "kieApiToken is required" }, { status: 400 });
    }
    const { setKieApiToken } = await import("@/lib/guest/db");
    setKieApiToken(kieApiToken.trim());
    return NextResponse.json({ ok: true });
  }

  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { kieApiToken } = await req.json();
  if (typeof kieApiToken !== "string" || !kieApiToken.trim()) {
    return NextResponse.json({ error: "kieApiToken is required" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("user_settings")
    .upsert({ user_id: userId, kie_api_token: kieApiToken.trim() }, { onConflict: "user_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, source: "personal" });
}

export async function DELETE(req: NextRequest) {
  if (GUEST_MODE) {
    const { deleteKieApiToken, getKieApiTokenSource } = await import("@/lib/guest/db");
    deleteKieApiToken();
    const source = getKieApiTokenSource();
    return NextResponse.json({
      ok: true,
      hasToken: source !== null,
      hasSharedToken: sharedTokenIsConfigured(),
      source,
    });
  }

  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabaseAdmin
    .from("user_settings")
    .update({ kie_api_token: null })
    .eq("user_id", userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const hasSharedToken = sharedTokenIsConfigured();
  return NextResponse.json({
    ok: true,
    hasToken: hasSharedToken,
    hasSharedToken,
    source: hasSharedToken ? "shared" : null,
  });
}
