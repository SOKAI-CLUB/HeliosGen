"use client";

import { useEffect, useRef, useState } from "react";
import { CaptionsOff, Check, Download, Library, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { AddToAdLibraryDialog } from "@/components/ad-library/AddToAdLibraryDialog";
import { createClient } from "@/lib/supabase/client";
import { galleryCache, getToken, type GalleryItem } from "@/lib/galleryUtils";
import { useWorkflowStore } from "@/lib/store";
import { useVideoTextRemovalStore } from "@/lib/videoTextRemovalStore";
import { TEXT_REMOVAL_MODEL, TEXT_REMOVAL_TITLE, type TextRemovalJob } from "@/lib/videoTextRemoval";

async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  if (!token) throw new Error("Connecte-toi pour supprimer les sous-titres.");
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "Le service est momentanément indisponible. Réessaie dans un instant.");
  return payload as T;
}

function galleryItem(job: TextRemovalJob): GalleryItem {
  return { id: job.id, url: job.videoUrl!, mediaType: "video", model: TEXT_REMOVAL_MODEL, prompt: TEXT_REMOVAL_TITLE, source: "generation", created_at: job.createdAt };
}

export default function VideoTextRemovalManager() {
  const store = useVideoTextRemovalStore();
  const sessionVersion = useRef(0);
  const [libraryItem, setLibraryItem] = useState<GalleryItem | null>(null);

  useEffect(() => {
    let disposed = false;
    let owner: string | null | undefined;
    const restore = async (userId: string | null) => {
      if (owner === userId) return;
      owner = userId;
      const version = ++sessionVersion.current;
      useVideoTextRemovalStore.getState().reset();
      if (!userId) return;
      try {
        const { jobs } = await api<{ jobs: TextRemovalJob[] }>("/api/remove-video-text");
        if (!disposed && version === sessionVersion.current) jobs.forEach(useVideoTextRemovalStore.getState().updateJob);
      } catch { /* A new request can still be opened if recovery is temporarily unavailable. */ }
    };
    if (process.env.NEXT_PUBLIC_GUEST_MODE === "true") {
      void restore("guest");
      return () => { disposed = true; };
    }
    const client = createClient();
    void client.auth.getSession().then(({ data }) => { if (!disposed) void restore(data.session?.user.id ?? null); });
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      // Supabase auth callbacks must not await another auth operation.
      queueMicrotask(() => { if (!disposed) void restore(session?.user.id ?? null); });
    });
    return () => { disposed = true; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const version = sessionVersion.current;
      const pending = useVideoTextRemovalStore.getState().jobs.filter((job) => job.status === "pending");
      await Promise.all(pending.map(async (job) => {
        try {
          const next = await api<TextRemovalJob>(`/api/remove-video-text?jobId=${job.id}`);
          if (disposed || version !== sessionVersion.current) return;
          const state = useVideoTextRemovalStore.getState();
          const previous = state.jobs.find((entry) => entry.id === next.id);
          state.updateJob({ ...next, error: next.status === "error" ? next.error : undefined });
          if (next.status === "done" && previous?.status !== "done") {
            const item = galleryItem(next);
            const cached = galleryCache.get("videos-generation");
            if (cached) galleryCache.set("videos-generation", { ...cached, items: [item, ...cached.items.filter((entry) => entry.id !== item.id)] });
            window.dispatchEvent(new Event("gallery-updated"));
            useWorkflowStore.getState().addToast("La vidéo sans sous-titres est prête.", "success", "/gallery?tab=videos&source=generated", "Vidéo enregistrée");
          } else if (next.status === "error" && previous?.status !== "error") {
            useWorkflowStore.getState().addToast(next.error ?? "Le traitement a échoué.", "error");
          }
        } catch (error) {
          if (!disposed && version === sessionVersion.current) {
            useVideoTextRemovalStore.getState().updateJob({ ...job, error: error instanceof Error ? error.message : "Suivi temporairement indisponible." });
          }
        }
      }));
      if (!disposed) timer = setTimeout(poll, 4000);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, []);

  const pending = store.jobs.filter((job) => job.status === "pending");
  const latest = store.jobs.at(-1);
  const job = store.jobs.find((entry) => entry.id === store.selectedId);
  return <>
    {!store.open && latest && (
      <div className="fixed right-4 bottom-4 z-40 flex items-center gap-1">
        <Button variant="secondary" onClick={() => store.select((pending[0] ?? latest).id)}>
          {pending.length ? <Spinner data-icon="inline-start" /> : <CaptionsOff data-icon="inline-start" />}
          {pending.length ? `Sous-titres · ${pending.length} en cours` : latest.status === "done" ? "Voir la vidéo nettoyée" : "Voir le traitement"}
        </Button>
        {!pending.length && <Button size="icon" variant="secondary" aria-label="Masquer le traitement terminé" onClick={() => store.dismiss(latest.id)}><X /></Button>}
      </div>
    )}
    {store.open && <RemovalDialog key={store.selectedId ?? store.target.url ?? "upload"} job={job} onAddToLibrary={(item) => { store.close(); setLibraryItem(item); }} />}
    <AddToAdLibraryDialog item={libraryItem} onClose={() => setLibraryItem(null)} onAdded={() => {
      useWorkflowStore.getState().addToast("Vidéo ajoutée à la bibliothèque publicitaire.", "success");
      window.dispatchEvent(new Event("ad-library-updated"));
    }} />
  </>;
}

