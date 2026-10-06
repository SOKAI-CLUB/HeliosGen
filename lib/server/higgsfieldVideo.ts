import "server-only";
import { NextResponse } from "next/server";
import { jobStore } from "@/lib/jobStore";
import { ensureR2 } from "@/lib/r2";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { GUEST_MODE } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";
import type { VideoModel } from "@/lib/modelConfig";
import {
  HIGGSFIELD_TASK_PREFIX, HiggsfieldError, ensureHiggsfieldPolling, isHiggsfieldConfigured, submitHiggsfield,
} from "@/lib/server/higgsfield";

export interface HiggsfieldVideoRequest {
  prompt?: string;
  startFrameUrl?: string;
  endFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  sound?: boolean;
  duration?: number;
  aspectRatio?: string;
  mode?: string;
  resolution?: string;
  debugOnly?: boolean;
}

const toR2 = (urls: string[] = [], max = Infinity) =>
  Promise.all(urls.filter(Boolean).slice(0, max).map((u) => ensureR2(u, "references").catch(() => u)));

/** Builds the Higgsfield endpoint + JSON body for a model. Throws HiggsfieldError(400) on missing inputs. */
async function buildRequest(cfg: VideoModel, req: HiggsfieldVideoRequest): Promise<{ endpoint: string; body: Record<string, unknown>; references: string[] }> {
  const { apiInput } = cfg;
  const prompt = (req.prompt ?? "").trim();
  const resolution = cfg.resolutions?.includes(req.resolution ?? "") ? req.resolution! : cfg.defaultResolution;
  const duration = Math.max(apiInput.durationMin, Math.min(apiInput.durationMax, Number(req.duration ?? cfg.defaultDuration)));
  const aspectRatio = cfg.ratios.includes(req.aspectRatio ?? "") ? req.aspectRatio! : cfg.defaultRatio;

  switch (apiInput.higgsfield) {
    case "genjutsu":
    case "genjutsu-restyle": {
      const [videos, images] = await Promise.all([
        toR2(req.referenceVideoUrls, 1),
        toR2(req.referenceImageUrls, cfg.maxResources),
      ]);
      if (!videos[0]) throw new HiggsfieldError(`${cfg.name} needs a source video (4–30 s).`, 400);
      const body: Record<string, unknown> = { prompt, video_url: videos[0], image_urls: images, resolution };
      if (apiInput.higgsfield === "genjutsu") {
        if (images.length === 0) throw new HiggsfieldError(`${cfg.name} needs at least one reference image.`, 400);
      } else {
        if (!req.mode) throw new HiggsfieldError("Select a Restyle style preset.", 400);
        body.preset_id = req.mode;
      }
      return { endpoint: cfg.apiId, body, references: [...videos, ...images] };
    }

    case "cinema-studio": {
      if (!prompt) throw new HiggsfieldError("Cinema Studio needs a prompt.", 400);
      const [images, videos, audios] = await Promise.all([
        toR2(req.referenceImageUrls, cfg.maxResources),
        toR2(req.referenceVideoUrls, cfg.maxReferenceVideos),
        toR2(req.referenceAudioUrls, cfg.maxReferenceAudios),
      ]);
      const body: Record<string, unknown> = {
        // App mentions are serialised as <<<image N>>>; Cinema Studio expects <<<image_N>>>.
        prompt: prompt.replace(/<<<(image|video|audio) (\d+)>>>/gi, (_m, kind: string, n: string) => `<<<${kind.toLowerCase()}_${n}>>>`),
        duration,
        resolution,
        aspect_ratio: aspectRatio,
        generate_audio: Boolean(req.sound),
      };
      if (req.mode && req.mode !== "auto") body.genre = req.mode;
      if (images.length) body.image_urls = images;
      if (videos.length) body.video_urls = videos;
      if (audios.length) body.audio_urls = audios;
      return { endpoint: cfg.apiId, body, references: [...images, ...videos, ...audios] };
    }

    case "ltx": {
      if (!prompt) throw new HiggsfieldError("LTX-2.5 needs a prompt.", 400);
      const [[start], [end]] = await Promise.all([toR2(req.startFrameUrl ? [req.startFrameUrl] : []), toR2(req.endFrameUrl ? [req.endFrameUrl] : [])]);
      const body: Record<string, unknown> = { prompt, duration, resolution, aspect_ratio: aspectRatio, generate_audio: Boolean(req.sound) };
      if (start && cfg.imageApiId) {
        body.image_url = start;
        if (end) body.end_image_url = end;
        return { endpoint: cfg.imageApiId, body, references: [start, ...(end ? [end] : [])] };
      }
      return { endpoint: cfg.apiId, body, references: [] };
    }

    default:
      throw new HiggsfieldError(`Unsupported Higgsfield model: ${cfg.id}`, 400);
  }
}

export async function generateWithHiggsfield(cfg: VideoModel, userId: string, req: HiggsfieldVideoRequest): Promise<NextResponse> {
  if (!isHiggsfieldConfigured()) {
    return NextResponse.json({ error: "Higgsfield is not configured. Add HIGGSFIELD_API_KEY on the server." }, { status: 503 });
  }

  try {
    const { endpoint, body, references } = await buildRequest(cfg, req);
    if (req.debugOnly) {
      console.log(`[DEBUG] generate-video (higgsfield) payload → ${endpoint}`, JSON.stringify(body, null, 2));
      return NextResponse.json({ debugPayload: body, debugEndpoint: endpoint });
    }

    const callbackBase = process.env.CALLBACK_BASE_URL?.replace(/\/$/, "");
    const webhookUrl = callbackBase?.startsWith("https://") ? `${callbackBase}/api/higgsfield/callback` : undefined;

    console.log(`[generate-video] sending to higgsfield ${endpoint}:`, JSON.stringify(body));
    const requestId = await submitHiggsfield(endpoint, body, webhookUrl);
    const taskId = `${HIGGSFIELD_TASK_PREFIX}${requestId}`;

    jobStore.set(taskId, { status: "pending", type: "video", userId });
    ensureHiggsfieldPolling(taskId);

    const row = {
      task_id: taskId, user_id: userId, generation_type: "video" as const, status: "pending" as const,
      model: cfg.id, prompt: req.prompt ?? "", aspect_ratio: typeof body.aspect_ratio === "string" ? body.aspect_ratio : "",
      duration: typeof body.duration === "number" ? body.duration : 0, kling_mode: req.mode,
      sound: cfg.sound ? Boolean(req.sound) : false, reference_image_urls: references,
    };
    if (GUEST_MODE) {
      guestDb.insertGeneration(row);
    } else {
      supabaseAdmin.from("generations").insert(row).then(({ error }) => {
        if (error) console.error("[generate-video] supabase insert error:", error.message);
      });
    }

    return NextResponse.json({ taskId });
  } catch (err) {
    const status = err instanceof HiggsfieldError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[generate-video] higgsfield error:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
