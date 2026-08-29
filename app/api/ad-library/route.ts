import { NextRequest, NextResponse } from "next/server";

import type { AdLibraryMutation } from "@/lib/adLibrary";
import * as guestDb from "@/lib/guest/db";
import { GUEST_MODE, resolveUserId } from "@/lib/guestMode";
import { supabaseAdmin } from "@/lib/supabase/admin";

const MAX_FOLDER_NAME = 80;
const MAX_TAG_NAME = 40;
const MAX_TITLE = 160;

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanNullableText(value: unknown, maxLength: number): string | null {
  const text = cleanText(value, maxLength);
  return text || null;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function folderBelongsToUser(folderId: string | null, userId: string): Promise<boolean> {
  if (!folderId) return true;
  if (GUEST_MODE) return guestDb.getAdLibraryFolders(userId).some((folder) => folder.id === folderId);
  const { data } = await supabaseAdmin
    .from("ad_library_folders")
    .select("id")
    .eq("id", folderId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

async function loadLibrary(userId: string) {
  if (GUEST_MODE) {
    const folders = guestDb.getAdLibraryFolders(userId);
    const assets = guestDb.getAdLibraryAssets(userId);
    const tags = guestDb.getAdLibraryTags(userId);
    const assetTags = guestDb.getAdLibraryAssetTags(userId);
    return {
      folders: folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        parentId: folder.parent_id,
        orderIndex: folder.order_index,
        createdAt: folder.created_at,
        updatedAt: folder.updated_at,
      })),
      assets: assets.map((asset) => ({
        id: asset.id,
        folderId: asset.folder_id,
        sourceItemId: asset.source_item_id,
        sourceType: asset.source_type,
        mediaType: asset.media_type,
        url: asset.url,
        title: asset.title,
        duration: asset.duration,
        trimStart: asset.trim_start,
        trimEnd: asset.trim_end,
        tagIds: assetTags.filter((entry) => entry.asset_id === asset.id).map((entry) => entry.tag_id),
        createdAt: asset.created_at,
        updatedAt: asset.updated_at,
      })),
      tags: tags.map((tag) => ({ id: tag.id, name: tag.name, createdAt: tag.created_at })),
    };
  }

  const [foldersResult, assetsResult, tagsResult, assetTagsResult] = await Promise.all([
    supabaseAdmin
      .from("ad_library_folders")
      .select("id, name, parent_id, order_index, created_at, updated_at")
      .eq("user_id", userId)
      .order("order_index", { ascending: true }),
    supabaseAdmin
      .from("ad_library_assets")
      .select("id, folder_id, source_item_id, source_type, media_type, url, title, duration, trim_start, trim_end, created_at, updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("ad_library_tags")
      .select("id, name, created_at")
      .eq("user_id", userId)
      .order("name", { ascending: true }),
    supabaseAdmin
      .from("ad_library_asset_tags")
      .select("asset_id, tag_id")
      .eq("user_id", userId),
  ]);

  const error = foldersResult.error ?? assetsResult.error ?? tagsResult.error ?? assetTagsResult.error;
  if (error) throw error;

  const assetTags = assetTagsResult.data ?? [];
  return {
    folders: (foldersResult.data ?? []).map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parent_id,
      orderIndex: folder.order_index,
      createdAt: folder.created_at,
      updatedAt: folder.updated_at,
    })),
    assets: (assetsResult.data ?? []).map((asset) => ({
      id: asset.id,
      folderId: asset.folder_id,
      sourceItemId: asset.source_item_id,
      sourceType: asset.source_type,
      mediaType: asset.media_type,
      url: asset.url,
      title: asset.title,
      duration: asset.duration === null ? null : Number(asset.duration),
      trimStart: asset.trim_start === null ? null : Number(asset.trim_start),
      trimEnd: asset.trim_end === null ? null : Number(asset.trim_end),
      tagIds: assetTags.filter((entry) => entry.asset_id === asset.id).map((entry) => entry.tag_id),
      createdAt: asset.created_at,
      updatedAt: asset.updated_at,
    })),
    tags: (tagsResult.data ?? []).map((tag) => ({
      id: tag.id,
      name: tag.name,
      createdAt: tag.created_at,
    })),
  };
}

