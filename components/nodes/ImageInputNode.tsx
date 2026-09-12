"use client";
import { useRef, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import NextImage from "next/image";
import { Handle, Position, NodeProps, Node, useUpdateNodeInternals } from "@xyflow/react";
import CornerResizer from "./CornerResizer";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { Pencil, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useReadOnly } from "@/lib/readOnlyContext";
import { usePipelineRunner } from "@/lib/usePipelineRunner";
import { getDownstreamNodeIds, isNodeBusy } from "@/lib/workflowGraph";
import ImageInputEditor from "./ImageInputEditor";


type ImageInputNodeType = Node<NodeData, "imageInputNode">;

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

export default function ImageInputNode({ id, data, selected }: NodeProps<ImageInputNodeType>) {
  const updateNodeData  = useWorkflowStore((s) => s.updateNodeData);
  const updateNodeSize  = useWorkflowStore((s) => s.updateNodeSize);
  const edges           = useWorkflowStore((s) => s.edges);
  const sourceConnected = edges.some((e) => e.source === id);
  const readOnly = useReadOnly();
  const nodes = useWorkflowStore(s => s.nodes);
  const workflowRunning = useWorkflowStore(s => s.isRunning);
  const [editorOpen, setEditorOpen] = useState(false);
  const [droppedFile, setDroppedFile] = useState<File | undefined>();
  const downstreamIds = getDownstreamNodeIds(id, edges);
  const { run, isRunning: pipelineRunning, genNodeCount } = usePipelineRunner(downstreamIds);
  const busy = workflowRunning || nodes.some(isNodeBusy);
  const editable = !readOnly && !data.locked;
  const openEditor = (file?: File) => {
    if (!editable || busy) return;
    if (DEMO_MODE) { useWorkflowStore.getState().setAuthModalOpen(true); return; }
    setDroppedFile(file);
    setEditorOpen(true);
  };
  const rootRef        = useRef<HTMLDivElement>(null);
  const updateNodeInternals = useUpdateNodeInternals();

  // Persistent ResizeObserver — fires as image aspect ratio drives CSS height changes,
  // keeping group bounds in sync throughout the transition.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      updateNodeSize(id, el.offsetWidth, el.offsetHeight);
      updateNodeInternals(id);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, updateNodeSize, updateNodeInternals]);

  // Instant hide on deselect
  const prevSelectedRef = useRef(selected);
  useEffect(() => {
    const was = prevSelectedRef.current;
    prevSelectedRef.current = selected;
    if (was && !selected && rootRef.current) {
      const el = rootRef.current;
      el.classList.add("handles-no-delay");
      const t = setTimeout(() => el.classList.remove("handles-no-delay"), 200);
      return () => { clearTimeout(t); el.classList.remove("handles-no-delay"); };
    }
  }, [selected]);
  const nodeImgRef     = useRef<HTMLImageElement>(null);
  const [lightboxOpen, setLightboxOpen]           = useState(false);
  const [lightboxVisible, setLightboxVisible]     = useState(false);
  const [lightboxImgLoaded, setLightboxImgLoaded] = useState(false);
  const [blurSrc, setBlurSrc]                     = useState<string | null>(null);

  const openLightbox = useCallback(() => {
    // Grab the currentSrc of the already-rendered node image (cached low-quality URL)
    setBlurSrc(nodeImgRef.current?.currentSrc ?? null);
    setLightboxImgLoaded(false);
    setLightboxOpen(true);
    requestAnimationFrame(() => setLightboxVisible(true));
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxVisible(false);
    setTimeout(() => setLightboxOpen(false), 220);
  }, []);

  // Close lightbox on Escape
  useEffect(() => {
    if (!lightboxOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") closeLightbox(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxOpen, closeLightbox]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files[0];
    if (file) openEditor(file);
  };

  const editor = editable && editorOpen ? (
    <ImageInputEditor
      nodeId={id}
      currentUrl={(data.r2Url ?? data.inputImage) as string | undefined}
      initialFile={droppedFile}
      downstreamCount={genNodeCount}
      onClose={() => { setEditorOpen(false); setDroppedFile(undefined); }}
      onApply={(image, rerun) => {
        const store = useWorkflowStore.getState();
        if (!store.replaceInputImage(id, image.url, image.naturalRatio)) return false;
        if (rerun) run();
        return true;
      }}
    />
  ) : null;

  // ── Two-layer crossfade: old image stays visible until new one fades in ─────
  const canonicalSrc = (data.r2Url ?? data.inputImage) as string | undefined;

  const isUploading = !data.r2Url && !!data.inputImage;

  // The "settled" bottom layer — never changes mid-transition
  const [baseSrc, setBaseSrc] = useState(canonicalSrc);
  // The incoming top layer — fades from 0→1, then gets promoted to base
  const [topSrc, setTopSrc]   = useState<string | undefined>(undefined);
  const [topReady, setTopReady] = useState(false);   // triggers the CSS transition
  const baseSrcRef = useRef(baseSrc);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!canonicalSrc) {
        // Asset removed — reset crossfade state so the empty state renders
        setBaseSrc(undefined);
        baseSrcRef.current = undefined;
        setTopSrc(undefined);
        setTopReady(false);
        return;
      }
      if (canonicalSrc === baseSrcRef.current) {
        setTopSrc(undefined);
        setTopReady(false);
        return;
      }

      if (!baseSrcRef.current) {
        // No existing image — set directly, nothing to crossfade over
        setBaseSrc(canonicalSrc);
        baseSrcRef.current = canonicalSrc;
        return;
      }

      // New URL arrived — render it on top at opacity 0; onLoad will trigger the fade
      setTopSrc(canonicalSrc);
      setTopReady(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [canonicalSrc]);

  // Uploading = local blob present but CDN URL not yet confirmed
  const hasImage = !!baseSrc;
  // CSS aspect-ratio accepts "width / height" string directly (e.g. "1920 / 1080")
  const ratio    = (data.imageNaturalRatio as string | undefined) ?? "1 / 1";

  const [natW, natH] = (() => {
    const r = data.imageNaturalRatio as string | undefined;
    if (!r) return [0, 0];
    const parts = r.split("/").map((s) => parseInt(s.trim(), 10));
    return parts.length === 2 ? parts : [0, 0];
  })();

  if (hasImage) {
    return (
      // Outer: node-card for border/hover/selected styling + overflow:visible for corner handles.
      // aspect-ratio drives height so ReactFlow ResizeObserver auto-sizes the node.
      <div
        ref={rootRef}
        className={`node-card group${(data.hasError as boolean) ? " node-error-blink" : ""}`}
        style={{
          width: "100%",
          minWidth: 120,
          aspectRatio: ratio,
          background: "transparent",
        }}
        onAnimationEnd={(e) => { if (e.animationName === "node-error-blink") updateNodeData(id, { hasError: false }); }}
        onDrop={onDrop}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
        onContextMenu={e => { if (editable) { e.preventDefault(); e.stopPropagation(); openEditor(); } }}
      >
        {!readOnly && <CornerResizer minWidth={60} minHeight={60} keepAspectRatio />}
        <span className="node-above-label">{data.label as string}</span>

        {/* Inner: clips image to border-radius */}
        <div
          className="relative w-full h-full"
          style={{ borderRadius: 7, overflow: "hidden" }}
          onDoubleClick={openLightbox}
        >
          {/* Layer 1 — base image */}
          {baseSrc && (
            // Use <NextImage> only for confirmed R2 CDN URLs — third-party URLs skip
            // next/image optimization because /_next/image fetches server-side and fails
            // for URLs that have auth, IP allowlists, or expiry (e.g. Replicate links).
            baseSrc === (data.r2Url as string | undefined) ? (
              <NextImage
                ref={nodeImgRef}
                src={baseSrc}
                alt="Input"
                fill
                quality={30}
                sizes="600px"
                style={{
                  objectFit: "fill", zIndex: 1,
                  animation: isUploading ? "upload-pulse 1.6s ease-in-out infinite" : undefined,
                }}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={nodeImgRef}
                src={baseSrc}
                alt="Input"
                style={{
                  position: "absolute", inset: 0, width: "100%", height: "100%",
                  display: "block", objectFit: "fill", zIndex: 1,
                  animation: isUploading ? "upload-pulse 1.6s ease-in-out infinite" : undefined,
                }}
              />
            )
          )}

          {/* Layer 2 — incoming URL fades in on top, then gets promoted to base */}
          {topSrc && (
            <div
              key={topSrc}
              aria-hidden
              onTransitionEnd={() => {
                if (topSrc !== canonicalSrc) return;
                const oldBase = baseSrcRef.current;
                setBaseSrc(topSrc);
                baseSrcRef.current = topSrc!;
                setTopSrc(undefined);
                setTopReady(false);
                if (oldBase?.startsWith("blob:")) URL.revokeObjectURL(oldBase);
              }}
              style={{
                position: "absolute", inset: 0, zIndex: 2,
                opacity: topReady ? 1 : 0,
                transition: "opacity 450ms ease",
                pointerEvents: "none",
              }}
            >
              {topSrc === (data.r2Url as string | undefined) ? (
                <NextImage
                  src={topSrc}
                  alt=""
                  fill
                  quality={30}
                  sizes="600px"
                  style={{ objectFit: "fill" }}
                  onLoad={() => requestAnimationFrame(() => requestAnimationFrame(() => setTopReady(true)))}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={topSrc}
                  alt=""
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", objectFit: "fill" }}
                  onLoad={() => requestAnimationFrame(() => requestAnimationFrame(() => setTopReady(true)))}
                />
              )}
            </div>
          )}


          {/* Resolution badge */}
          {natW > 0 && natH > 0 && (
            <div
              aria-hidden
              className="absolute top-1.5 right-2 pointer-events-none select-none z-30 tabular-nums px-1.5 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-150 node-slide-reveal"
              style={{ fontSize: 9, lineHeight: 1, color: "#fff", background: "#1a1a1a" }}
            >
              {natW} × {natH}
            </div>
          )}

          {editable && (
            <div className="nodrag nopan absolute inset-x-0 bottom-0 z-30 flex justify-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-1 pb-2 pt-6"
              onDoubleClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
              <Button size="xs" variant="secondary" disabled={busy} onClick={e => { e.stopPropagation(); openEditor(); }}>
                <Pencil data-icon="inline-start" />Modifier l’image
              </Button>
              {genNodeCount > 0 && <Button size="icon-xs" variant="secondary" disabled={busy}
                title="Relancer les étapes connectées" aria-label="Relancer les étapes connectées"
                onClick={e => { e.stopPropagation(); if (DEMO_MODE) { useWorkflowStore.getState().setAuthModalOpen(true); return; } run(); }}>
                {pipelineRunning ? <Spinner /> : <Play />}
              </Button>}
            </div>
          )}
        </div>

        {/* Handle rendered last so it sits above the image div in stacking order */}
              <Handle
                type="source"
                position={Position.Right}
                style={{ top: "50%" }}
                className={`node-handle-icon node-handle-icon-out-image${sourceConnected ? " node-handle-connected" : ""}`}
                title="Image output"
              >
                <ImageOutIcon />
              </Handle>


        {editor}

        {/* Lightbox — full-quality view on double-click */}
        {lightboxOpen && typeof document !== "undefined" && createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center transition-opacity duration-200 ease-in-out"
            style={{ backgroundColor: `rgba(0,0,0,${lightboxVisible ? 0.9 : 0})`, opacity: lightboxVisible ? 1 : 0 }}
            onClick={closeLightbox}
          >
            <div
              className="relative transition-all duration-200 ease-in-out rounded-2xl overflow-hidden"
              style={{
                transform: lightboxVisible ? "scale(1)" : "scale(0.95)",
                boxShadow: "0 0 0 8px #3a3a3a",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Layer 1: full-res image */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={canonicalSrc}
                alt="Full quality"
                className="block max-w-[90vw] max-h-[90vh] object-contain"
                onLoad={() => setLightboxImgLoaded(true)}
              />

              {/* Layer 2: blur overlay — uses the already-cached node image, fades out once full-res loads */}
              {blurSrc && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={blurSrc}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  style={{
                    objectFit:  "cover",
                    filter:     "blur(24px)",
                    transform:  "scale(1.1)",
                    opacity:    lightboxImgLoaded ? 0 : 1,
                    transition: "opacity 300ms ease",
                  }}
                />
              )}
            </div>
          </div>,
          document.body
        )}
      </div>
    );
  }

  // Empty state — the same editor supports upload, URL and prompt generation.
  return (
    <div ref={rootRef} className="node-card w-full" style={{ minWidth: 200 }}
      onDrop={onDrop} onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
      onContextMenu={e => { if (editable) { e.preventDefault(); e.stopPropagation(); openEditor(); } }}>
      {!readOnly && <CornerResizer minWidth={160} minHeight={100} />}
      <span className="node-above-label">{data.label as string}</span>
      <Handle type="source" position={Position.Right} style={{ top: "50%" }} className="node-handle-icon node-handle-icon-out-image" title="Image output">
        <ImageOutIcon />
      </Handle>
      <div className="flex flex-col items-center gap-2 p-5">
        <p className="text-xs text-muted-foreground">Déposez votre image d’entrée ici</p>
        {editable && <Button className="nodrag nopan" variant="outline" size="sm" disabled={busy} onClick={() => openEditor()}>Choisir ou créer une image</Button>}
      </div>
      {editor}
    </div>
  );
}

function ImageOutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" fill="white" stroke="none" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}
