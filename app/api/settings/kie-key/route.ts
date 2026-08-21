import { NextRequest, NextResponse } from "next/server";
import { GUEST_MODE, resolveUserId } from "@/lib/guestMode";

export async function GET(req: NextRequest) {
  if (GUEST_MODE) {
    const { getKieApiToken } = await import("@/lib/guest/db");
    return NextResponse.json({ hasToken: !!getKieApiToken() });
  }

  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({
    hasToken: !!process.env.KIE_API_KEY?.trim(),
    managedByAdmin: true,
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
  return NextResponse.json(
    { error: "The shared Kie.ai API key is managed by the administrator." },
    { status: 403 }
  );
}

export async function DELETE(req: NextRequest) {
  if (GUEST_MODE) {
    const { deleteKieApiToken } = await import("@/lib/guest/db");
    deleteKieApiToken();
    return NextResponse.json({ ok: true });
  }

  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(
    { error: "The shared Kie.ai API key is managed by the administrator." },
    { status: 403 }
  );
}