async function ensureAsset(userId: string, assetId: string): Promise<boolean> {
  if (GUEST_MODE) return guestDb.getAdLibraryAssets(userId).some((asset) => asset.id === assetId);
  const { data } = await supabaseAdmin
    .from("ad_library_assets")
    .select("id")
    .eq("id", assetId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

async function validTagIds(userId: string, tagIds: string[]): Promise<string[]> {
  const uniqueIds = [...new Set(tagIds.filter((id): id is string => typeof id === "string"))];
  if (uniqueIds.length === 0) return [];
  if (GUEST_MODE) {
    const owned = new Set(guestDb.getAdLibraryTags(userId).map((tag) => tag.id));
    return uniqueIds.filter((id) => owned.has(id));
  }
  const { data, error } = await supabaseAdmin
    .from("ad_library_tags")
    .select("id")
    .eq("user_id", userId)
    .in("id", uniqueIds);
  if (error) throw error;
  return (data ?? []).map((tag) => tag.id);
}

async function replaceAssetTags(userId: string, assetId: string, tagIds: string[]) {
  const ownedTagIds = await validTagIds(userId, tagIds);
  if (GUEST_MODE) {
    guestDb.setAdLibraryAssetTags(assetId, ownedTagIds, userId);
    return;
  }
  const { error: deleteError } = await supabaseAdmin
    .from("ad_library_asset_tags")
    .delete()
    .eq("asset_id", assetId)
    .eq("user_id", userId);
  if (deleteError) throw deleteError;
  if (ownedTagIds.length === 0) return;
  const { error: insertError } = await supabaseAdmin.from("ad_library_asset_tags").insert(
    ownedTagIds.map((tagId) => ({ asset_id: assetId, tag_id: tagId, user_id: userId })),
  );
  if (insertError) throw insertError;
}

export async function GET(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await loadLibrary(userId));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ad-library] GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json() as AdLibraryMutation;

    if (body.action === "create-folder") {
      const name = cleanText(body.name, MAX_FOLDER_NAME);
      const parentId = body.parentId ?? null;
      if (!name) return NextResponse.json({ error: "Le nom du dossier est requis." }, { status: 400 });
      if (!(await folderBelongsToUser(parentId, userId))) {
        return NextResponse.json({ error: "Dossier parent introuvable." }, { status: 404 });
      }
      if (GUEST_MODE) {
        guestDb.insertAdLibraryFolder({
          user_id: userId,
          name,
          parent_id: parentId,
          order_index: guestDb.getAdLibraryFolders(userId).length,
        });
      } else {
        const { count } = await supabaseAdmin
          .from("ad_library_folders")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId);
        const { error } = await supabaseAdmin.from("ad_library_folders").insert({
          user_id: userId,
          name,
          parent_id: parentId,
          order_index: count ?? 0,
        });
        if (error) throw error;
      }
    } else if (body.action === "rename-folder") {
      const name = cleanText(body.name, MAX_FOLDER_NAME);
      if (!name) return NextResponse.json({ error: "Le nom du dossier est requis." }, { status: 400 });
      if (GUEST_MODE) guestDb.renameAdLibraryFolder(body.folderId, userId, name);
      else {
        const { error } = await supabaseAdmin
          .from("ad_library_folders")
          .update({ name })
          .eq("id", body.folderId)
          .eq("user_id", userId);
        if (error) throw error;
      }
    } else if (body.action === "delete-folder") {
      if (GUEST_MODE) guestDb.deleteAdLibraryFolder(body.folderId, userId);
      else {
        const { error } = await supabaseAdmin
          .from("ad_library_folders")
          .delete()
          .eq("id", body.folderId)
          .eq("user_id", userId);
        if (error) throw error;
      }
    } else if (body.action === "add-asset") {
      const folderId = body.folderId ?? null;
      const allowedSourceTypes = new Set(["generation", "upload", "trimmed", "library_upload"]);
      if (!isHttpUrl(body.url) || body.url.length > 4096) {
        return NextResponse.json({ error: "URL média invalide." }, { status: 400 });
      }
      if (body.mediaType !== "image" && body.mediaType !== "video") {
        return NextResponse.json({ error: "Type de média invalide." }, { status: 400 });
      }
      if (!allowedSourceTypes.has(body.sourceType)) {
        return NextResponse.json({ error: "Source invalide." }, { status: 400 });
      }
      if (!(await folderBelongsToUser(folderId, userId))) {
        return NextResponse.json({ error: "Dossier introuvable." }, { status: 404 });
      }
      const assetData = {
        user_id: userId,
        folder_id: folderId,
        source_item_id: cleanNullableText(body.sourceItemId, 200),
        source_type: body.sourceType,
        media_type: body.mediaType,
        url: body.url,
        title: cleanNullableText(body.title, MAX_TITLE),
        duration: Number.isFinite(body.duration) ? body.duration ?? null : null,
        trim_start: Number.isFinite(body.trimStart) ? body.trimStart ?? null : null,
        trim_end: Number.isFinite(body.trimEnd) ? body.trimEnd ?? null : null,
      };
      let assetId: string;
      if (GUEST_MODE) {
        assetId = guestDb.insertAdLibraryAsset(assetData).id;
      } else {
        const { data, error } = await supabaseAdmin
          .from("ad_library_assets")
          .insert(assetData)
          .select("id")
          .single();
        if (error) throw error;
        assetId = data.id;
      }
      await replaceAssetTags(userId, assetId, body.tagIds ?? []);
    } else if (body.action === "move-asset") {
      if (!(await folderBelongsToUser(body.folderId, userId))) {
        return NextResponse.json({ error: "Dossier introuvable." }, { status: 404 });
      }
      if (GUEST_MODE) guestDb.updateAdLibraryAsset(body.assetId, userId, { folder_id: body.folderId });
      else {
        const { error } = await supabaseAdmin
          .from("ad_library_assets")
          .update({ folder_id: body.folderId })
          .eq("id", body.assetId)
          .eq("user_id", userId);
        if (error) throw error;
      }
    } else if (body.action === "rename-asset") {
      const title = cleanNullableText(body.title, MAX_TITLE);
      if (GUEST_MODE) guestDb.updateAdLibraryAsset(body.assetId, userId, { title });
      else {
        const { error } = await supabaseAdmin
          .from("ad_library_assets")
          .update({ title })
          .eq("id", body.assetId)
          .eq("user_id", userId);
        if (error) throw error;
      }
    } else if (body.action === "delete-asset") {
      if (GUEST_MODE) guestDb.deleteAdLibraryAsset(body.assetId, userId);
      else {
        const { error } = await supabaseAdmin
          .from("ad_library_assets")
          .delete()
          .eq("id", body.assetId)
          .eq("user_id", userId);
        if (error) throw error;
      }
    } else if (body.action === "create-tag") {
      const name = cleanText(body.name, MAX_TAG_NAME);
      if (!name) return NextResponse.json({ error: "Le nom du tag est requis." }, { status: 400 });
      if (GUEST_MODE) guestDb.insertAdLibraryTag(userId, name);
      else {
        const { data: existing } = await supabaseAdmin
          .from("ad_library_tags")
          .select("id")
          .eq("user_id", userId)
          .ilike("name", name)
          .maybeSingle();
        if (!existing) {
          const { error } = await supabaseAdmin.from("ad_library_tags").insert({ user_id: userId, name });
          if (error) throw error;
        }
      }
    } else if (body.action === "delete-tag") {
      if (GUEST_MODE) guestDb.deleteAdLibraryTag(body.tagId, userId);
      else {
        const { error } = await supabaseAdmin
          .from("ad_library_tags")
          .delete()
          .eq("id", body.tagId)
          .eq("user_id", userId);
        if (error) throw error;
      }
    } else if (body.action === "set-asset-tags") {
      if (!(await ensureAsset(userId, body.assetId))) {
        return NextResponse.json({ error: "Média introuvable." }, { status: 404 });
      }
      await replaceAssetTags(userId, body.assetId, body.tagIds);
    } else {
      return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
    }

    return NextResponse.json(await loadLibrary(userId));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ad-library] POST error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
