import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID, createHash } from "crypto";

const DATA_DIR = join(process.cwd(), "data");
const DB_FILE = join(DATA_DIR, "guest-db.json");

interface Generation {
  id: string;
  user_id: string | null;
  task_id: string;
  generation_type: string;
  status: string;
  prompt?: string;
  model?: string;
  aspect_ratio?: string;
  quality?: string;
  azure_resolution?: string;
  duration?: number;
  kling_mode?: string;
  sound?: boolean;
  reference_image_urls?: string[];
  image_url?: string;
  image_urls?: string[];
  video_url?: string;
  error_msg?: string;
  created_at: string;
  updated_at: string;
}

interface Upload {
  id: string;
  user_id: string;
  r2_url: string;
  mime_type?: string | null;
  source: string;
  created_at: string;
}

interface FolderRecord {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
  color?: string | null;
}

interface FolderItemRecord {
  folder_id: string;
  item_id: string;
  user_id: string;
  created_at: string;
}

export interface AdLibraryFolderRecord {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface AdLibraryAssetRecord {
  id: string;
  user_id: string;
  folder_id: string | null;
  source_item_id: string | null;
  source_type: "generation" | "upload" | "trimmed" | "library_upload";
  media_type: "image" | "video";
  url: string;
  title: string | null;
  duration: number | null;
  trim_start: number | null;
  trim_end: number | null;
  created_at: string;
  updated_at: string;
}

export interface AdLibraryTagRecord {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

interface AdLibraryAssetTagRecord {
  asset_id: string;
  tag_id: string;
  user_id: string;
  created_at: string;
}

interface GuestDb {
  generations: Generation[];
  uploads: Upload[];
  assetCache: Record<string, { cdn_url: string; mime_type: string; byte_size: number }>;
  settings?: { kie_api_token?: string; azure_api_key?: string };
  folders: FolderRecord[];
  folder_items: FolderItemRecord[];
  ad_library_folders: AdLibraryFolderRecord[];
  ad_library_assets: AdLibraryAssetRecord[];
  ad_library_tags: AdLibraryTagRecord[];
  ad_library_asset_tags: AdLibraryAssetTagRecord[];
}

function now(): string {
  return new Date().toISOString();
}

function read(): GuestDb {
  const defaults: GuestDb = {
    generations: [],
    uploads: [],
    assetCache: {},
    folders: [],
    folder_items: [],
    ad_library_folders: [],
    ad_library_assets: [],
    ad_library_tags: [],
    ad_library_asset_tags: [],
  };
  if (!existsSync(DB_FILE)) return defaults;
  try {
    const parsed = JSON.parse(readFileSync(DB_FILE, "utf8")) as Partial<GuestDb>;
    return { ...defaults, ...parsed };
  }
  catch { return defaults; }
}

function write(data: GuestDb): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
}

export function hashBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// ── Generations ────────────────────────────────────────────────────────────

export function insertGeneration(data: Omit<Generation, "id" | "created_at" | "updated_at"> & { id?: string }): void {
  const db = read();
  if (db.generations.some((g) => g.task_id === data.task_id)) return;
  db.generations.push({ ...data, id: data.id ?? randomUUID(), created_at: now(), updated_at: now() });
  write(db);
}

export function updateGeneration(
  taskId: string,
  updates: Partial<Pick<Generation, "status" | "image_url" | "image_urls" | "video_url" | "error_msg">>,
): void {
  const db = read();
  const gen = db.generations.find((g) => g.task_id === taskId);
  if (!gen) return;
  Object.assign(gen, updates, { updated_at: now() });
  write(db);
}

export function recoverJob(
  taskId: string,
): Pick<Generation, "status" | "video_url" | "image_url" | "image_urls" | "error_msg"> | null {
  return read().generations.find((g) => g.task_id === taskId) ?? null;
}

export function getTextRemovalJob(id: string, userId?: string): Generation | null {
  return read().generations.find((g) => g.id === id && g.model === "hjunior29/video-text-remover" && (!userId || g.user_id === userId)) ?? null;
}

export function getPendingTextRemovalJobs(userId: string): Generation[] {
  return read().generations.filter((g) => g.user_id === userId && g.model === "hjunior29/video-text-remover" && g.status === "pending").slice(-20);
}

export function updateTextRemovalJob(id: string, updates: Partial<Pick<Generation, "status" | "task_id" | "video_url" | "error_msg">>): void {
  const db = read();
  const generation = db.generations.find((g) => g.id === id && g.model === "hjunior29/video-text-remover");
  if (!generation) throw new Error("Text removal job not found");
  Object.assign(generation, updates, { updated_at: now() });
  write(db);
}

export function getGenerations(userId: string, type: "image" | "video"): Generation[] {
  const urlKey = type === "video" ? "video_url" : "image_url";
  return read()
    .generations
    .filter((g) => g.user_id === userId && g.generation_type === type && g.status === "done" && g[urlKey])
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 1000);
}

