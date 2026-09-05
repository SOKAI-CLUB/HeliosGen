"use client";

import { useEffect, useState } from "react";
import { getReferenceVideoDuration } from "@/lib/creditEstimate";

export interface CreditVideoReference {
  url?: string | null;
  videoDuration?: number;
  trimStart?: number;
  trimEnd?: number;
}

/** Read metadata only; estimating never creates a paid generation. */
export function useReferenceVideoDurations(references: CreditVideoReference[]): (number | null)[] {
  const [durations, setDurations] = useState<Record<string, number | null>>({});
  const missingUrls = JSON.stringify([...new Set(references
    .filter((reference) => getReferenceVideoDuration(reference) === null && reference.url && !(reference.url in durations))
    .map((reference) => reference.url!))]);

  useEffect(() => {
    const urls: string[] = JSON.parse(missingUrls);
    const cleanup = urls.map((url) => {
      const video = document.createElement("video");
      let disposed = false;
      const finish = () => {
        if (disposed) return;
        const value = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
        setDurations((previous) => ({ ...previous, [url]: value }));
        dispose();
      };
      const timer = window.setTimeout(finish, 15000);
      const dispose = () => {
        disposed = true;
        window.clearTimeout(timer);
        video.onloadedmetadata = null;
        video.onerror = null;
        video.removeAttribute("src");
        video.load();
      };
      video.preload = "metadata";
      video.onloadedmetadata = finish;
      video.onerror = finish;
      video.src = url;
      return dispose;
    });
    return () => cleanup.forEach((dispose) => dispose());
  }, [missingUrls]);

  return references.map((reference) => getReferenceVideoDuration(reference) ?? (reference.url ? durations[reference.url] ?? null : null));
}
