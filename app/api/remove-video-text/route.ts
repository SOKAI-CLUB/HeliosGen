import { NextRequest, NextResponse } from "next/server";
import { resolveUserId } from "@/lib/guestMode";
import { TextRemovalError, validateVideoUrl } from "@/lib/videoTextRemoval";
import { listRemovalJobs, pollRemoval, startRemoval } from "@/lib/server/videoTextRemoval";

export const runtime = "nodejs";
export const maxDuration = 180;

function failure(error: unknown) {
  const known = error instanceof TextRemovalError;
  return NextResponse.json({ error: known ? error.message : "La suppression des sous-titres est momentanément indisponible. Réessaie dans un instant." }, { status: known ? error.status : 503 });
}

export async function POST(req: NextRequest) {
  try {
    const userId = await resolveUserId(req);
    if (!userId) return NextResponse.json({ error: "Connecte-toi pour supprimer les sous-titres." }, { status: 401 });
    const body = await req.json().catch(() => { throw new TextRemovalError("Requête invalide."); });
    if (!body || typeof body !== "object") throw new TextRemovalError("Requête invalide.");
    const sourceUrl = validateVideoUrl(body.videoUrl);
    const job = await startRemoval(body.id, userId, sourceUrl);
    return NextResponse.json(job, { status: 202 });
  } catch (error) { return failure(error); }
}

export async function GET(req: NextRequest) {
  try {
    const userId = await resolveUserId(req);
    if (!userId) return NextResponse.json({ error: "Connecte-toi pour accéder aux traitements." }, { status: 401 });
    if (req.nextUrl.searchParams.has("configuration")) {
      return NextResponse.json({ configured: !!process.env.REPLICATE_API_TOKEN?.trim() });
    }
    const id = req.nextUrl.searchParams.get("jobId");
    return NextResponse.json(id ? await pollRemoval(id, userId) : { jobs: await listRemovalJobs(userId) });
  } catch (error) { return failure(error); }
}
