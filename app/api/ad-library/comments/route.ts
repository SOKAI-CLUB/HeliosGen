import { NextRequest, NextResponse } from "next/server";
import { MAX_COMMENT_LENGTH, validTimecode, type AdLibraryComment } from "@/lib/adLibraryReview";
import * as guestDb from "@/lib/guest/db";
import { GUEST_MODE, resolveUser } from "@/lib/guestMode";
import { supabaseAdmin } from "@/lib/supabase/admin";

const uuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

async function getAsset(assetId: string, userId: string) {
  if (GUEST_MODE) return guestDb.getAdLibraryAssets(userId).find((asset) => asset.id === assetId);
  const { data, error } = await supabaseAdmin.from("ad_library_assets")
    .select("id, media_type, duration").eq("id", assetId).maybeSingle();
  if (error) throw error;
  return data;
}

async function getComments(assetId: string): Promise<AdLibraryComment[]> {
  if (GUEST_MODE) return guestDb.getAdLibraryComments(assetId);
  const comments: AdLibraryComment[] = [];
  // Supabase caps each response. Page so old replies never silently disappear.
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabaseAdmin.from("ad_library_comments")
      .select("id, asset_id, parent_id, user_id, author_name, body, timecode, resolved, created_at, updated_at")
      .eq("asset_id", assetId).order("created_at").order("id").range(offset, offset + 499);
    if (error) throw error;
    for (const row of data ?? []) comments.push({
      id: row.id, assetId: row.asset_id, parentId: row.parent_id,
      authorId: row.user_id, authorName: row.author_name, body: row.body,
      timecode: row.timecode === null ? null : Number(row.timecode), resolved: row.resolved,
      createdAt: row.created_at, updatedAt: row.updated_at,
    });
    if (!data || data.length < 500) break;
  }
  return comments;
}

function serverError(error: unknown) {
  console.error("[ad-library/comments]", error);
  return fail("Les commentaires sont indisponibles. Réessayez dans un instant.", 500);
}

export async function GET(req: NextRequest) {
  const user = await resolveUser(req);
  if (!user) return fail("Connectez-vous pour consulter les commentaires.", 401);
  const assetId = req.nextUrl.searchParams.get("assetId");
  if (!uuid(assetId)) return fail("Média invalide.", 400);
  try {
    if (!await getAsset(assetId, user.id)) return fail("Média introuvable.", 404);
    return NextResponse.json({ comments: await getComments(assetId), currentUserId: user.id }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) { return serverError(error); }
}

export async function POST(req: NextRequest) {
  const user = await resolveUser(req);
  if (!user) return fail("Connectez-vous pour participer à la discussion.", 401);
  let body: Record<string, unknown>;
  try {
    const payload: unknown = await req.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fail("Requête invalide.", 400);
    body = payload as Record<string, unknown>;
  } catch { return fail("Requête invalide.", 400); }
  const { assetId } = body;
  if (!uuid(assetId)) return fail("Média invalide.", 400);
  try {
    const asset = await getAsset(assetId, user.id);
    if (!asset) return fail("Média introuvable.", 404);

    if (body.action === "create") {
      const text = typeof body.body === "string" ? body.body.trim() : "";
      if (!text || text.length > MAX_COMMENT_LENGTH) return fail(`Le commentaire doit contenir entre 1 et ${MAX_COMMENT_LENGTH} caractères.`, 400);
      const timecode = body.timecode ?? null;
      const parentId = body.parentId ?? null;
      if (!validTimecode(timecode, asset.duration === null ? null : Number(asset.duration))
        || (asset.media_type !== "video" && timecode !== null)) return fail("Timecode invalide pour ce média.", 400);
      if (parentId !== null) {
        if (!uuid(parentId) || timecode !== null) return fail("Réponse invalide.", 400);
        const parent = (await getComments(assetId)).find((comment) => comment.id === parentId);
        if (!parent || parent.parentId !== null) return fail("Discussion introuvable.", 404);
      }
      // Never accept identity or resolution state from the request body.
      const authorName = (user.email?.split("@")[0] || "Invité").slice(0, 80);
      if (GUEST_MODE) guestDb.insertAdLibraryComment({
        assetId, parentId, authorId: user.id, authorName, body: text, timecode, resolved: false,
      });
      else {
        const { error } = await supabaseAdmin.from("ad_library_comments").insert({
          asset_id: assetId, parent_id: parentId, user_id: user.id,
          author_name: authorName, body: text, timecode, resolved: false,
        });
        if (error) throw error;
      }
      return NextResponse.json({ ok: true }, { status: 201 });
    }

    if (body.action !== "resolve" && body.action !== "delete") return fail("Action inconnue.", 400);
    if (!uuid(body.commentId)) return fail("Commentaire invalide.", 400);
    const comment = (await getComments(assetId)).find((entry) => entry.id === body.commentId);
    if (!comment) return fail("Commentaire introuvable.", 404);
    if (body.action === "delete") {
      if (comment.authorId !== user.id) return fail("Vous pouvez supprimer uniquement vos propres commentaires.", 403);
      if (GUEST_MODE) guestDb.deleteAdLibraryComment(comment.id, assetId, user.id);
      else {
        const { error } = await supabaseAdmin.from("ad_library_comments").delete()
          .eq("id", comment.id).eq("asset_id", assetId).eq("user_id", user.id);
        if (error) throw error;
      }
    } else {
      if (comment.parentId !== null || typeof body.resolved !== "boolean") return fail("Seule une discussion peut être résolue.", 400);
      if (GUEST_MODE) guestDb.resolveAdLibraryComment(comment.id, assetId, body.resolved);
      else {
        const { error } = await supabaseAdmin.from("ad_library_comments").update({ resolved: body.resolved })
          .eq("id", comment.id).eq("asset_id", assetId).is("parent_id", null);
        if (error) throw error;
      }
    }
    return NextResponse.json({ ok: true });
  } catch (error) { return serverError(error); }
}
