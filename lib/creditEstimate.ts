import type { ImageModel, VideoModel } from "./modelConfig";

// Snapshot of https://kie.ai/pricing, checked 2026-09-05 (Wan rows added 2026-10-06).
// Billing rules and source links: docs/credit-estimates.md.
export const CREDIT_PRICING_DATE = "2026-09-05";
export const CREDIT_PRICING_URL = "https://kie.ai/pricing";

export interface CreditEstimate {
  credits: number | null;
  maxCredits?: number;
  unit?: "second";
  detail: string;
}

type Rates = Record<string, number>;
const IMAGE_RATES: Record<string, number | Rates> = {
  "google-nano-banana": 4,
  "nano-banana-2": { "1k": 8, "2k": 12, "4k": 18 },
  "nano-banana-pro": { "1k": 18, "2k": 18, "4k": 24 },
  "nano-banana-2-lite": 4,
  "z-image": 0.8,
  "seedream-5-lite": 5.5,
  "seedream-5-pro": { "1k": 7, "2k": 14 },
  "grok-imagine-image": 4, // One API call, including the two text-to-image outputs.
  "gpt-image-2": { "1k": 6, "2k": 10, "4k": 16 },
};

const SEEDANCE_RATES: Record<string, { withoutVideo: Rates; withVideo: Rates }> = {
  "seedance-2": {
    withoutVideo: { "480p": 19, "720p": 41, "1080p": 102 },
    withVideo: { "480p": 11.5, "720p": 25, "1080p": 62 },
  },
  "seedance-2-fast": {
    withoutVideo: { "480p": 11.7, "720p": 24.8 },
    withVideo: { "480p": 6.8, "720p": 15 },
  },
  "seedance-2-mini": {
    withoutVideo: { "480p": 3.8, "720p": 8.2 },
    withVideo: { "480p": 2.4, "720p": 5 },
  },
  "seedance-2-5": {
    withoutVideo: { "480p": 28, "720p": 63 },
    withVideo: { "480p": 17, "720p": 38 },
  },
};

const VIDEO_SECOND_RATES: Record<string, Rates> = {
  "kling-3.0-turbo": { "720p": 18, "1080p": 22.5 },
  "grok-imagine": { "480p": 2.4, "720p": 4.5 },
  "grok-imagine-1-5-preview": { "480p": 2.4, "720p": 4.5 },
  "happyhorse": { "720p": 28, "1080p": 48 },
  "kling-2.6-motion-control": { "720p": 11, "1080p": 18 },
  "kling-3.0-motion-control": { "720p": 20, "1080p": 27 },
  "wan-3-0": { "480p": 8, "720p": 16, "1080p": 32 },
  "wan-3-0-prime": { "480p": 12.2, "720p": 25.2, "1080p": 50.4 },
  "wan-2-7": { "720p": 16, "1080p": 24 },
};

/** Wan models billed per video: resolution → duration (s) → credits. */
const WAN_FIXED_RATES: Record<string, Record<string, Record<number, number>>> = {
  "wan-2-2-turbo": { "480p": { 0: 40 }, "720p": { 0: 80 } },
  "wan-2-5": { "720p": { 5: 60, 10: 120 }, "1080p": { 5: 100, 10: 200 } },
  "wan-2-6": { "720p": { 5: 70, 10: 140, 15: 210 }, "1080p": { 5: 104.5, 10: 209.5, 15: 315 } },
};

const VEO_RATES: Record<string, Rates> = {
  "veo3_lite": { "720p": 30, "1080p": 35, "4k": 150 },
  "veo3_fast": { "720p": 60, "1080p": 65, "4k": 180 },
  "veo3": { "720p": 250, "1080p": 255, "4k": 380 },
};

const round = (value: number) => Math.round(value * 100) / 100;
const validSeconds = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;
const unavailable = (detail = "No verified Kie.ai price for these settings."): CreditEstimate => ({ credits: null, detail });

function total(rate: number | undefined, seconds: number, count: number, detail: string): CreditEstimate {
  if (rate === undefined || !Number.isFinite(seconds) || seconds < 0 || !Number.isInteger(count) || count < 1) return unavailable();
  return { credits: round(rate * seconds * count), detail: `${detail}${count > 1 ? ` × ${count} generations` : ""}` };
}

