import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { GUEST_MODE } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { uploadBuffer } from "@/lib/r2";
import {
  TEXT_REMOVAL_MODEL, TEXT_REMOVAL_TITLE, TEXT_REMOVAL_VERSION,
  TextRemovalError, getOutputVideoUrl, getRemovalProgress, replicateRequest,
  type ReplicatePrediction, type TextRemovalJob,
} from "@/lib/videoTextRemoval";

interface JobRow {
  id: string;
  user_id: string | null;
  task_id: string;
  status: string;
  model?: string;
  video_url?: string | null;
  error_msg?: string | null;
  created_at: string;
}

const columns = "id, user_id, task_id, status, model, video_url, error_msg, created_at";
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateJobId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new TextRemovalError("Identifiant de traitement invalide.");
}

export function replicateToken(): string {
  const token = process.env.REPLICATE_API_TOKEN?.trim();
  if (!token) throw new TextRemovalError("La suppression des sous-titres sera disponible dès que le token Replicate aura été configuré.", 503);
  return token;
}

export function webhookSignature(id: string): string {
  return createHmac("sha256", replicateToken()).update(`video-text-removal:${id}`).digest("hex");
}

export function verifyWebhookSignature(id: string, signature: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(webhookSignature(id), "hex"));
}

export async function findRemovalJob(id: string, userId?: string): Promise<JobRow | null> {
  validateJobId(id);
  if (GUEST_MODE) return guestDb.getTextRemovalJob(id, userId) as JobRow | null;
  let query = supabaseAdmin.from("generations").select(columns).eq("id", id).eq("model", TEXT_REMOVAL_MODEL);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new TextRemovalError("Impossible de lire le traitement enregistré.", 503);
  return data;
}

export function jobView(row: JobRow): TextRemovalJob {
  return {
    id: row.id,
    status: row.status === "done" ? "done" : row.status === "error" ? "error" : "pending",
    videoUrl: row.video_url ?? undefined,
    error: row.error_msg ?? undefined,
    createdAt: row.created_at,
  };
}

export async function listRemovalJobs(userId: string): Promise<TextRemovalJob[]> {
  if (GUEST_MODE) return guestDb.getPendingTextRemovalJobs(userId).map(jobView);
  const { data, error } = await supabaseAdmin.from("generations").select(columns)
    .eq("user_id", userId).eq("model", TEXT_REMOVAL_MODEL).eq("status", "pending")
    .order("created_at", { ascending: false }).limit(20);
  if (error) throw new TextRemovalError("Impossible de retrouver les traitements en cours.", 503);
  return (data ?? []).map(jobView);
}

async function updateJob(row: JobRow, updates: { status?: string; task_id?: string; video_url?: string; error_msg?: string }): Promise<void> {
  if (GUEST_MODE) {
    guestDb.updateTextRemovalJob(row.id, updates);
    return;
  }
  const { error } = await supabaseAdmin.from("generations").update(updates).eq("id", row.id).eq("model", TEXT_REMOVAL_MODEL);
  if (error) throw new TextRemovalError("Impossible de sauvegarder le traitement. Son suivi sera réessayé automatiquement.", 503);
}

const launching = new Map<string, Promise<TextRemovalJob>>();

export function startRemoval(id: string, userId: string, sourceUrl: string): Promise<TextRemovalJob> {
  // Serialize per owner so double clicks and concurrent uploads respect the limit.
  const previous = launching.get(userId) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(() => startRemovalOnce(id, userId, sourceUrl));
  launching.set(userId, current);
  return current.finally(() => { if (launching.get(userId) === current) launching.delete(userId); });
}

