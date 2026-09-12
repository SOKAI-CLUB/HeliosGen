import { getToken } from "@/lib/galleryUtils";
import type { AdLibraryReview, ReviewMutation } from "@/lib/adLibraryReview";

export type AdLibraryMediaType = "image" | "video";

export interface AdLibraryFolder {
  id: string;
  name: string;
  parentId: string | null;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdLibraryTag {
  id: string;
  name: string;
  createdAt: string;
}

export interface AdLibraryAsset {
  id: string;
  folderId: string | null;
  sourceItemId: string | null;
  sourceType: "generation" | "upload" | "trimmed" | "library_upload";
  mediaType: AdLibraryMediaType;
  url: string;
  title: string | null;
  duration: number | null;
  trimStart: number | null;
  trimEnd: number | null;
  tagIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AdLibraryData {
  folders: AdLibraryFolder[];
  assets: AdLibraryAsset[];
  tags: AdLibraryTag[];
  permissions: {
    canDeleteAssets: boolean;
  };
}

export type AdLibraryMutation =
  | { action: "create-folder"; name: string; parentId?: string | null }
  | { action: "rename-folder"; folderId: string; name: string }
  | { action: "delete-folder"; folderId: string }
  | {
      action: "add-asset";
      folderId?: string | null;
      sourceItemId?: string | null;
      sourceType: AdLibraryAsset["sourceType"];
      mediaType: AdLibraryMediaType;
      url: string;
      title?: string | null;
      duration?: number | null;
      trimStart?: number | null;
      trimEnd?: number | null;
      tagIds?: string[];
    }
  | { action: "move-asset"; assetId: string; folderId: string | null }
  | { action: "rename-asset"; assetId: string; title: string | null }
  | { action: "delete-asset"; assetId: string }
  | { action: "create-tag"; name: string }
  | { action: "delete-tag"; tagId: string }
  | { action: "set-asset-tags"; assetId: string; tagIds: string[] };

async function authHeaders(): Promise<HeadersInit> {
  const token = await getToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "La bibliothèque publicitaire est indisponible.");
  }
  return payload;
}

export async function fetchAdLibrary(): Promise<AdLibraryData> {
  const response = await fetch("/api/ad-library", {
    headers: await authHeaders(),
    cache: "no-store",
  });
  return parseResponse<AdLibraryData>(response);
}

export async function mutateAdLibrary<T = AdLibraryData>(mutation: AdLibraryMutation): Promise<T> {
  const response = await fetch("/api/ad-library", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(mutation),
  });
  return parseResponse<T>(response);
}

export async function fetchAdLibraryReview(assetId: string, signal?: AbortSignal): Promise<AdLibraryReview> {
  return parseResponse<AdLibraryReview>(await fetch(`/api/ad-library/comments?assetId=${encodeURIComponent(assetId)}`, {
    headers: await authHeaders(), cache: "no-store", signal,
  }));
}

export async function mutateAdLibraryReview(assetId: string, mutation: ReviewMutation): Promise<void> {
  await parseResponse(await fetch("/api/ad-library/comments", {
    method: "POST", headers: await authHeaders(), body: JSON.stringify({ assetId, ...mutation }),
  }));
}