export function estimateImageCredits({ model, quality = "1k", count = 1, referenceImageCount = 0, provider = "kie" }: {
  model?: ImageModel;
  quality?: string;
  count?: number;
  referenceImageCount?: number;
  provider?: string;
}): CreditEstimate {
  if (provider !== "kie") return unavailable(`${provider === "codex" ? "Codex CLI" : "Azure Foundry"} generation does not use Kie.ai credits.`);
  if (!model) return unavailable();
  const rates = IMAGE_RATES[model.id];
  let rate = typeof rates === "number" ? rates : rates?.[quality.toLowerCase()];
  const references = model.supportsImages ? Math.min(model.maxImages, Math.max(0, referenceImageCount)) : 0;
  if (model.id === "seedream-5-pro" && rate !== undefined) rate += Math.max(0, references - 1) * 0.5;
  return total(rate, 1, count, `${model.name}${model.supportsQuality ? ` · ${quality.toUpperCase()}` : ""} · ${rate ?? "?"} credits / generation${model.id === "seedream-5-pro" && references > 1 ? " (reference images included)" : ""}`);
}

export function estimateVideoCredits({ model, duration, resolution, mode, sound = false, count = 1, hasImageInput = false, usesReferences = false, referenceVideoDurations = [], now = Date.now() }: {
  model?: VideoModel;
  duration?: number;
  resolution?: string;
  mode?: string;
  sound?: boolean;
  count?: number;
  hasImageInput?: boolean;
  usesReferences?: boolean;
  /** One entry per video actually sent; null means its duration is unknown. */
  referenceVideoDurations?: (number | null)[];
  now?: number;
}): CreditEstimate {
  if (!model) return unavailable();
  if (model.apiInput.higgsfield) return unavailable("Generated with the Higgsfield API, billed in Higgsfield credits (not Kie.ai).");
  const id = model.id;
  if ((id === "seedance-2-fast" || id === "seedance-2-mini") && now >= Date.parse("2026-10-07T06:00:00Z")) {
    return unavailable("The verified Kie.ai promotional price has expired. Check current pricing.");
  }
  const res = (resolution || model.defaultResolution || "480p").toLowerCase();
  if (model.resolutions && !model.resolutions.some((value) => value.toLowerCase() === res)) return unavailable();
  if (!Number.isInteger(count) || count < 1) return unavailable();
  const selectedDuration = duration ?? model.defaultDuration;
  const seconds = model.apiInput.durationMax > 0
    ? Math.max(model.apiInput.durationMin, Math.min(model.apiInput.durationMax, selectedDuration))
    : 0;
  const hasVideo = referenceVideoDurations.length > 0;
  const inputSeconds = referenceVideoDurations.every(validSeconds)
    ? referenceVideoDurations.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
  const label = `${model.name} · ${res.toUpperCase()}`;

  if (model.apiInput.useGoogleVeo) {
    if (id === "veo3" && usesReferences) return unavailable("Kie.ai does not publish a Quality reference-to-video price.");
    const rate = id === "veo3" && res === "4k" && hasImageInput ? 370 : VEO_RATES[id]?.[res];
    return total(rate, 1, count, `${label} · fixed price / video`);
  }
  if (id === "gemini-omni-video") {
    const rates: Rates = { 4: 63, 6: 84, 8: 105, 10: 126 };
    const base = hasVideo ? 168 : rates[seconds];
    return total(base === undefined ? undefined : base + (res === "4k" ? 84 : 0), 1, count, `${label} · ${hasVideo ? "with video input" : `${seconds}s`} · fixed price / video`);
  }
  const wanFixed = WAN_FIXED_RATES[id];
  if (wanFixed) {
    const price = wanFixed[res]?.[seconds];
    return total(price, 1, count, `${label} · ${seconds > 0 ? `${seconds}s` : "5s"} · fixed price / video`);
  }
  if ((id === "wan-3-0" || id === "wan-3-0-prime") && hasVideo) {
    const rate = VIDEO_SECOND_RATES[id]?.[res];
    if (rate === undefined) return unavailable();
    return { credits: rate, unit: "second", detail: `${model.name} · ${rate} credits/s. Kie.ai does not publish how reference video seconds are billed.` };
  }
  const seedance = SEEDANCE_RATES[id === "seedance-2-5-edit" ? "seedance-2-5" : id];
  let rate: number | undefined = seedance
    ? (hasVideo ? seedance.withVideo : seedance.withoutVideo)[res]
    : VIDEO_SECOND_RATES[id]?.[res];
  if (id === "kling-3.0") {
    const selectedMode = mode || model.defaultMode;
    rate = selectedMode === "4K" ? 67 : selectedMode === "std" ? (sound ? 20 : 14) : selectedMode === "pro" ? (sound ? 27 : 18) : undefined;
  }
  if (rate === undefined) return unavailable();
  const rateLabel = `${model.name} · ${rate} credits/s${count > 1 ? " per generation" : ""}`;

  if (model.apiInput.useMotionControl) {
    if (!hasVideo || inputSeconds === null) return { credits: rate, unit: "second", detail: `${rateLabel}. Total depends on the reference video duration.` };
    return total(rate, Math.ceil(inputSeconds), count, `${rateLabel} × ${Math.ceil(inputSeconds)}s reference (rounded up)`);
  }
  if (seedance && hasVideo && inputSeconds === null) {
    return { credits: rate, unit: "second", detail: `${rateLabel} × (input + output seconds). Reference duration is not available yet; total cannot be estimated.` };
  }
  if (id === "seedance-2-5-edit") {
    return { credits: rate, unit: "second", detail: `${rateLabel} × (input + output seconds). Kie.ai chooses the output duration automatically.` };
  }
  if (!validSeconds(seconds)) return unavailable("Select a valid generation duration.");
  const billedSeconds = seconds + (seedance && hasVideo ? inputSeconds ?? 0 : 0);
  const estimate = total(rate, billedSeconds, count, `${rateLabel} × ${billedSeconds}s${seedance && hasVideo ? ` (${inputSeconds}s input + ${seconds}s output)` : ""}`);
  // HappyHorse image-to-video inherits resolution from its input image; the API
  // deliberately omits the resolution selector in this case.
  if (id === "happyhorse" && hasImageInput && !usesReferences) {
    return { ...total(28, seconds, count, `${model.name} · ${seconds}s · resolution inherited from input image (720p–1080p)`), maxCredits: round(48 * seconds * count) };
  }
  return estimate;
}