async function startRemovalOnce(id: string, userId: string, sourceUrl: string): Promise<TextRemovalJob> {
  validateJobId(id);
  const token = replicateToken();
  const existing = await findRemovalJob(id, userId);
  if (existing) return jobView(existing); // Same request ID must never submit a second paid prediction.
  const jobs = await listRemovalJobs(userId);
  if (jobs.length >= 3) throw new TextRemovalError("Tu as déjà 3 vidéos en cours de traitement. Attends qu’une vidéo soit terminée.", 429);

  const record = {
    id, user_id: userId, task_id: `replicate-pending:${id}`,
    generation_type: "video", model: TEXT_REMOVAL_MODEL,
    prompt: TEXT_REMOVAL_TITLE, status: "pending",
  };
  if (GUEST_MODE) {
    guestDb.insertGeneration(record);
  } else {
    const { error } = await supabaseAdmin.from("generations").insert(record);
    if (error?.code === "23505") {
      const duplicate = await findRemovalJob(id, userId);
      if (duplicate) return jobView(duplicate);
    }
    if (error) throw new TextRemovalError("Impossible de créer le traitement. Aucun appel Replicate n’a été lancé.", 503);
  }
  const row = (await findRemovalJob(id, userId))!;
  let prediction: ReplicatePrediction | undefined;
  try {
    const callbackBase = process.env.CALLBACK_BASE_URL?.replace(/\/$/, "");
    const webhook = callbackBase?.startsWith("https://")
      ? `${callbackBase}/api/remove-video-text/callback?jobId=${id}&signature=${webhookSignature(id)}`
      : undefined;
    prediction = await replicateRequest(token, "", {
      method: "POST",
      headers: { "Cancel-After": "1h" },
      body: JSON.stringify({
        version: TEXT_REMOVAL_VERSION,
        input: { video: sourceUrl, method: "hybrid", resolution: "720p", conf_threshold: 0.25, iou_threshold: 0.45, margin: 5, detection_interval: 5 },
        ...(webhook ? { webhook, webhook_events_filter: ["completed"] } : {}),
      }),
    });
    await updateJob(row, { task_id: `replicate:${prediction.id}` });
    return { ...jobView(row), sourceUrl, phase: "starting" };
  } catch (error) {
    if (prediction) await replicateRequest(token, `/${prediction.id}/cancel`, { method: "POST" }).catch(() => {});
    await updateJob(row, { status: "error", error_msg: "Le lancement du traitement a échoué. Réessaie depuis la vidéo d’origine." }).catch(() => {});
    throw error;
  }
}

// Callback and polling can arrive together. Share the upload and DB write.
const finalizing = new Map<string, Promise<TextRemovalJob>>();

async function saveOutput(url: string): Promise<string> {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(120_000), cache: "no-store" });
  if (!response.ok || !response.body) throw new TextRemovalError("Le résultat est prêt, mais son téléchargement a échoué. Nouvelle tentative en cours.", 503);
  const limit = 500 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body.cancel();
    throw new TextRemovalError("La vidéo traitée dépasse la limite de 500 Mo.", 413);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new TextRemovalError("La vidéo traitée dépasse la limite de 500 Mo.", 413);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (!size) throw new TextRemovalError("Replicate a renvoyé une vidéo vide.", 502);
  return uploadBuffer(Buffer.concat(chunks), "video/mp4", "videos");
}

export async function syncRemoval(row: JobRow, prediction?: ReplicatePrediction): Promise<TextRemovalJob> {
  if (row.status === "done" || row.status === "error") return jobView(row);
  const predictionId = row.task_id.startsWith("replicate:") ? row.task_id.slice(10) : undefined;
  if (!prediction && !predictionId) {
    if (Date.now() - Date.parse(row.created_at) > 120_000) {
      await updateJob(row, { status: "error", error_msg: "Le lancement a été interrompu. Réessaie depuis la vidéo d’origine." });
      return jobView((await findRemovalJob(row.id))!);
    }
    return { ...jobView(row), phase: "starting" };
  }
  const result = prediction ?? await replicateRequest(replicateToken(), `/${predictionId}`);
  if (predictionId && result.id !== predictionId) throw new TextRemovalError("Le résultat ne correspond pas au traitement.", 400);
  const sourceUrl = result.input?.video;
  if (result.status === "failed" || result.status === "canceled") {
    const error = result.status === "canceled" ? "Le traitement a été annulé ou a dépassé sa durée limite." : "Replicate n’a pas pu traiter cette vidéo. Vérifie qu’elle est lisible, puis réessaie.";
    await updateJob(row, { status: "error", error_msg: error });
    return { ...jobView(row), status: "error", error, sourceUrl };
  }
  if (result.status !== "succeeded") return {
    ...jobView(row), phase: result.status, progress: getRemovalProgress(result.logs), sourceUrl,
  };
  const ongoing = finalizing.get(row.id);
  if (ongoing) return ongoing;
  const operation = (async () => {
    try {
      const videoUrl = await saveOutput(getOutputVideoUrl(result.output));
      await updateJob(row, { status: "done", video_url: videoUrl });
      return { ...jobView(row), status: "done" as const, videoUrl, sourceUrl };
    } catch (error) {
      if (error instanceof TextRemovalError && [400, 413, 502].includes(error.status)) {
        await updateJob(row, { status: "error", error_msg: error.message });
      }
      throw error;
    }
  })();
  finalizing.set(row.id, operation);
  try { return await operation; } finally { finalizing.delete(row.id); }
}

export async function pollRemoval(id: string, userId: string): Promise<TextRemovalJob> {
  const row = await findRemovalJob(id, userId);
  if (!row) throw new TextRemovalError("Traitement introuvable.", 404);
  try { return await syncRemoval(row); } catch (error) {
    if (error instanceof TextRemovalError && error.status === 410) {
      await updateJob(row, { status: "error", error_msg: error.message });
      return { ...jobView(row), status: "error", error: error.message };
    }
    throw error;
  }
}
