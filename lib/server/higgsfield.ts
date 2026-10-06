import "server-only";
import { jobStore, type JobResult } from "@/lib/jobStore";
import { jobEvents } from "@/lib/jobEvents";
import { mirrorToR2 } from "@/lib/r2";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { GUEST_MODE } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";

// Higgsfield API — https://docs.higgsfield.ai
// Auth: `Authorization: Key {key_id}:{key_secret}`. Generation is asynchronous:
// submit → request_id → poll /requests/{id}/status or receive the hf_webhook POST.

export const HIGGSFIELD_BASE = "https://api.higgsfield.ai";
/** Task IDs are prefixed so status/recovery code can tell Higgsfield jobs apart from kie.ai ones. */
export const HIGGSFIELD_TASK_PREFIX = "hf-";

const POLL_INTERVAL_MS = 6_000;
const POLL_TIMEOUT_MS = 30 * 60 * 1000;
const TERMINAL = new Set(["completed", "failed", "nsfw", "canceled"]);

export const isHiggsfieldTaskId = (taskId: string) => /^hf-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId);

export class HiggsfieldError extends Error {
  constructor(message: string, public status = 500) { super(message); }
}

interface HiggsfieldStatus {
  status: string;
  request_id: string;
  error?: string | null;
  video?: { url: string };
  images?: { url: string }[];
}

/**
 * Accepts either HIGGSFIELD_API_KEY="key_id:key_secret" or the pair
 * HIGGSFIELD_API_KEY_ID + HIGGSFIELD_API_KEY_SECRET.
 */
export function higgsfieldAuthHeader(): string | null {
  const combined = process.env.HIGGSFIELD_API_KEY?.trim();
  if (combined) return `Key ${combined.replace(/^Key\s+/i, "")}`;
  const id = process.env.HIGGSFIELD_API_KEY_ID?.trim();
  const secret = process.env.HIGGSFIELD_API_KEY_SECRET?.trim();
  return id && secret ? `Key ${id}:${secret}` : null;
}

export const isHiggsfieldConfigured = () => higgsfieldAuthHeader() !== null;

async function higgsfieldFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const auth = higgsfieldAuthHeader();
  if (!auth) throw new HiggsfieldError("Higgsfield is not configured. Set HIGGSFIELD_API_KEY on the server.", 503);
  return fetch(path.startsWith("http") ? path : `${HIGGSFIELD_BASE}/${path.replace(/^\//, "")}`, {
    ...init,
    headers: { Authorization: auth, "Content-Type": "application/json", ...init.headers },
  });
}

