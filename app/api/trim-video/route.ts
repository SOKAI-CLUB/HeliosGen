/**
 * POST /api/trim-video
 * Body: { videoUrl: string, startTime: number, endTime: number }
 * Downloads the video, trims it with ffmpeg, uploads result to R2.
 * Returns: { cdnUrl: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { uploadBuffer } from "@/lib/r2";
import { writeFile, readFile, rm, mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let tempDirectory: string | null = null;

  try {
    const { videoUrl, startTime, endTime } = await req.json();

    if (!videoUrl || startTime === undefined || endTime === undefined) {
      return NextResponse.json({ error: "videoUrl, startTime and endTime are required" }, { status: 400 });
    }
    if (
      typeof startTime !== "number" ||
      typeof endTime !== "number" ||
      !Number.isFinite(startTime) ||
      !Number.isFinite(endTime) ||
      startTime < 0 ||
      endTime <= startTime
    ) {
      return NextResponse.json({ error: "endTime must be greater than startTime" }, { status: 400 });
    }

    // Download the video
    const res = await fetch(videoUrl);
    if (!res.ok) {
      return NextResponse.json({ error: `Failed to fetch video: ${res.status}` }, { status: 400 });
    }
    const videoBuffer = Buffer.from(await res.arrayBuffer());
    // Write to temp files
    tempDirectory = await mkdtemp(join(tmpdir(), "trim-"));
    const inputPath = join(tempDirectory, "input-video");
    const outputPath = join(tempDirectory, "output.mp4");
    await writeFile(inputPath, videoBuffer);

    // Decode from the requested timestamp and re-encode so cuts are frame-accurate.
    // Stream-copy cuts can start at the preceding keyframe and leak frames that the
    // user explicitly placed outside the selection.
    await execFileAsync("ffmpeg", [
      "-i",  inputPath,
      "-ss", String(startTime),
      "-t",  String(endTime - startTime),
      "-map", "0:v:0",
      "-map", "0:a?",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      "-avoid_negative_ts", "make_zero",
      "-y",
      outputPath,
    ]);

    const outputBuffer = await readFile(outputPath);
    const cdnUrl = await uploadBuffer(outputBuffer, "video/mp4", "references");

    return NextResponse.json({ cdnUrl });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[trim-video] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true }).catch(() => {});
  }
}