export function deleteGeneration(id: string, userId: string): void {
  const db = read();
  db.generations = db.generations.filter((g) => !(g.id === id && g.user_id === userId));
  write(db);
}

// ── Uploads ────────────────────────────────────────────────────────────────

export function insertUpload(data: Omit<Upload, "id" | "created_at">): void {
  const db = read();
  db.uploads.push({ ...data, id: randomUUID(), created_at: now() });
  write(db);
}

export function getUploads(userId: string, mimeTypePrefix: string): Upload[] {
  return read()
    .uploads
    .filter((u) => u.user_id === userId && (u.mime_type ?? "").startsWith(mimeTypePrefix))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 1000);
}

export function deleteUpload(id: string, userId: string): void {
  const db = read();
  db.uploads = db.uploads.filter((u) => !(u.id === id && u.user_id === userId));
  write(db);
}

// ── Asset Cache ────────────────────────────────────────────────────────────

export function lookupAssetHash(hash: string): string | null {
  const entry = read().assetCache[hash];
  if (entry) console.log("[guest/asset-cache] HIT:", hash.slice(0, 8));
  return entry?.cdn_url ?? null;
}

export function storeAssetHash(hash: string, cdnUrl: string, mimeType: string, byteSize: number): void {
  const db = read();
  db.assetCache[hash] = { cdn_url: cdnUrl, mime_type: mimeType, byte_size: byteSize };
  write(db);
}

// ── Settings ───────────────────────────────────────────────────────────────

export function getKieApiToken(): string | null {
  const dbToken = read().settings?.kie_api_token;
  if (dbToken) return dbToken;
  const envToken = process.env.KIE_API_KEY ?? "";
  // Reject the template placeholder that ships in .env.guest
  if (!envToken || envToken === "your_kie_api_key_here") return null;
  return envToken;
}

export function getKieApiTokenSource(): "personal" | "shared" | null {
  if (read().settings?.kie_api_token) return "personal";
  const envToken = process.env.KIE_API_KEY?.trim() ?? "";
  return envToken && envToken !== "your_kie_api_key_here" ? "shared" : null;
}

export function setKieApiToken(token: string): void {
  const db = read();
  db.settings = { ...db.settings, kie_api_token: token };
  write(db);
}

export function deleteKieApiToken(): void {
  const db = read();
  if (db.settings) delete db.settings.kie_api_token;
  write(db);
}

export function getAzureApiKey(): string | null {
  const dbKey = read().settings?.azure_api_key;
  if (dbKey) return dbKey;
  const envKey = process.env.AZURE_API_KEY ?? "";
  return envKey || null;
}

export function setAzureApiKey(key: string): void {
  const db = read();
  db.settings = { ...db.settings, azure_api_key: key };
  write(db);
}

export function deleteAzureApiKey(): void {
  const db = read();
  if (db.settings) delete db.settings.azure_api_key;
  write(db);
}

// ── Folders ────────────────────────────────────────────────────────────────

export function getFolders(userId: string): FolderRecord[] {
  return read()
    .folders
    .filter((f) => f.user_id === userId)
    .sort((a, b) => a.order_index - b.order_index);
}

export function insertFolder(data: Omit<FolderRecord, "created_at" | "updated_at">): FolderRecord {
  const db = read();
  const record: FolderRecord = { ...data, created_at: now(), updated_at: now() };
  db.folders.push(record);
  write(db);
  return record;
}

export function updateFolder(
  id: string,
  userId: string,
  updates: Partial<Pick<FolderRecord, "name" | "parent_id" | "order_index" | "color">>,
): void {
  const db = read();
  const folder = db.folders.find((f) => f.id === id && f.user_id === userId);
  if (!folder) return;
  Object.assign(folder, updates, { updated_at: now() });
  write(db);
}

export function deleteFolder(id: string, userId: string): void {
  const db = read();
  db.folders = db.folders.filter((f) => !(f.id === id && f.user_id === userId));
  db.folder_items = db.folder_items.filter((fi) => fi.folder_id !== id);
  write(db);
}

// ── Folder Items ───────────────────────────────────────────────────────────

export function getFolderItems(userId: string): FolderItemRecord[] {
  return read().folder_items.filter((fi) => fi.user_id === userId);
}

export function insertFolderItems(folderId: string, itemIds: string[], userId: string): void {
  const db = read();
  for (const itemId of itemIds) {
    const exists = db.folder_items.some(
      (fi) => fi.folder_id === folderId && fi.item_id === itemId,
    );
    if (!exists) {
      db.folder_items.push({ folder_id: folderId, item_id: itemId, user_id: userId, created_at: now() });
    }
  }
  write(db);
}

export function deleteFolderItems(folderId: string, itemIds: string[], userId: string): void {
  const db = read();
  db.folder_items = db.folder_items.filter(
    (fi) => !(fi.folder_id === folderId && itemIds.includes(fi.item_id) && fi.user_id === userId),
  );
  write(db);
}

