import { NextRequest, NextResponse } from "next/server";
import { getKieToken } from "@/lib/getKieToken";

export async function GET(req: NextRequest) {
  const apiKey = await getKieToken(req);
  if (!apiKey) return NextResponse.json({ error: "The shared Kie.ai API key is not configured on the server." }, { status: 503 });

  const res = await fetch("https://api.kie.ai/api/v1/chat/credit", {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 60 },
  });

  if (!res.ok) return NextResponse.json({ error: "Failed to fetch credit" }, { status: res.status });

  const data = await res.json();
  return NextResponse.json(data);
}
