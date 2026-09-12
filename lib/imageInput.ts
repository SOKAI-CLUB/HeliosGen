import { createClient } from "./supabase/client";
import { getModelProvider } from "./providers";

export interface InputImage { url: string; naturalRatio: string }

export async function imageAuthHeaders(): Promise<Record<string, string>> {
  if (process.env.NEXT_PUBLIC_GUEST_MODE === "true") return { Authorization: "Bearer guest" };
  const { data: { session } } = await createClient().auth.getSession();
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}

async function readResponse(res: Response): Promise<Record<string, unknown>> {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `La requête a échoué (${res.status}).`);
  return json;
}

export function inspectInputImage(url: string, signal?: AbortSignal): Promise<InputImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); img.onload = null; img.onerror = null; };
    const abort = () => { cleanup(); reject(new DOMException("Opération annulée", "AbortError")); };
    const fail = () => { cleanup(); reject(new Error("Impossible de lire cette image. Choisissez un fichier JPG, PNG ou WebP valide.")); };
    const timer = setTimeout(fail, 30_000);
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) { fail(); return; }
      cleanup();
      resolve({ url, naturalRatio: `${img.naturalWidth} / ${img.naturalHeight}` });
    };
    img.onerror = fail;
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    img.src = url;
  });
}

/** A failed upload never replaces the current input with a temporary blob URL. */
export async function uploadInputImage(source: File | string, signal?: AbortSignal): Promise<InputImage> {
  if (typeof source !== "string" && (!source.type.startsWith("image/") || source.size > 100 * 1024 * 1024)) {
    throw new Error("Choisissez une image de moins de 100 Mo.");
  }
  if (typeof source === "string" && !/^https?:\/\//i.test(source)) {
    throw new Error("L’URL doit commencer par https:// ou http://.");
  }
  const headers = await imageAuthHeaders();
  const localUrl = typeof source === "string" ? undefined : URL.createObjectURL(source);
  try {
    if (localUrl) await inspectInputImage(localUrl, signal);
    const res = typeof source === "string"
      ? await fetch("/api/upload-to-r2", {
        method: "POST", signal, headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl: source, folder: "uploads" }),
      })
      : await fetch("/api/upload-asset", {
        method: "POST", signal, headers: { ...headers, "Content-Type": source.type }, body: source,
      });
    const json = await readResponse(res);
    if (typeof json.cdnUrl !== "string" || !json.cdnUrl) throw new Error("L’import n’a pas renvoyé d’image. Réessayez.");
    return await inspectInputImage(json.cdnUrl, signal);
  } finally {
    if (localUrl) URL.revokeObjectURL(localUrl);
  }
}

export interface InputImageGeneration {
  prompt: string;
  model: string;
  aspectRatio: string;
  quality: string;
  referenceUrl?: string;
}

export async function generateInputImage(settings: InputImageGeneration, signal: AbortSignal): Promise<InputImage> {
  const headers = await imageAuthHeaders();
  if (!headers.Authorization) throw new Error("Connectez-vous pour générer une image.");
  const provider = getModelProvider(settings.model);
  let providerSettings: Record<string, unknown> = {};
  if (provider === "codex") providerSettings = { codexProvider: true };
  if (provider === "azure") {
    const base = localStorage.getItem("aiui-azure-base-url");
    const deployment = JSON.parse(localStorage.getItem("aiui-azure-endpoints") || "{}")[settings.model];
    if (!base || !deployment) throw new Error("Configurez Azure dans les paramètres avant de générer cette image.");
    providerSettings = { azureBaseUrl: base, azureDeployment: deployment, azureQuality: "auto", azureResolution: "1k" };
  }
  const res = await fetch("/api/generate", {
    method: "POST", signal, headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.model, prompt: settings.prompt.trim(), aspectRatio: settings.aspectRatio,
      quality: settings.quality, imageUrls: settings.referenceUrl ? [settings.referenceUrl] : [],
      ...providerSettings,
    }),
  });
  const json = await readResponse(res);
  if (typeof json.taskId !== "string" || !json.taskId) throw new Error("La génération n’a pas pu démarrer.");
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const result = await readResponse(await fetch(`/api/job-status?taskId=${encodeURIComponent(json.taskId)}`, { headers, signal }));
    if (result.status === "done" && typeof result.imageUrl === "string") return inspectInputImage(result.imageUrl, signal);
    if (result.status === "error" || result.status === "not_found") throw new Error(typeof result.error === "string" ? result.error : "La génération a échoué ou a expiré.");
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException("Opération annulée", "AbortError")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 3000);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  throw new Error("La génération prend plus longtemps que prévu. Retrouvez son résultat dans la galerie lorsqu’elle sera terminée.");
}