// ── Ad library ────────────────────────────────────────────────────────────

export function getAdLibraryFolders(userId: string): AdLibraryFolderRecord[] {
  return read().ad_library_folders
    .filter((folder) => folder.user_id === userId)
    .sort((a, b) => a.order_index - b.order_index);
}

export function insertAdLibraryFolder(
  data: Omit<AdLibraryFolderRecord, "id" | "created_at" | "updated_at">,
): AdLibraryFolderRecord {
  const db = read();
  const folder: AdLibraryFolderRecord = {
    ...data,
    id: randomUUID(),
    created_at: now(),
    updated_at: now(),
  };
  db.ad_library_folders.push(folder);
  write(db);
  return folder;
}

export function renameAdLibraryFolder(id: string, userId: string, name: string): void {
  const db = read();
  const folder = db.ad_library_folders.find((entry) => entry.id === id && entry.user_id === userId);
  if (!folder) return;
  folder.name = name;
  folder.updated_at = now();
  write(db);
}

export function deleteAdLibraryFolder(id: string, userId: string): void {
  const db = read();
  db.ad_library_folders = db.ad_library_folders.filter(
    (folder) => !(folder.id === id && folder.user_id === userId),
  );
  db.ad_library_folders.forEach((folder) => {
    if (folder.user_id === userId && folder.parent_id === id) folder.parent_id = null;
  });
  db.ad_library_assets.forEach((asset) => {
    if (asset.user_id === userId && asset.folder_id === id) {
      asset.folder_id = null;
      asset.updated_at = now();
    }
  });
  write(db);
}

export function getAdLibraryAssets(userId: string): AdLibraryAssetRecord[] {
  return read().ad_library_assets
    .filter((asset) => asset.user_id === userId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function getAdLibraryAssetTags(userId: string): AdLibraryAssetTagRecord[] {
  return read().ad_library_asset_tags.filter((entry) => entry.user_id === userId);
}

export function insertAdLibraryAsset(
  data: Omit<AdLibraryAssetRecord, "id" | "created_at" | "updated_at">,
): AdLibraryAssetRecord {
  const db = read();
  const asset: AdLibraryAssetRecord = {
    ...data,
    id: randomUUID(),
    created_at: now(),
    updated_at: now(),
  };
  db.ad_library_assets.push(asset);
  write(db);
  return asset;
}

export function updateAdLibraryAsset(
  id: string,
  userId: string,
  updates: Partial<Pick<AdLibraryAssetRecord, "folder_id" | "title">>,
): void {
  const db = read();
  const asset = db.ad_library_assets.find((entry) => entry.id === id && entry.user_id === userId);
  if (!asset) return;
  Object.assign(asset, updates, { updated_at: now() });
  write(db);
}

export function deleteAdLibraryAsset(id: string, userId: string): void {
  const db = read();
  db.ad_library_assets = db.ad_library_assets.filter(
    (asset) => !(asset.id === id && asset.user_id === userId),
  );
  db.ad_library_asset_tags = db.ad_library_asset_tags.filter(
    (entry) => !(entry.asset_id === id && entry.user_id === userId),
  );
  write(db);
}

export function getAdLibraryTags(userId: string): AdLibraryTagRecord[] {
  return read().ad_library_tags
    .filter((tag) => tag.user_id === userId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function insertAdLibraryTag(userId: string, name: string): AdLibraryTagRecord {
  const db = read();
  const existing = db.ad_library_tags.find(
    (tag) => tag.user_id === userId && tag.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
  );
  if (existing) return existing;
  const tag: AdLibraryTagRecord = {
    id: randomUUID(),
    user_id: userId,
    name,
    created_at: now(),
  };
  db.ad_library_tags.push(tag);
  write(db);
  return tag;
}

export function deleteAdLibraryTag(id: string, userId: string): void {
  const db = read();
  db.ad_library_tags = db.ad_library_tags.filter(
    (tag) => !(tag.id === id && tag.user_id === userId),
  );
  db.ad_library_asset_tags = db.ad_library_asset_tags.filter(
    (entry) => !(entry.tag_id === id && entry.user_id === userId),
  );
  write(db);
}

export function setAdLibraryAssetTags(assetId: string, tagIds: string[], userId: string): void {
  const db = read();
  const assetExists = db.ad_library_assets.some(
    (asset) => asset.id === assetId && asset.user_id === userId,
  );
  if (!assetExists) return;
  const validTagIds = new Set(
    db.ad_library_tags
      .filter((tag) => tag.user_id === userId && tagIds.includes(tag.id))
      .map((tag) => tag.id),
  );
  db.ad_library_asset_tags = db.ad_library_asset_tags.filter(
    (entry) => !(entry.asset_id === assetId && entry.user_id === userId),
  );
  for (const tagId of validTagIds) {
    db.ad_library_asset_tags.push({ asset_id: assetId, tag_id: tagId, user_id: userId, created_at: now() });
  }
  write(db);
}
