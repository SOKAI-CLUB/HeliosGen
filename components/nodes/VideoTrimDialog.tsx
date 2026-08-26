"use client";

import { useCallback, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Scissors, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const MIN_SELECTION_SECONDS = 4.2;
const SELECTION_EPSILON_SECONDS = 0.001;

type DragMode = "start" | "end" | "selection";

interface DragState {
  mode: DragMode;
  pointerStartX: number;
  initialStart: number;
  initialEnd: number;
}

interface VideoTrimDialogProps {
  open: boolean;
  videoUrl: string;
  duration: number;
  initialStart?: number;
  initialEnd?: number;
  maxDuration?: number;
  onApply: (startTime: number, endTime: number, duration: number) => void;
  onCancel: (duration: number) => void;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const initialSelectionFor = (
  duration: number,
  initialStart?: number,
  initialEnd?: number,
  maxDuration?: number,
) => {
  if (!duration) return { start: 0, end: 0 };
  const minimumSelection = Math.min(MIN_SELECTION_SECONDS, duration);
  const safeStart = clamp(initialStart ?? 0, 0, duration - minimumSelection);
  const requestedEnd = initialEnd ?? duration;
  const cappedEnd = maxDuration
    ? Math.min(requestedEnd, safeStart + maxDuration)
    : requestedEnd;
  const safeEnd = clamp(Math.max(cappedEnd, safeStart + minimumSelection), 0, duration);
  return { start: safeStart, end: safeEnd };
};

const formatTimecode = (seconds: number) => {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(1).padStart(4, "0")}`;
};

export default function VideoTrimDialog({
  open,
  videoUrl,
  duration,
  initialStart,
  initialEnd,
  maxDuration,
  onApply,
  onCancel,
}: VideoTrimDialogProps) {
  const initialSelection = initialSelectionFor(duration, initialStart, initialEnd, maxDuration);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const startRef = useRef(initialSelection.start);
  const endRef = useRef(initialSelection.end);

  const [mediaDuration, setMediaDuration] = useState(duration);
  const [startTime, setStartTime] = useState(initialSelection.start);
  const [endTime, setEndTime] = useState(initialSelection.end);
  const [currentTime, setCurrentTime] = useState(initialSelection.start);
  const [isPlaying, setIsPlaying] = useState(false);

  const resetSelection = useCallback((nextDuration: number) => {
    if (!nextDuration) return;
    const nextSelection = initialSelectionFor(nextDuration, initialStart, initialEnd, maxDuration);
    setStartTime(nextSelection.start);
    setEndTime(nextSelection.end);
    setCurrentTime(nextSelection.start);
    startRef.current = nextSelection.start;
    endRef.current = nextSelection.end;
    if (videoRef.current) videoRef.current.currentTime = nextSelection.start;
  }, [initialEnd, initialStart, maxDuration]);

  const resetToFullSelection = useCallback(() => {
    const nextSelection = initialSelectionFor(mediaDuration, 0, mediaDuration, maxDuration);
    setStartTime(nextSelection.start);
    setEndTime(nextSelection.end);
    setCurrentTime(nextSelection.start);
    startRef.current = nextSelection.start;
    endRef.current = nextSelection.end;
    if (videoRef.current) videoRef.current.currentTime = nextSelection.start;
  }, [maxDuration, mediaDuration]);

  const seekPreview = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    const nextTime = clamp(time, 0, mediaDuration || video.duration || 0);
    video.currentTime = nextTime;
    setCurrentTime(nextTime);
  }, [mediaDuration]);

  const updateSelection = useCallback((nextStart: number, nextEnd: number, previewTime: number) => {
    setStartTime(nextStart);
    setEndTime(nextEnd);
    startRef.current = nextStart;
    endRef.current = nextEnd;
    seekPreview(previewTime);
  }, [seekPreview]);

  const timeAtPointer = useCallback((clientX: number) => {
    const timeline = timelineRef.current;
    if (!timeline || !mediaDuration) return 0;
    const rect = timeline.getBoundingClientRect();
    return clamp((clientX - rect.left) / rect.width, 0, 1) * mediaDuration;
  }, [mediaDuration]);

  const beginDrag = useCallback((event: React.PointerEvent, mode: DragMode) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      mode,
      pointerStartX: event.clientX,
      initialStart: startRef.current,
      initialEnd: endRef.current,
    };
    videoRef.current?.pause();
  }, []);

  const moveDrag = useCallback((event: React.PointerEvent) => {
    const drag = dragRef.current;
    const timeline = timelineRef.current;
    if (!drag || !timeline || !mediaDuration) return;
    const minimumSelection = Math.min(MIN_SELECTION_SECONDS, mediaDuration);

    if (drag.mode === "selection") {
      const selectionDuration = drag.initialEnd - drag.initialStart;
      const deltaSeconds = ((event.clientX - drag.pointerStartX) / timeline.getBoundingClientRect().width) * mediaDuration;
      const nextStart = clamp(drag.initialStart + deltaSeconds, 0, mediaDuration - selectionDuration);
      updateSelection(nextStart, nextStart + selectionDuration, nextStart);
      return;
    }

    const pointerTime = timeAtPointer(event.clientX);
    if (drag.mode === "start") {
      let nextStart = clamp(pointerTime, 0, endRef.current - minimumSelection);
      if (maxDuration) nextStart = Math.max(nextStart, endRef.current - maxDuration);
      updateSelection(nextStart, endRef.current, nextStart);
      return;
    }

    let nextEnd = clamp(pointerTime, startRef.current + minimumSelection, mediaDuration);
    if (maxDuration) nextEnd = Math.min(nextEnd, startRef.current + maxDuration);
    updateSelection(startRef.current, nextEnd, Math.max(startRef.current, nextEnd - 0.04));
  }, [maxDuration, mediaDuration, timeAtPointer, updateSelection]);

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  const nudgeHandle = useCallback((event: React.KeyboardEvent, mode: "start" | "end") => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const step = event.shiftKey ? 1 : 0.1;
    const minimumSelection = Math.min(MIN_SELECTION_SECONDS, mediaDuration);

    if (mode === "start") {
      let nextStart = clamp(startRef.current + direction * step, 0, endRef.current - minimumSelection);
      if (maxDuration) nextStart = Math.max(nextStart, endRef.current - maxDuration);
      updateSelection(nextStart, endRef.current, nextStart);
      return;
    }

    let nextEnd = clamp(endRef.current + direction * step, startRef.current + minimumSelection, mediaDuration);
    if (maxDuration) nextEnd = Math.min(nextEnd, startRef.current + maxDuration);
    updateSelection(startRef.current, nextEnd, Math.max(startRef.current, nextEnd - 0.04));
  }, [maxDuration, mediaDuration, updateSelection]);

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (video.currentTime < startRef.current || video.currentTime >= endRef.current - 0.04) {
        video.currentTime = startRef.current;
      }
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, []);

  const selectionDuration = Math.max(0, endTime - startTime);
  const hasMinimumSelection = selectionDuration + SELECTION_EPSILON_SECONDS >= MIN_SELECTION_SECONDS;
  const sourceTooShort = mediaDuration > 0 && mediaDuration + SELECTION_EPSILON_SECONDS < MIN_SELECTION_SECONDS;
  const startPercent = mediaDuration ? (startTime / mediaDuration) * 100 : 0;
  const endPercent = mediaDuration ? (endTime / mediaDuration) * 100 : 100;
  const currentPercent = mediaDuration ? (currentTime / mediaDuration) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(mediaDuration); }}>
      <DialogContent
        className="max-h-[calc(100vh-2rem)] overflow-y-auto p-0 sm:max-w-6xl"
        showCloseButton={false}
      >
        <DialogHeader className="px-5 pt-5 pr-14 sm:px-6 sm:pt-6 sm:pr-16">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Scissors />
            Trim video
          </DialogTitle>
          <DialogDescription>
            Keep at least {MIN_SELECTION_SECONDS} seconds. Drag the start and end handles to select the passage sent to the model.
          </DialogDescription>
        </DialogHeader>

        <Button
          aria-label="Close video trimmer"
          className="absolute top-4 right-4"
          onClick={() => onCancel(mediaDuration)}
          size="icon"
          variant="ghost"
        >
          <X />
        </Button>

        <div className="flex flex-col gap-3 px-5 sm:px-6">
          <div className="relative flex max-h-[44vh] min-h-48 items-center justify-center overflow-hidden rounded-xl bg-black">
            <video
              ref={videoRef}
              className="max-h-[44vh] w-full object-contain"
              playsInline
              preload="metadata"
              src={videoUrl}
              onClick={togglePlayback}
              onLoadedMetadata={(event) => {
                const loadedDuration = event.currentTarget.duration || duration;
                setMediaDuration(loadedDuration);
                resetSelection(loadedDuration);
              }}
              onPause={() => setIsPlaying(false)}
              onPlay={() => setIsPlaying(true)}
              onTimeUpdate={(event) => {
                const video = event.currentTarget;
                if (video.currentTime >= endRef.current - 0.025) {
                  video.currentTime = startRef.current;
                }
                setCurrentTime(video.currentTime);
              }}
            />

            <Button
              aria-label={isPlaying ? "Pause preview" : "Play selected passage"}
              className="absolute bottom-4 left-4 rounded-full bg-background/80 backdrop-blur-sm"
              onClick={togglePlayback}
              size="icon-lg"
              variant="secondary"
            >
              {isPlaying ? <Pause /> : <Play />}
            </Button>

            <div className="pointer-events-none absolute right-4 bottom-4 rounded-md bg-background/80 px-2 py-1 font-mono text-xs tabular-nums backdrop-blur-sm">
              {formatTimecode(currentTime)} / {formatTimecode(mediaDuration)}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <div className="rounded-lg bg-muted px-3 py-2">
              <div className="text-xs text-muted-foreground">Start</div>
              <div className="font-mono text-sm font-medium tabular-nums sm:text-base">{formatTimecode(startTime)}</div>
            </div>
            <div className="rounded-lg bg-muted px-3 py-2">
              <div className="text-xs text-muted-foreground">End</div>
              <div className="font-mono text-sm font-medium tabular-nums sm:text-base">{formatTimecode(endTime)}</div>
            </div>
            <div className="rounded-lg bg-muted px-3 py-2">
              <div className="text-xs text-muted-foreground">Selected</div>
              <div className="font-mono text-sm font-medium tabular-nums sm:text-base">{formatTimecode(selectionDuration)}</div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div
              ref={timelineRef}
              aria-label="Video trim timeline"
              className="relative h-16 touch-none select-none overflow-hidden rounded-xl bg-muted"
              onPointerCancel={endDrag}
              onPointerDown={(event) => {
                if (event.target !== event.currentTarget) return;
                seekPreview(timeAtPointer(event.clientX));
              }}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
            >
              <div className="pointer-events-none absolute inset-0 opacity-50" style={{ backgroundImage: "repeating-linear-gradient(90deg, transparent 0, transparent calc(10% - 1px), var(--border) calc(10% - 1px), var(--border) 10%)" }} />
              <div className="pointer-events-none absolute inset-y-0 left-0 bg-background/65" style={{ width: `${startPercent}%` }} />
              <div className="pointer-events-none absolute inset-y-0 right-0 bg-background/65" style={{ width: `${100 - endPercent}%` }} />

              <div
                className="absolute inset-y-0 cursor-grab border-y-2 border-primary bg-primary/15 active:cursor-grabbing"
                style={{ left: `${startPercent}%`, width: `${Math.max(0, endPercent - startPercent)}%` }}
                onPointerDown={(event) => beginDrag(event, "selection")}
              />

              <button
                aria-label="Selection start"
                aria-valuemax={Math.max(0, endTime - Math.min(MIN_SELECTION_SECONDS, mediaDuration))}
                aria-valuemin={0}
                aria-valuenow={startTime}
                className="absolute inset-y-0 w-5 -translate-x-1/2 cursor-ew-resize rounded-md border-2 border-primary bg-primary shadow-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                role="slider"
                style={{ left: `${startPercent}%` }}
                type="button"
                onKeyDown={(event) => nudgeHandle(event, "start")}
                onPointerDown={(event) => beginDrag(event, "start")}
              >
                <span className="absolute inset-y-5 left-1/2 w-px -translate-x-1/2 bg-primary-foreground/70" />
              </button>

              <button
                aria-label="Selection end"
                aria-valuemax={mediaDuration}
                aria-valuemin={Math.min(mediaDuration, startTime + Math.min(MIN_SELECTION_SECONDS, mediaDuration))}
                aria-valuenow={endTime}
                className="absolute inset-y-0 w-5 -translate-x-1/2 cursor-ew-resize rounded-md border-2 border-primary bg-primary shadow-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                role="slider"
                style={{ left: `${endPercent}%` }}
                type="button"
                onKeyDown={(event) => nudgeHandle(event, "end")}
                onPointerDown={(event) => beginDrag(event, "end")}
              >
                <span className="absolute inset-y-5 left-1/2 w-px -translate-x-1/2 bg-primary-foreground/70" />
              </button>

              <div
                className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground shadow-sm"
                style={{ left: `${currentPercent}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Drag the handles • drag the selected area to move it</span>
              <span>
                {sourceTooShort
                  ? `Source too short • ${MIN_SELECTION_SECONDS}s required`
                  : `${MIN_SELECTION_SECONDS}s minimum${maxDuration ? ` • ${maxDuration}s maximum` : ""}`}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 mt-1 px-5 sm:px-6">
          <Button onClick={() => onCancel(mediaDuration)} variant="outline">Cancel</Button>
          <Button
            onClick={resetToFullSelection}
            variant="ghost"
          >
            <RotateCcw data-icon="inline-start" />
            Reset
          </Button>
          <Button
            disabled={!mediaDuration || !hasMinimumSelection}
            onClick={() => {
              if (!hasMinimumSelection) return;
              onApply(Number(startTime.toFixed(3)), Number(endTime.toFixed(3)), mediaDuration);
            }}
          >
            <Scissors data-icon="inline-start" />
            Keep this passage
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