function describeError(status: number, text: string): string {
  let detail: unknown = text;
  try { detail = JSON.parse(text).detail ?? text; } catch { /* plain text */ }
  const message = Array.isArray(detail)
    ? detail.map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).slice(1).join(".")}: ${d.msg}`).join("; ")
    : String(detail).slice(0, 500);
  if (status === 401) return "The Higgsfield API key is invalid.";
  if (status === 403) return "Not enough Higgsfield credits.";
  return `Higgsfield error ${status}: ${message}`;
}

/** Submits a generation and returns the Higgsfield request_id. */
export async function submitHiggsfield(endpoint: string, body: Record<string, unknown>, webhookUrl?: string): Promise<string> {
  const qs = webhookUrl ? `?hf_webhook=${encodeURIComponent(webhookUrl)}` : "";
  const res = await higgsfieldFetch(`${endpoint}${qs}`, {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new HiggsfieldError(describeError(res.status, text), res.status === 401 ? 401 : res.status >= 500 ? 502 : 400);
  const data = JSON.parse(text) as { request_id?: string };
  if (!data.request_id) throw new HiggsfieldError("Higgsfield returned no request_id", 502);
  return data.request_id;
}

export async function getHiggsfieldStatus(requestId: string): Promise<HiggsfieldStatus> {
  const res = await higgsfieldFetch(`requests/${encodeURIComponent(requestId)}/status`);
  const text = await res.text();
  if (!res.ok) throw new HiggsfieldError(describeError(res.status, text), res.status);
  return JSON.parse(text) as HiggsfieldStatus;
}

export interface RestylePreset { id: string; name: string; preview_url?: string }

let presetCache: { at: number; items: RestylePreset[] } | null = null;

export async function getRestylePresets(): Promise<RestylePreset[]> {
  if (presetCache && Date.now() - presetCache.at < 10 * 60 * 1000) return presetCache.items;
  const res = await higgsfieldFetch("models/higgsfield/genjutsu/restyle/v1.0/presets");
  const text = await res.text();
  if (!res.ok) throw new HiggsfieldError(describeError(res.status, text), res.status);
  const items = ((JSON.parse(text) as { items?: RestylePreset[] }).items ?? []).filter((p) => p?.id && p?.name);
  presetCache = { at: Date.now(), items };
  return items;
}

// ── Job settlement ───────────────────────────────────────────────────────────

const settling = new Set<string>();

function persist(taskId: string, result: JobResult) {
  jobStore.set(taskId, result);
  jobEvents.emit(`job:${taskId}`, result);
  const update = result.status === "done"
    ? { status: "done", video_url: result.videoUrl }
    : result.status === "error" ? { status: "error", error_msg: result.error } : null;
  if (!update) return;
  if (GUEST_MODE) {
    guestDb.updateGeneration(taskId, update);
  } else {
    supabaseAdmin.from("generations").update(update).eq("task_id", taskId).then(({ error }) => {
      if (error) console.error("[higgsfield] supabase update failed:", error.message);
    });
  }
}

/** Applies a terminal Higgsfield status to the job. Idempotent; non-terminal statuses are ignored. */
export async function settleHiggsfield(taskId: string, status: HiggsfieldStatus): Promise<boolean> {
  if (!TERMINAL.has(status.status)) return false;
  const existing = jobStore.get(taskId);
  if (existing && existing.status !== "pending") return true;
  if (settling.has(taskId)) return true;
  settling.add(taskId);
  try {
    if (status.status === "completed") {
      const sourceUrl = status.video?.url ?? status.images?.[0]?.url;
      if (!sourceUrl) {
        persist(taskId, { status: "error", error: "Higgsfield completed without an output URL" });
        return true;
      }
      const storedUrl = await mirrorToR2(sourceUrl, "videos").catch((err: Error) => {
        console.error("[higgsfield] R2 mirror failed, using source URL:", err.message);
        return sourceUrl;
      });
      persist(taskId, { status: "done", videoUrl: storedUrl });
    } else {
      const error = status.status === "nsfw"
        ? "Rejected by Higgsfield content moderation"
        : status.status === "canceled" ? "Generation was canceled" : status.error || "Generation failed";
      persist(taskId, { status: "error", error });
    }
    return true;
  } finally {
    settling.delete(taskId);
  }
}

const pollers = new Set<string>();

/**
 * Polls the request in the background until it reaches a terminal state.
 * The webhook usually settles first; this is the fallback when it cannot reach us.
 */
export function ensureHiggsfieldPolling(taskId: string) {
  if (!isHiggsfieldTaskId(taskId) || pollers.has(taskId)) return;
  const requestId = taskId.slice(HIGGSFIELD_TASK_PREFIX.length);
  pollers.add(taskId);
  const startedAt = Date.now();

  const tick = async () => {
    const current = jobStore.get(taskId);
    if (current && current.status !== "pending") { pollers.delete(taskId); return; }
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) { pollers.delete(taskId); return; }
    try {
      if (await settleHiggsfield(taskId, await getHiggsfieldStatus(requestId))) { pollers.delete(taskId); return; }
    } catch (err) {
      const status = err instanceof HiggsfieldError ? err.status : 0;
      if (status === 401 || status === 404) {
        persist(taskId, { status: "error", error: err instanceof Error ? err.message : "Higgsfield request not found" });
        pollers.delete(taskId);
        return;
      }
      console.error("[higgsfield] status poll failed:", err instanceof Error ? err.message : err);
    }
    setTimeout(tick, POLL_INTERVAL_MS);
  };
  setTimeout(tick, POLL_INTERVAL_MS);
}
