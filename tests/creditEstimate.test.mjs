import assert from "node:assert/strict";
import test from "node:test";
import { IMAGE_MODELS, VIDEO_MODELS } from "../lib/modelConfig.ts";
import { estimateImageCredits, estimateVideoCredits, getReferenceVideoDuration, formatCreditEstimate, combineCreditEstimates } from "../lib/creditEstimate.ts";

const image = (id, options = {}) => estimateImageCredits({ model: IMAGE_MODELS.find((model) => model.id === id), ...options });
const video = (id, options = {}) => estimateVideoCredits({ model: VIDEO_MODELS.find((model) => model.id === id), now: Date.parse("2026-09-05T12:00:00Z"), ...options });

test("every configured image model has a verified estimate", () => {
  for (const model of IMAGE_MODELS) {
    for (const quality of model.apiInput.qualityOptions ?? ["1k"]) {
      assert.ok(image(model.id, { quality }).credits > 0, `${model.id} / ${quality}`);
    }
  }
});

test("Nano Banana resolves each image tier and the whole batch", () => {
  assert.equal(image("nano-banana-2", { quality: "1k" }).credits, 8);
  assert.equal(image("nano-banana-2", { quality: "2k", count: 4 }).credits, 48);
  assert.equal(image("nano-banana-2", { quality: "4k" }).credits, 18);
  assert.equal(image("nano-banana-pro", { quality: "4k", count: 2 }).credits, 48);
  for (const id of ["nano-banana-2", "nano-banana-pro"]) {
    const { apiInput } = IMAGE_MODELS.find((model) => model.id === id);
    assert.equal(apiInput.qualityKey, "resolution");
    assert.equal(apiInput.qualityMap, undefined);
  }
});

test("GPT Image 2 uses resolution pricing; Grok charges per API call", () => {
  assert.equal(image("gpt-image-2", { quality: "4k", count: 3 }).credits, 48);
  assert.equal(image("grok-imagine-image", { count: 2 }).credits, 8);
});

test("Seedream Pro includes paid references after the first, capped at the submitted limit", () => {
  assert.equal(image("seedream-5-pro", { quality: "2k", referenceImageCount: 1 }).credits, 14);
  assert.equal(image("seedream-5-pro", { quality: "2k", referenceImageCount: 4, count: 2 }).credits, 31);
  assert.equal(image("seedream-5-pro", { quality: "1k", referenceImageCount: 20 }).credits, 11.5);
});

test("non-Kie providers and unknown rates never show free or guessed credits", () => {
  assert.equal(image("gpt-image-2", { provider: "azure" }).credits, null);
  assert.equal(image("gpt-image-2", { provider: "codex" }).credits, null);
  assert.equal(image("missing").credits, null);
  assert.equal(image("gpt-image-2", { quality: "medium" }).credits, null);
  assert.equal(video("seedance-2-fast", { resolution: "1080p" }).credits, null);
  assert.equal(video("gemini-omni-video", { resolution: "invalid" }).credits, null);
});

test("Kling scales with duration, resolution, audio and batch count", () => {
  assert.equal(video("kling-3.0", { duration: 5, mode: "pro" }).credits, 90);
  assert.equal(video("kling-3.0", { duration: 10, mode: "pro", sound: true, count: 2 }).credits, 540);
  assert.equal(video("kling-3.0", { duration: 3, mode: "std", sound: true }).credits, 60);
  assert.equal(video("kling-3.0", { duration: 5, mode: "4K", sound: false }).credits, 335);
  assert.equal(video("kling-3.0-turbo", { duration: 7, resolution: "1080p" }).credits, 157.5);
});

test("requested video lengths are clamped exactly as the generation route", () => {
  assert.equal(video("seedance-2", { duration: 1 }).credits, 164);
  assert.equal(video("grok-imagine", { duration: 100 }).credits, 72);
  assert.equal(video("grok-imagine", { duration: NaN }).credits, null);
  assert.equal(video("seedance-2", { duration: -1 }).credits, 164);
});

test("expired promotional rates are no longer quoted", () => {
  for (const id of ["seedance-2-fast", "seedance-2-mini"]) {
    assert.equal(video(id, { now: Date.parse("2026-10-07T06:00:00Z") }).credits, null);
  }
});

test("Seedance adds all reference seconds to the output using the video input rate", () => {
  assert.equal(video("seedance-2", { duration: 5, resolution: "720p" }).credits, 205);
  assert.equal(video("seedance-2", { duration: 5, resolution: "720p", referenceVideoDurations: [4, 6] }).credits, 375);
  assert.equal(video("seedance-2-fast", { duration: 5, resolution: "720p", referenceVideoDurations: [4], count: 2 }).credits, 270);
  assert.equal(video("seedance-2-mini", { duration: 8, resolution: "480p", referenceVideoDurations: [2] }).credits, 24);
  assert.equal(video("seedance-2-5", { duration: 30, resolution: "720p", referenceVideoDurations: [4] }).credits, 1292);
});

test("unknown reference metadata and automatic edit duration show a unit rate, never a false total", () => {
  assert.equal(video("seedance-2", { referenceVideoDurations: [null] }).unit, "second");
  assert.equal(video("seedance-2-5-edit", { referenceVideoDurations: [8] }).unit, "second");
  assert.equal(video("kling-2.6-motion-control").unit, "second");
});

