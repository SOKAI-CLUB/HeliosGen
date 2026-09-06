// Contract verified against hjunior29/video-text-remover on Replicate.
export const TEXT_REMOVAL_MODEL = "hjunior29/video-text-remover";
export const TEXT_REMOVAL_VERSION = "247c8385f3c6c322110a6787bd2d257acc3a3d60b9ed7da1726a628f72a42c4d";
export const TEXT_REMOVAL_TITLE = "Vidéo sans sous-titres";

export interface TextRemovalJob {
  id: string;
  status: "pending" | "done" | "error";
  phase?: "starting" | "processing" | "saving";
  progress?: number;
  videoUrl?: string;
  sourceUrl?: string;
  error?: string;
  createdAt: string;
}

export interface ReplicatePrediction {
  id: string;
  model?: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: unknown;
  error?: unknown;
  logs?: string;
  input?: { video?: string };
}

export class TextRemovalError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function validateVideoUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 8192) {
    throw new TextRemovalError("Sélectionne une vidéo importée ou une URL HTTPS publique.");
  }
  let url: URL;
  try { url = new URL(value); } catch {
    throw new TextRemovalError("La vidéo doit être importée avant de pouvoir être traitée.");
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password ||
      (url.port && url.port !== "443") || !host.includes(".") ||
      /^[\d.]+$/.test(host) || host.includes(":") ||
      /(^|\.)(localhost|local|internal|test|invalid)$/.test(host)) {
    throw new TextRemovalError("La vidéo doit être accessible via une URL HTTPS publique.");
  }
  return url.href;
}

export function getOutputVideoUrl(output: unknown): string {
  // This version returns a single URI, never an object or a list of files.
  const value = validateVideoUrl(output);
  const host = new URL(value).hostname;
  if (host !== "replicate.delivery" && !host.endsWith(".replicate.delivery")) {
    throw new TextRemovalError("Replicate a renvoyé une adresse de résultat inattendue.", 502);
  }
  return value;
}

export function getRemovalProgress(logs = ""): number | undefined {
  const matches = [...logs.matchAll(/Progress:\s*\d+\/\d+ frames \(([\d.]+)%\)/g)];
  if (!matches.length) return undefined;
  return Math.min(99, Math.max(0, Math.round(Number(matches.at(-1)![1]))));
}

export async function replicateRequest(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<ReplicatePrediction> {
  const response = await fetch(`https://api.replicate.com/v1/predictions${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    // Provider responses may contain tokens or signed input URLs. Do not expose them.
    const message = response.status === 401 || response.status === 403
      ? "Le token Replicate est invalide ou n’a pas accès au modèle."
      : response.status === 402
        ? "Le compte Replicate n’a plus assez de crédits."
        : response.status === 429
          ? "Replicate reçoit trop de demandes. Réessaie dans un instant."
          : response.status === 404
            ? "Ce traitement Replicate a expiré ou n’est plus disponible."
            : "Replicate est momentanément indisponible. Réessaie dans un instant.";
    throw new TextRemovalError(message, response.status === 429 ? 429 : response.status === 404 ? 410 : 502);
  }
  const prediction = await response.json() as ReplicatePrediction;
  if (!/^[a-z0-9]+$/.test(prediction.id ?? "") ||
      !["starting", "processing", "succeeded", "failed", "canceled"].includes(prediction.status)) {
    throw new TextRemovalError("Réponse Replicate invalide.", 502);
  }
  return prediction;
}
