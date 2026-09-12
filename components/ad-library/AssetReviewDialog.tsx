"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CaptionsOff, Check, CheckCheck, Clock3, Download, Maximize, MessageSquare, MoreHorizontal, Pause, Pencil, Play, Reply, RotateCcw, Send, Trash2, Volume2, VolumeX, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fetchAdLibraryReview, mutateAdLibraryReview, type AdLibraryAsset, type AdLibraryTag } from "@/lib/adLibrary";
import { formatTimecode, MAX_COMMENT_LENGTH, type AdLibraryComment, type AdLibraryReview, type ReviewMutation } from "@/lib/adLibraryReview";
import { cn } from "@/lib/utils";

interface Props {
  asset: AdLibraryAsset;
  title: string;
  tags: AdLibraryTag[];
  onClose: () => void;
  onEdit: () => void;
  onDownload: () => void;
  onRemoveSubtitles: () => void;
}

export default function AssetReviewDialog({ asset, title, tags, onClose, onEdit, onDownload, onRemoveSubtitles }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const requestVersion = useRef(0);
  const busyRef = useRef(false);
  const [review, setReview] = useState<AdLibraryReview>({ comments: [], currentUserId: "" });
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState("");
  const [draftTime, setDraftTime] = useState<number | null>(null);
  const [attachTime, setAttachTime] = useState(true);
  const [replyTo, setReplyTo] = useState<AdLibraryComment | null>(null);
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("timecode");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const isVideo = asset.mediaType === "video";

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const version = ++requestVersion.current;
    try {
      const data = await fetchAdLibraryReview(asset.id, signal);
      if (version !== requestVersion.current || signal?.aborted) return;
      setReview(data);
      setSyncError("");
    } catch (error) {
      if (signal?.aborted || version !== requestVersion.current) return;
      setSyncError(error instanceof Error ? error.message : "Impossible de charger les commentaires.");
    } finally {
      if (version === requestVersion.current && !signal?.aborted) setLoading(false);
    }
  }, [asset.id]);

  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    const sync = async () => {
      if (document.hidden || busyRef.current || inFlight) return;
      inFlight = true;
      await refresh(controller.signal);
      inFlight = false;
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 5000);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [refresh]);

  const threads = useMemo(() => review.comments.filter((comment) => !comment.parentId), [review.comments]);
  const openCount = threads.filter((comment) => !comment.resolved).length;
  const visibleThreads = useMemo(() => threads.filter((comment) => filter === "all" || (filter === "resolved" ? comment.resolved : !comment.resolved))
    .sort((a, b) => sort === "recent" ? b.createdAt.localeCompare(a.createdAt)
      : (a.timecode ?? Infinity) - (b.timecode ?? Infinity) || a.createdAt.localeCompare(b.createdAt)), [threads, filter, sort]);

  const seek = (time: number) => {
    const video = videoRef.current;
    if (!video || !duration) return;
    video.pause();
    video.currentTime = Math.min(duration, Math.max(0, time));
    setCurrentTime(video.currentTime);
  };

  const selectComment = (comment: AdLibraryComment) => {
    setSelectedId(comment.id);
    if (comment.timecode !== null) seek(comment.timecode);
    document.getElementById(`review-comment-${comment.id}`)?.scrollIntoView({ block: "nearest" });
  };

  const captureTime = () => {
    videoRef.current?.pause();
    const time = videoRef.current?.currentTime ?? 0;
    setDraftTime(time);
    setAttachTime(true);
  };

  const mutate = async (mutation: ReviewMutation) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    ++requestVersion.current; // A poll started before this write must not replace its result.
    setBusy(true);
    setActionError("");
    try {
      await mutateAdLibraryReview(asset.id, mutation);
      await refresh();
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Impossible d’enregistrer le commentaire.");
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!body.trim() || busyRef.current) return;
    const success = await mutate({ action: "create", body: body.trim(), parentId: replyTo?.id ?? null,
      timecode: isVideo && attachTime && !replyTo ? draftTime ?? currentTime : null });
    if (success) {
      setBody(""); setDraftTime(null); setReplyTo(null); setFilter("all");
    }
  };

  const leave = (action = onClose) => {
    if (busyRef.current) return;
    if (body.trim() && !window.confirm("Quitter sans envoyer votre commentaire ?")) return;
    action();
  };

  const removeComment = async (comment: AdLibraryComment) => {
    const hasReplies = review.comments.some((entry) => entry.parentId === comment.id);
    if (!window.confirm(hasReplies ? "Supprimer votre commentaire et ses réponses ?" : "Supprimer votre commentaire ?")) return;
    if (await mutate({ action: "delete", commentId: comment.id })) {
      if (replyTo?.id === comment.id) setReplyTo(null);
    }
  };

  const startReply = (comment: AdLibraryComment) => {
    if (body.trim() && !window.confirm("Remplacer le commentaire en cours par une réponse ?")) return;
    setBody(""); setReplyTo(comment); selectComment(comment); inputRef.current?.focus();
  };

  const renderComment = (comment: AdLibraryComment, reply = false) => (
    <div key={comment.id} className={cn("flex gap-3", reply && "ml-3 border-l border-border pl-4 pt-4")}>
      <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-primary">
        {comment.authorName.slice(0, 2).toLocaleUpperCase()}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-xs font-semibold">{comment.authorName}</span>
          <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString("fr-FR")} className="text-[11px] text-muted-foreground">
            {new Date(comment.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
          </time>
          {comment.authorId === review.currentUserId && <Button aria-label="Supprimer mon commentaire" title="Supprimer mon commentaire" size="icon-xs" variant="ghost" className="ml-auto" disabled={busy} onClick={() => void removeComment(comment)}><Trash2 /></Button>}
        </div>
        {comment.timecode !== null && <Button size="sm" variant="secondary" className="w-fit font-mono" disabled={!duration} onClick={() => selectComment(comment)}><Clock3 data-icon="inline-start" />{formatTimecode(comment.timecode)}</Button>}
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{comment.body}</p>
        {!reply && <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => startReply(comment)}><Reply data-icon="inline-start" />Répondre</Button>
          <Button size="sm" variant={comment.resolved ? "secondary" : "ghost"} aria-pressed={comment.resolved} disabled={busy}
            onClick={() => void mutate({ action: "resolve", commentId: comment.id, resolved: !comment.resolved })}>
            {comment.resolved ? <CheckCheck data-icon="inline-start" /> : <Check data-icon="inline-start" />}{comment.resolved ? "Résolu · rouvrir" : "Résoudre"}
          </Button>
        </div>}
      </div>
    </div>
  );

  return <Dialog open onOpenChange={(open) => { if (!open) leave(); }}>
    <DialogContent className="ad-review-dialog flex h-[min(900px,94dvh)] max-h-[94dvh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1600px]" showCloseButton={false}>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 lg:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary"><MessageSquare className="size-4" /></div>
          <div className="min-w-0">
            <DialogTitle className="truncate leading-normal">{title}</DialogTitle>
            <DialogDescription>Bibliothèque partagée <span aria-hidden="true">/</span> Revue collaborative</DialogDescription>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="lg:hidden"><DropdownMenu>
            <DropdownMenuTrigger render={<Button aria-label="Actions du média" size="icon" variant="ghost" disabled={busy} />}><MoreHorizontal /></DropdownMenuTrigger>
            <DropdownMenuContent align="end"><DropdownMenuGroup>
              <DropdownMenuItem onClick={() => leave(onEdit)}><Pencil />Modifier le média</DropdownMenuItem>
              {isVideo && <DropdownMenuItem onClick={() => leave(onRemoveSubtitles)}><CaptionsOff />Supprimer les sous-titres</DropdownMenuItem>}
            </DropdownMenuGroup></DropdownMenuContent>
          </DropdownMenu></div>
          <Button onClick={onDownload} size="icon" variant="outline" aria-label="Télécharger le média" title="Télécharger"><Download /></Button>
          <Button onClick={() => leave()} size="icon" variant="ghost" aria-label="Fermer la revue" disabled={busy}><X /></Button>
        </div>
      </header>

      <div className="ad-review-layout grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div ref={stageRef} className="flex min-h-0 min-w-0 flex-col bg-background">
          <div className="ad-review-stage relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3 lg:p-6">
            {isVideo ? <video ref={videoRef} className="h-full w-full object-contain" src={asset.url} playsInline preload="metadata"
              onLoadedMetadata={(event) => { const value = event.currentTarget.duration; setDuration(Number.isFinite(value) ? value : 0); }}
              onDurationChange={(event) => { const value = event.currentTarget.duration; if (Number.isFinite(value)) setDuration(value); }}
              onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
              onError={() => setMediaError("La vidéo ne peut pas être lue. Vous pouvez la télécharger ou réessayer.")}
            /> : (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="max-h-full max-w-full object-contain" src={asset.url} alt={title} onError={() => setMediaError("Impossible de charger cette image.")} />
            )}
            {mediaError && <div role="alert" className="absolute inset-x-4 bottom-4 rounded-lg border border-border bg-popover p-3 text-sm">{mediaError}</div>}
          </div>
          {isVideo && <div className="flex shrink-0 flex-col gap-2 border-y border-border bg-card px-4 py-3 lg:px-6">
            <div className="relative mx-2 h-5" aria-label="Repères des commentaires">
              {visibleThreads.filter((comment) => comment.timecode !== null).map((comment) => <button key={comment.id} type="button"
                disabled={!duration} aria-label={`Commentaire à ${formatTimecode(comment.timecode!)} : ${comment.body}`}
                title={`${formatTimecode(comment.timecode!)} · ${comment.authorName} : ${comment.body}`}
                className={cn("ad-review-marker absolute top-0 flex size-5 -translate-x-1/2 items-center justify-center rounded-full border-2 outline-none focus-visible:ring-2 focus-visible:ring-ring", comment.resolved ? "border-muted-foreground bg-secondary text-foreground" : "border-primary bg-primary text-primary-foreground", selectedId === comment.id && "ring-2 ring-ring ring-offset-2 ring-offset-background")}
                style={{ left: `${duration ? Math.min(100, comment.timecode! / duration * 100) : 0}%` }} onClick={() => selectComment(comment)}>
                {comment.resolved ? <Check className="size-3" /> : <MessageSquare className="size-2.5" />}
              </button>)}
            </div>
            <input aria-label="Position de lecture" aria-valuetext={`${formatTimecode(currentTime)} sur ${formatTimecode(duration)}`} type="range" min={0} max={duration || 1} step={0.01}
              value={currentTime} disabled={!duration} onChange={(event) => seek(Number(event.target.value))} className="ad-review-scrubber w-full cursor-pointer accent-primary" />
            <div className="flex flex-wrap items-center gap-2">
              <Button aria-label={playing ? "Mettre en pause" : "Lire la vidéo"} disabled={!duration || Boolean(mediaError)} size="icon" variant="secondary"
                onClick={() => { const video = videoRef.current; if (!video) return; if (video.paused) void video.play().catch(() => setMediaError("Lecture impossible. Réessayez en rouvrant le média.")); else video.pause(); }}>
                {playing ? <Pause /> : <Play />}
              </Button>
              <Button aria-label="Reculer de 0,1 seconde" title="Reculer de 0,1 s" size="sm" variant="ghost" disabled={!duration} onClick={() => seek(currentTime - 0.1)}>−0,1 s</Button>
              <Button aria-label="Avancer de 0,1 seconde" title="Avancer de 0,1 s" size="sm" variant="ghost" disabled={!duration} onClick={() => seek(currentTime + 0.1)}>+0,1 s</Button>
              <span className="font-mono text-xs tabular-nums">{formatTimecode(currentTime)} <span className="text-muted-foreground">/ {formatTimecode(duration)}</span></span>
              <div className="ml-auto flex items-center gap-1">
                <select aria-label="Vitesse de lecture" className="rounded-md border border-border bg-card px-1 py-1 text-xs" defaultValue="1" onChange={(event) => { if (videoRef.current) videoRef.current.playbackRate = Number(event.target.value); }}>
                  {[0.25, 0.5, 1, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
                </select>
                <Button aria-label={muted ? "Activer le son" : "Couper le son"} size="icon-sm" variant="ghost" onClick={() => { if (videoRef.current) { videoRef.current.muted = !muted; setMuted(!muted); } }}>{muted ? <VolumeX /> : <Volume2 />}</Button>
                <Button aria-label="Afficher la vidéo en plein écran" size="icon-sm" variant="ghost" onClick={() => {
                  const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
                  if (document.fullscreenElement) void document.exitFullscreen();
                  else if (stageRef.current?.requestFullscreen) void stageRef.current.requestFullscreen().catch(() => setMediaError("Le plein écran n’est pas disponible dans ce navigateur."));
                  else video?.webkitEnterFullscreen?.();
                }}><Maximize /></Button>
              </div>
            </div>
          </div>}
          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-6">
            <div className="flex flex-wrap items-center gap-1.5">{tags.map((tag) => <Badge key={tag.id} variant="secondary">{tag.name}</Badge>)}</div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => leave(onEdit)} disabled={busy}><Pencil data-icon="inline-start" />Modifier</Button>
              {isVideo && <Button size="sm" variant="ghost" onClick={() => leave(onRemoveSubtitles)} disabled={busy}><CaptionsOff data-icon="inline-start" />Supprimer les sous-titres</Button>}
            </div>
          </footer>
        </div>

        <aside className="flex min-h-0 flex-col border-t border-border bg-card lg:border-t-0 lg:border-l" aria-label="Commentaires de l’équipe">
          <div className="flex shrink-0 flex-col gap-3 border-b border-border p-4">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold">Commentaires <Badge variant="secondary">{threads.length}</Badge></h2>
              <Button aria-label="Actualiser les commentaires" title="Actualiser les commentaires" size="icon-xs" variant="ghost" disabled={busy} onClick={() => void refresh()}><RotateCcw /></Button>
            </div>
            <ToggleGroup aria-label="Filtrer les commentaires" value={[filter]} onValueChange={(values) => setFilter(values[0] ?? "all")} variant="selection" size="sm" spacing={0}>
              <ToggleGroupItem value="all">Tous</ToggleGroupItem>
              <ToggleGroupItem value="open">À traiter · {openCount}</ToggleGroupItem>
              <ToggleGroupItem value="resolved">Résolus · {threads.length - openCount}</ToggleGroupItem>
            </ToggleGroup>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{syncError ? "Synchronisation interrompue" : loading ? "Chargement…" : "Actualisation automatique"}</span>
              <select aria-label="Trier les commentaires" value={sort} onChange={(event) => setSort(event.target.value)} className="max-w-32 rounded border border-border bg-card px-1 py-1 text-foreground">
                <option value="timecode">{isVideo ? "Par timecode" : "Plus anciens"}</option><option value="recent">Plus récents</option>
              </select>
            </div>
          </div>
          {syncError && <div role="alert" className="border-b border-border bg-destructive/10 p-3 text-xs text-destructive">{syncError}</div>}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
            {loading ? <div className="flex flex-col gap-4 p-2">{[0, 1, 2].map((n) => <Skeleton key={n} className="h-24 w-full rounded-lg" />)}</div>
              : visibleThreads.length === 0 ? <Empty className="min-h-48 p-4">
                <EmptyHeader><EmptyMedia variant="icon"><MessageSquare /></EmptyMedia>
                  <EmptyTitle>{syncError ? "Commentaires indisponibles" : threads.length ? "Aucun retour dans cette vue" : "Le regard de l’équipe commence ici"}</EmptyTitle>
                  <EmptyDescription>{syncError ? "Actualisez pour réessayer." : threads.length ? "Changez de filtre pour retrouver les autres discussions." : isVideo ? "Arrêtez-vous sur un passage et laissez votre premier retour." : "Partagez votre premier retour sur cette image."}</EmptyDescription>
                </EmptyHeader>
              </Empty> : <div className="flex flex-col gap-2">{visibleThreads.map((comment) => <article id={`review-comment-${comment.id}`} key={comment.id}
                className={cn("rounded-xl border p-3 transition-colors", selectedId === comment.id ? "border-primary/60 bg-primary/5" : "border-border bg-background/40")}>
                {renderComment(comment)}
                {review.comments.filter((entry) => entry.parentId === comment.id).map((entry) => renderComment(entry, true))}
              </article>)}</div>}
          </div>
          <form className="flex shrink-0 flex-col gap-3 border-t border-border bg-popover p-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            {replyTo && <div className="flex items-center justify-between gap-2 text-xs text-primary"><span className="truncate">Réponse à {replyTo.authorName}</span><Button aria-label="Annuler la réponse" size="icon-xs" variant="ghost" disabled={busy} onClick={() => setReplyTo(null)}><X /></Button></div>}
            <Field>
              <FieldLabel htmlFor="review-comment" className="sr-only">{replyTo ? "Votre réponse" : "Votre commentaire"}</FieldLabel>
              <textarea id="review-comment" ref={inputRef} value={body} disabled={busy || !review.currentUserId} maxLength={MAX_COMMENT_LENGTH} rows={3}
                placeholder={replyTo ? "Ajouter une réponse…" : isVideo ? "Votre retour sur ce passage…" : "Votre retour sur cette image…"}
                className="min-h-20 w-full resize-none rounded-xl border border-input bg-background p-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"
                onFocus={() => { videoRef.current?.pause(); if (draftTime === null && !replyTo && duration) captureTime(); }}
                onChange={(event) => setBody(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }}
              />
            </Field>
            {actionError && <p role="alert" className="text-xs text-destructive">{actionError}</p>}
            <div className="flex items-center justify-between gap-2">
              {isVideo && !replyTo ? <div className="flex items-center gap-1">
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input type="checkbox" className="size-3.5 accent-primary" checked={attachTime} disabled={busy} onChange={(event) => { setAttachTime(event.target.checked); if (event.target.checked && draftTime === null) captureTime(); }} />
                  <span className={cn("font-mono tabular-nums", attachTime ? "text-primary" : "text-muted-foreground")}>{attachTime ? formatTimecode(draftTime ?? currentTime) : "Sans timecode"}</span>
                </label>
                <Button type="button" aria-label="Utiliser la position actuelle" title="Utiliser la position actuelle de la vidéo" size="icon-xs" variant="ghost" disabled={!duration || busy} onClick={captureTime}><Clock3 /></Button>
              </div> : <span className="text-xs text-muted-foreground">{replyTo ? "Dans la discussion" : "Visible par l’équipe"}</span>}
              <Button type="submit" disabled={busy || !body.trim() || !review.currentUserId || (isVideo && attachTime && !replyTo && !duration)}>
                {busy ? <Spinner data-icon="inline-start" /> : <Send data-icon="inline-start" />}Envoyer
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">{body.length > 3500 ? `${body.length} / ${MAX_COMMENT_LENGTH} caractères` : "⌘ / Ctrl + Entrée pour envoyer"}</p>
          </form>
        </aside>
      </div>
    </DialogContent>
  </Dialog>;
}