test("trimmed passages replace the full video length for billing", () => {
  assert.equal(getReferenceVideoDuration({ videoDuration: 60, trimStart: 10, trimEnd: 16 }), 6);
  assert.equal(getReferenceVideoDuration({ videoDuration: 12.5 }), 12.5);
  assert.equal(getReferenceVideoDuration({}), null);
  assert.equal(getReferenceVideoDuration({ videoDuration: Infinity }), null);
  assert.equal(getReferenceVideoDuration({ trimStart: 4, trimEnd: 2 }), null);
  assert.equal(video("kling-2.6-motion-control", { referenceVideoDurations: [6.2], resolution: "1080p" }).credits, 126);
});

test("Veo is billed per video including resolution, not per requested second", () => {
  assert.equal(video("veo3_lite", { duration: 0 }).credits, 30);
  assert.equal(video("veo3_fast", { resolution: "1080p", count: 3 }).credits, 195);
  assert.equal(video("veo3", { resolution: "4k" }).credits, 380);
  assert.equal(video("veo3", { resolution: "4k", hasImageInput: true }).credits, 370);
  assert.equal(video("veo3", { usesReferences: true }).credits, null);
});

test("Gemini Omni applies the duration table, 4K surcharge and fixed reference price", () => {
  assert.equal(video("gemini-omni-video", { duration: 6 }).credits, 84);
  assert.equal(video("gemini-omni-video", { duration: 8, resolution: "4k" }).credits, 189);
  assert.equal(video("gemini-omni-video", { duration: 4, referenceVideoDurations: [null] }).credits, 168);
});

test("HappyHorse image input has a range because resolution is inherited", () => {
  const estimate = video("happyhorse", { duration: 5, hasImageInput: true });
  assert.equal(estimate.credits, 140);
  assert.equal(estimate.maxCredits, 240);
  assert.equal(video("happyhorse", { duration: 5, usesReferences: true, resolution: "1080p" }).credits, 240);
});

test("multi-prompt totals preserve fractional prices and unknown states", () => {
  assert.equal(combineCreditEstimates([image("z-image"), image("z-image"), image("z-image")]).credits, 2.4);
  assert.equal(combineCreditEstimates([image("nano-banana-2"), image("missing")]).credits, null);
  assert.equal(combineCreditEstimates([]).credits, null);
  assert.equal(combineCreditEstimates([video("seedance-2-5-edit"), video("seedance-2-5-edit")]).credits, null);
  assert.equal(formatCreditEstimate(video("grok-imagine", { duration: 6 })), "≈ 14.4 credits");
  assert.equal(formatCreditEstimate(video("kling-2.6-motion-control")), "≈ 11 credits/s");
});

test("Wan models use per-video tables or per-second rates", () => {
  assert.equal(video("wan-2-2-turbo", { resolution: "480p" }).credits, 40);
  assert.equal(video("wan-2-5", { duration: 10, resolution: "720p" }).credits, 120);
  assert.equal(video("wan-2-6", { duration: 15, resolution: "1080p", count: 2 }).credits, 630);
  assert.equal(video("wan-2-7", { duration: 8, resolution: "720p" }).credits, 128);
  assert.equal(video("wan-3-0", { duration: 10, resolution: "1080p" }).credits, 320);
  assert.equal(video("wan-3-0-prime", { duration: 5, resolution: "480p" }).credits, 61);
  assert.equal(video("wan-3-0", { duration: 5, referenceVideoDurations: [3] }).unit, "second");
});

test("Higgsfield models are estimated in US dollars from published list prices", () => {
  // Genjutsu: per second of source video, rounded up, capped at 30 s
  const genjutsu = video("hf-genjutsu-motion-transfer", { resolution: "720p", referenceVideoDurations: [8.1] });
  assert.equal(genjutsu.currency, "usd");
  assert.equal(genjutsu.credits, 6.129); // 9 s × $0.681
  assert.equal(video("hf-genjutsu-restyle", { resolution: "1080p", referenceVideoDurations: [45] }).credits, 48.96); // 30 s × $1.632
  assert.equal(video("hf-genjutsu-object-swap", { resolution: "480p" }).unit, "second");
  // Cinema Studio: ceil(s × w × h × 24 / 1024) tokens × $0.0214 / 1k
  assert.equal(video("hf-cinema-studio-4", { duration: 5, resolution: "720p" }).credits, 2.311); // 108,000 tokens
  assert.equal(video("hf-cinema-studio-4", { duration: 5, resolution: "720p", referenceVideoDurations: [5] }).credits, 2.773); // 216,000 × $0.01284
  // LTX-2.5: per second of output
  assert.equal(video("hf-ltx-2-5-pro", { duration: 8, resolution: "1080p" }).credits, 1.36);
  assert.equal(video("hf-ltx-2-5-fast", { duration: 10, resolution: "4k", count: 2 }).credits, 6);
  assert.match(formatCreditEstimate(video("hf-ltx-2-5-pro", { duration: 8, resolution: "1080p" })), /^≈ \$1\.36$/);
});
