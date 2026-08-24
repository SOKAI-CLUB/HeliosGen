import { NextRequest, NextResponse } from "next/server";
import { getKieToken } from "@/lib/getKieToken";

export async function GET(req: NextRequest) {
  const apiKey = await getKieToken(req);
  if (!apiKey) return NextResponse.json({ error: "No Kie.ai API key is configured. Add a personal key in Settings or configure the shared server key." }, { status: 503 });

  const res = await fetch("https://api.kie.ai/api/v1/chat/credit", {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 60 },
  });

  if (!res.ok) return NextResponse.json({ error: "Failed to fetch credit" }, { status: res.status });

  const data = await res.json();
  return NextResponse.json(data);
}