/** The selected passage is the reference actually submitted to Kie.ai. */
export function getReferenceVideoDuration(reference: { videoDuration?: number; trimStart?: number; trimEnd?: number }): number | null {
  if (reference.trimStart !== undefined && reference.trimEnd !== undefined) {
    const seconds = reference.trimEnd - reference.trimStart;
    return reference.trimStart >= 0 && validSeconds(seconds) ? seconds : null;
  }
  return validSeconds(reference.videoDuration) ? reference.videoDuration : null;
}

export function formatCreditEstimate(estimate: CreditEstimate): string {
  if (estimate.credits === null) return "Estimate unavailable";
  const format = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
  const amount = estimate.maxCredits === undefined ? format(estimate.credits) : `${format(estimate.credits)}–${format(estimate.maxCredits)}`;
  return `≈ ${amount} credits${estimate.unit === "second" ? "/s" : ""}`;
}

export function combineCreditEstimates(estimates: CreditEstimate[]): CreditEstimate {
  if (estimates.length === 1) return estimates[0];
  if (estimates.length === 0) return unavailable("Enter a prompt to estimate the total.");
  const unknown = estimates.find((estimate) => estimate.credits === null || estimate.unit === "second");
  if (unknown) return unavailable(`Batch total is not available. ${unknown.detail}`);
  const credits = round(estimates.reduce((sum, estimate) => sum + estimate.credits!, 0));
  const maxCredits = round(estimates.reduce((sum, estimate) => sum + (estimate.maxCredits ?? estimate.credits!), 0));
  return { credits, ...(maxCredits !== credits ? { maxCredits } : {}), detail: `Total for ${estimates.length} prompts. ${estimates.map((estimate) => estimate.detail).join("; ")}` };
}