function RemovalDialog({ job, onAddToLibrary }: { job?: TextRemovalJob; onAddToLibrary: (item: GalleryItem) => void }) {
  const { target, close, updateJob, jobs } = useVideoTextRemovalStore();
  const [file, setFile] = useState<File | null>(null);
  const [localUrl, setLocalUrl] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const submitLock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const sourceUrl = job?.sourceUrl ?? target.url ?? localUrl;
  const videoUrl = job?.videoUrl && !showOriginal ? job.videoUrl : sourceUrl;
  const pending = job?.status === "pending";

  useEffect(() => {
    return () => { if (localUrl) URL.revokeObjectURL(localUrl); };
  }, [localUrl]);

  useEffect(() => {
    let active = true;
    api<{ configured: boolean }>("/api/remove-video-text?configuration=1")
      .then((data) => { if (active) setConfigured(data.configured); })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Configuration indisponible."); });
    return () => { active = false; };
  }, []);

  const start = async () => {
    if (submitLock.current || !configured || (!file && !target.url)) return;
    submitLock.current = true;
    setSubmitting(true);
    setError("");
    try {
      let url = target.url;
      if (file) {
        setStage("Import de la vidéo…");
        const uploaded = await api<{ cdnUrl: string }>("/api/upload-video", { method: "POST", headers: { "Content-Type": file.type }, body: file });
        url = uploaded.cdnUrl;
      }
      setStage("Lancement du traitement…");
      const result = await api<TextRemovalJob>("/api/remove-video-text", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: requestId.current, videoUrl: url }),
      });
      updateJob({ ...result, sourceUrl: url });
      // Keep onUse attached to this request until the result is explicitly selected.
      useVideoTextRemovalStore.setState((state) => ({ selectedId: result.id, jobTargets: { ...state.jobTargets, [result.id]: target } }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Le traitement n’a pas pu démarrer.");
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };

  return <Dialog open onOpenChange={(open) => { if (!open && !submitting) close(); }}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl" showCloseButton={!submitting}>
      <DialogHeader>
        <DialogTitle>{job?.status === "done" ? "La vidéo sans sous-titres est prête" : "Supprimer les sous-titres"}</DialogTitle>
        <DialogDescription>
          {job?.status === "done" ? "Une nouvelle vidéo a été enregistrée dans l’onglet Vidéo." : "Efface les sous-titres incrustés dans l’image et conserve une copie de la vidéo d’origine. Les autres textes visibles peuvent aussi être effacés."}
        </DialogDescription>
      </DialogHeader>
      {videoUrl ? <video key={videoUrl} src={videoUrl} controls playsInline preload="metadata" className="max-h-[45dvh] w-full rounded-lg bg-muted object-contain" /> : (
        <Button variant="outline" className="h-40 w-full flex-col gap-3" onClick={() => fileInput.current?.click()} disabled={submitting}>
          <Upload data-icon="inline-start" /> Choisir une vidéo · 100 Mo maximum
        </Button>
      )}
      {!job && !target.url && <>
        <input ref={fileInput} type="file" accept="video/*" className="sr-only" aria-label="Importer une vidéo pour supprimer ses sous-titres" onChange={(event) => {
          const selected = event.target.files?.[0];
          event.target.value = "";
          if (!selected) return;
          if (!selected.type.startsWith("video/")) { setError("Sélectionne un fichier vidéo."); return; }
          if (!selected.size || selected.size > 100 * 1024 * 1024) { setError("La vidéo doit peser entre 1 octet et 100 Mo."); return; }
          setFile(selected); setLocalUrl(URL.createObjectURL(selected)); setError(""); requestId.current = crypto.randomUUID();
        }} />
        {file && <Button variant="outline" disabled={submitting} onClick={() => fileInput.current?.click()}>Changer de vidéo</Button>}
      </>}
      {configured === false && !job && <p role="status" className="text-sm text-muted-foreground">La suppression sera disponible dès que le token Replicate aura été configuré par l’administrateur.</p>}
      {(error || job?.error) && <p role="alert" className="text-sm text-destructive">{error || job?.error}{pending && " Le suivi reprendra automatiquement."}</p>}
      {pending && <div role="status" aria-live="polite" className="flex flex-col gap-2">
        <p className="flex items-center gap-2 text-sm"><Spinner /> {job.phase === "processing" ? `Suppression des sous-titres${job.progress !== undefined ? ` · ${job.progress} %` : "…"}` : "Préparation du traitement…"}</p>
        <p className="text-sm text-muted-foreground">Cela peut prendre plusieurs minutes. Tu peux fermer cette fenêtre et continuer à naviguer.</p>
      </div>}
      {job?.status === "done" && sourceUrl && <Button variant="outline" onClick={() => setShowOriginal((value) => !value)}>{showOriginal ? "Voir le résultat" : "Comparer avec l’original"}</Button>}
      <DialogFooter className="flex-wrap">
        <Button variant="outline" disabled={submitting} onClick={close}>{pending ? "Continuer à naviguer" : "Fermer"}</Button>
        {!job && <Button disabled={configured !== true || submitting || (!target.url && !file)} onClick={() => void start()}>
          {submitting ? <Spinner data-icon="inline-start" /> : <CaptionsOff data-icon="inline-start" />}
          {submitting ? stage : "Supprimer les sous-titres"}
        </Button>}
        {job?.status === "error" && sourceUrl && <Button onClick={() => useVideoTextRemovalStore.getState().show({ url: sourceUrl })}>Réessayer</Button>}
        {job?.status === "done" && job.videoUrl && <>
          {target.onUse && <Button onClick={() => { target.onUse?.(job.videoUrl!); close(); }}><Check data-icon="inline-start" /> Utiliser cette vidéo</Button>}
          <Button variant="outline" onClick={() => onAddToLibrary(galleryItem(job))}><Library data-icon="inline-start" /> Ajouter au B-roll</Button>
          <Button render={<a href={`/api/download?url=${encodeURIComponent(job.videoUrl)}&filename=video-sans-sous-titres.mp4`} download />}><Download data-icon="inline-start" /> Télécharger</Button>
        </>}
      </DialogFooter>
      {jobs.filter((entry) => entry.status === "pending" && entry.id !== job?.id).length > 0 && <div className="flex flex-wrap gap-2">
        {jobs.filter((entry) => entry.status === "pending" && entry.id !== job?.id).map((entry, index) => <Button key={entry.id} size="sm" variant="ghost" onClick={() => useVideoTextRemovalStore.getState().select(entry.id)}><Spinner data-icon="inline-start" /> Traitement {index + 1}</Button>)}
      </div>}
    </DialogContent>
  </Dialog>;
}
