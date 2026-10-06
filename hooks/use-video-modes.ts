"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { VideoModel, VideoModelMode } from "@/lib/modelConfig";

// Runtime mode catalogues (e.g. Genjutsu Restyle presets), shared across nodes.
let restylePresets: Promise<VideoModelMode[]> | null = null;

async function loadRestylePresets(): Promise<VideoModelMode[]> {
  let token = "guest";
  if (process.env.NEXT_PUBLIC_GUEST_MODE !== "true") {
    const { data } = await createClient().auth.getSession();
    if (!data.session) return [];
    token = data.session.access_token;
  }
  const res = await fetch("/api/higgsfield/presets", { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => ({})) as { items?: { id: string; name: string }[] };
  return (json.items ?? []).map((p) => ({ value: p.id, label: p.name }));
}

/** Mode options for a video model: the static `modes`, or a catalogue loaded at runtime. */
export function useVideoModes(model?: Pick<VideoModel, "modes" | "dynamicModes">): VideoModelMode[] {
  const dynamic = model?.dynamicModes;
  const [loaded, setLoaded] = useState<VideoModelMode[]>([]);

  useEffect(() => {
    if (dynamic !== "higgsfield-restyle-presets") return;
    let active = true;
    restylePresets ??= loadRestylePresets().then((items) => {
      if (items.length === 0) restylePresets = null; // retry on next mount
      return items;
    }, () => { restylePresets = null; return []; });
    restylePresets.then((items) => { if (active) setLoaded(items); });
    return () => { active = false; };
  }, [dynamic]);

  return dynamic ? loaded : model?.modes ?? [];
}
