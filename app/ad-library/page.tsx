"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowUpRight,
  CaptionsOff,
  Check,
  Download,
  Film,
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  Library,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Search,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  UsersRound,
  Video,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  fetchAdLibrary,
  mutateAdLibrary,
  type AdLibraryAsset,
  type AdLibraryData,
} from "@/lib/adLibrary";
import { getToken } from "@/lib/galleryUtils";
import { openVideoTextRemoval } from "@/lib/videoTextRemovalStore";

type MediaFilter = "all" | "video" | "image";
type FolderSelection = "all" | "unfiled" | string;

const emptyLibrary: AdLibraryData = {
  folders: [],
  assets: [],
  tags: [],
  permissions: { canDeleteAssets: false },
};

function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return minutes > 0 ? `${minutes}:${String(remainder).padStart(2, "0")}` : `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
}

function assetLabel(asset: AdLibraryAsset): string {
  if (asset.title) return asset.title;
  const date = new Date(asset.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  return `${asset.mediaType === "video" ? "B-roll" : "Image"} · ${date}`;
}

function downloadAsset(asset: AdLibraryAsset) {
  const link = document.createElement("a");
  link.href = `/api/download?url=${encodeURIComponent(asset.url)}&filename=${encodeURIComponent(assetLabel(asset))}`;
  link.download = "";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export default function AdLibraryPage() {
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const [library, setLibrary] = useState<AdLibraryData>(emptyLibrary);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [selectedFolderId, setSelectedFolderId] = useState<FolderSelection>("all");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [folderDialog, setFolderDialog] = useState<{ mode: "create" | "rename"; folderId?: string; value: string } | null>(null);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [previewAsset, setPreviewAsset] = useState<AdLibraryAsset | null>(null);
  const [editingAsset, setEditingAsset] = useState<AdLibraryAsset | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editFolderId, setEditFolderId] = useState<string | null>(null);
  const [editTagIds, setEditTagIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      setLibrary(await fetchAdLibrary());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    const refresh = () => void load();
    window.addEventListener("ad-library-updated", refresh);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("ad-library-updated", refresh);
    };
  }, [load]);

  const beginEditAsset = (asset: AdLibraryAsset) => {
    setEditTitle(asset.title ?? "");
    setEditFolderId(asset.folderId);
    setEditTagIds(asset.tagIds);
    setEditingAsset(asset);
  };

  const visibleAssets = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return library.assets.filter((asset) => {
      if (selectedFolderId === "unfiled" && asset.folderId !== null) return false;
      if (selectedFolderId !== "all" && selectedFolderId !== "unfiled" && asset.folderId !== selectedFolderId) return false;
      if (mediaFilter !== "all" && asset.mediaType !== mediaFilter) return false;
      if (selectedTagIds.length > 0 && !selectedTagIds.every((tagId) => asset.tagIds.includes(tagId))) return false;
      if (!normalizedSearch) return true;
      const tagNames = library.tags
        .filter((tag) => asset.tagIds.includes(tag.id))
        .map((tag) => tag.name)
        .join(" ");
      return `${assetLabel(asset)} ${tagNames}`.toLocaleLowerCase().includes(normalizedSearch);
    });
  }, [library.assets, library.tags, mediaFilter, search, selectedFolderId, selectedTagIds]);

  const selectedFolderName = selectedFolderId === "all"
    ? "Tous les médias"
    : selectedFolderId === "unfiled"
      ? "Sans dossier"
      : library.folders.find((folder) => folder.id === selectedFolderId)?.name ?? "Dossier";

  const videoCount = useMemo(
    () => library.assets.filter((asset) => asset.mediaType === "video").length,
    [library.assets],
  );
  const imageCount = library.assets.length - videoCount;

  const runMutation = async (mutation: Parameters<typeof mutateAdLibrary>[0]) => {
    setSaving(true);
    setError("");
    try {
      const nextLibrary = await mutateAdLibrary<AdLibraryData>(mutation);
      setLibrary(nextLibrary);
      return nextLibrary;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const saveFolder = async () => {
    if (!folderDialog?.value.trim()) return;
    const mutation = folderDialog.mode === "create"
      ? { action: "create-folder" as const, name: folderDialog.value }
      : { action: "rename-folder" as const, folderId: folderDialog.folderId!, name: folderDialog.value };
    const next = await runMutation(mutation);
    if (next) setFolderDialog(null);
  };

  const deleteFolder = async (folderId: string, name: string) => {
    if (!window.confirm(`Supprimer le dossier « ${name} » ? Ses médias seront conservés sans dossier.`)) return;
    const next = await runMutation({ action: "delete-folder", folderId });
    if (next && selectedFolderId === folderId) setSelectedFolderId("all");
  };

  const createTag = async () => {
    const name = newTagName.trim();
    if (!name) return;
    const next = await runMutation({ action: "create-tag", name });
    if (next) setNewTagName("");
  };

  const deleteTag = async (tagId: string, name: string) => {
    if (!window.confirm(`Supprimer le tag « ${name} » ?`)) return;
    const next = await runMutation({ action: "delete-tag", tagId });
    if (next) setSelectedTagIds((current) => current.filter((id) => id !== tagId));
  };

  const saveAsset = async () => {
    if (!editingAsset) return;
    setSaving(true);
    setError("");
    try {
      await mutateAdLibrary({ action: "rename-asset", assetId: editingAsset.id, title: editTitle.trim() || null });
      await mutateAdLibrary({ action: "move-asset", assetId: editingAsset.id, folderId: editFolderId });
      const next = await mutateAdLibrary<AdLibraryData>({ action: "set-asset-tags", assetId: editingAsset.id, tagIds: editTagIds });
      setLibrary(next);
      setEditingAsset(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const deleteAsset = async (asset: AdLibraryAsset) => {
    if (!library.permissions.canDeleteAssets) {
      setError("Seuls Quentin et Axel peuvent supprimer un B-roll.");
      return;
    }
    if (!window.confirm(`Retirer « ${assetLabel(asset)} » de la bibliothèque ?`)) return;
    const next = await runMutation({ action: "delete-asset", assetId: asset.id });
    if (next) {
      if (previewAsset?.id === asset.id) setPreviewAsset(null);
      if (editingAsset?.id === asset.id) setEditingAsset(null);
    }
  };

  const uploadFiles = async (files: FileList) => {
    if (files.length === 0 || uploading) return;
    setUploading(true);
    setError("");
    try {
      const token = await getToken();
      let nextLibrary = library;
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) continue;
        const uploadResponse = await fetch("/api/upload-asset", {
          method: "POST",
          headers: {
            "Content-Type": file.type,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: file,
        });
        const uploadPayload = await uploadResponse.json() as { cdnUrl?: string; error?: string };
        if (!uploadResponse.ok || !uploadPayload.cdnUrl) {
          throw new Error(uploadPayload.error ?? `Impossible d’importer ${file.name}.`);
        }
        nextLibrary = await mutateAdLibrary<AdLibraryData>({
          action: "add-asset",
          folderId: selectedFolderId !== "all" && selectedFolderId !== "unfiled" ? selectedFolderId : null,
          sourceType: "library_upload",
          mediaType: file.type.startsWith("video/") ? "video" : "image",
          url: uploadPayload.cdnUrl,
          title: file.name.replace(/\.[^.]+$/, ""),
        });
      }
      setLibrary(nextLibrary);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const sendToGallery = (asset: AdLibraryAsset, tab: "images" | "videos") => {
    localStorage.setItem("hg-ad-library-transfer", JSON.stringify({
      id: asset.id,
      url: asset.url,
      mediaType: asset.mediaType,
      title: assetLabel(asset),
    }));
    router.push(`/gallery?tab=${tab}`);
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="relative overflow-hidden border-b bg-muted/10 px-5 py-5 lg:px-7 lg:py-6">
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 right-12 size-64 rounded-full bg-primary/10 blur-3xl"
          animate={prefersReducedMotion ? undefined : { x: [0, 36, 0], y: [0, 18, 0], scale: [1, 1.08, 1] }}
          transition={prefersReducedMotion ? undefined : { duration: 14, ease: "easeInOut", repeat: Infinity }}
        />
        <div className="relative flex flex-col gap-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <motion.div
              className="flex max-w-2xl flex-col gap-2"
              initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            >
              <Badge className="mb-1" variant="outline">
                <UsersRound data-icon="inline-start" />
                Bibliothèque partagée
              </Badge>
              <div className="flex items-center gap-2">
                <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                  <Library />
                </div>
                <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">Bibliothèque publicitaire</h1>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">Centralisez les rushs de l’équipe, classez-les et réutilisez-les dans vos prochaines créations.</p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Badge variant="secondary"><Film data-icon="inline-start" /> {library.assets.length} média{library.assets.length > 1 ? "s" : ""}</Badge>
                <Badge variant="secondary"><Video data-icon="inline-start" /> {videoCount} vidéo{videoCount > 1 ? "s" : ""}</Badge>
                <Badge variant="secondary"><ImageIcon data-icon="inline-start" /> {imageCount} image{imageCount > 1 ? "s" : ""}</Badge>
              </div>
            </motion.div>

            <motion.div
              className="flex items-center gap-2"
              initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: prefersReducedMotion ? 0 : 0.08, duration: 0.35 }}
            >
              <Button onClick={() => setFolderDialog({ mode: "create", value: "" })} variant="outline">
                <FolderPlus data-icon="inline-start" />
                Nouveau dossier
              </Button>
              <Button disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                {uploading ? <Spinner data-icon="inline-start" /> : <Upload data-icon="inline-start" />}
                {uploading ? "Import en cours…" : "Importer"}
              </Button>
              <input
                ref={fileInputRef}
                className="hidden"
                type="file"
                accept="image/*,video/*"
                multiple
                onChange={(event) => { if (event.target.files) void uploadFiles(event.target.files); }}
              />
            </motion.div>
          </div>

          <motion.div
            className="flex flex-wrap items-center gap-2 rounded-2xl border bg-background/75 p-2 shadow-sm backdrop-blur-xl"
            initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: prefersReducedMotion ? 0 : 0.12, duration: 0.4 }}
          >
            <div className="relative min-w-52 flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="Rechercher dans la bibliothèque" className="border-0 bg-transparent pl-8 shadow-none" placeholder="Rechercher un rush ou un tag…" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <ToggleGroup
              value={[mediaFilter]}
              onValueChange={(values) => setMediaFilter((values[0] as MediaFilter | undefined) ?? "all")}
              variant="outline"
              spacing={0}
            >
              <ToggleGroupItem value="all">Tous</ToggleGroupItem>
              <ToggleGroupItem value="video"><Video data-icon="inline-start" /> Vidéos</ToggleGroupItem>
              <ToggleGroupItem value="image"><ImageIcon data-icon="inline-start" /> Images</ToggleGroupItem>
            </ToggleGroup>
            <Button onClick={() => setTagDialogOpen(true)} variant="ghost">
              <Tag data-icon="inline-start" />
              Gérer les tags
            </Button>
          </motion.div>

          <AnimatePresence initial={false}>
            {library.tags.length > 0 && (
              <motion.div
                className="flex items-center gap-2 overflow-x-auto pb-0.5"
                initial={prefersReducedMotion ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={prefersReducedMotion ? undefined : { opacity: 0, height: 0 }}
              >
                <span className="shrink-0 text-xs font-medium text-muted-foreground">Filtrer par tag</span>
                <ToggleGroup
                  className="flex-nowrap"
                  multiple
                  value={selectedTagIds}
                  onValueChange={setSelectedTagIds}
                  variant="outline"
                  size="sm"
                >
                  {library.tags.map((tag) => <ToggleGroupItem key={tag.id} value={tag.id}>{tag.name}</ToggleGroupItem>)}
                </ToggleGroup>
                {selectedTagIds.length > 0 && (
                  <Button onClick={() => setSelectedTagIds([])} size="sm" variant="ghost"><X data-icon="inline-start" /> Effacer</Button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>

      <AnimatePresence initial={false}>
        {error && (
          <motion.div
            className="flex items-center justify-between gap-3 border-b bg-destructive/10 px-5 py-2 text-sm text-destructive lg:px-7"
            initial={prefersReducedMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={prefersReducedMotion ? undefined : { opacity: 0, height: 0 }}
          >
            <span>{error}</span>
            <Button onClick={() => { setLoading(true); void load(); }} size="sm" variant="ghost">Réessayer</Button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-60 shrink-0 flex-col border-r bg-muted/10 md:flex">
          <div className="flex items-center justify-between px-3 py-4">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dossiers</span>
            <Button aria-label="Créer un dossier" onClick={() => setFolderDialog({ mode: "create", value: "" })} size="icon-sm" variant="ghost"><Plus /></Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-3">
            <Button className="justify-start" onClick={() => setSelectedFolderId("all")} variant={selectedFolderId === "all" ? "secondary" : "ghost"}>
              <Library data-icon="inline-start" />
              Tous les médias
              <span className="ml-auto text-xs text-muted-foreground">{library.assets.length}</span>
            </Button>
            <Button className="justify-start" onClick={() => setSelectedFolderId("unfiled")} variant={selectedFolderId === "unfiled" ? "secondary" : "ghost"}>
              <FolderOpen data-icon="inline-start" />
              Sans dossier
              <span className="ml-auto text-xs text-muted-foreground">{library.assets.filter((asset) => asset.folderId === null).length}</span>
            </Button>
            <Separator className="my-1" />
            {library.folders.map((folder) => {
              const active = selectedFolderId === folder.id;
              return (
                <motion.div
                  className="group flex items-center"
                  key={folder.id}
                  layout={!prefersReducedMotion}
                  initial={prefersReducedMotion ? false : { opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                >
                  <Button className="min-w-0 flex-1 justify-start" onClick={() => setSelectedFolderId(folder.id)} variant={active ? "secondary" : "ghost"}>
                    <Folder data-icon="inline-start" />
                    <span className="truncate">{folder.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{library.assets.filter((asset) => asset.folderId === folder.id).length}</span>
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button aria-label={`Actions pour ${folder.name}`} className="opacity-0 group-hover:opacity-100" size="icon-sm" variant="ghost" />}>
                      <MoreHorizontal />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuGroup>
                        <DropdownMenuItem onClick={() => setFolderDialog({ mode: "rename", folderId: folder.id, value: folder.name })}><Pencil /> Renommer</DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem variant="destructive" onClick={() => void deleteFolder(folder.id, folder.name)}><Trash2 /> Supprimer</DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </motion.div>
              );
            })}
          </div>
        </aside>

        <section className="min-w-0 flex-1 overflow-y-auto bg-gradient-to-b from-muted/10 to-background px-4 py-5 lg:px-6">
          <motion.div
            className="mb-5 flex flex-wrap items-center justify-between gap-2"
            layout={!prefersReducedMotion}
          >
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">{selectedFolderName}</h2>
              <Badge variant="secondary">{visibleAssets.length}</Badge>
            </div>
            <div className="flex items-center gap-2 md:hidden">
              <label className="sr-only" htmlFor="mobile-library-folder">Dossier</label>
              <select
                id="mobile-library-folder"
                className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                value={selectedFolderId}
                onChange={(event) => setSelectedFolderId(event.target.value)}
              >
                <option value="all">Tous les médias</option>
                <option value="unfiled">Sans dossier</option>
                {library.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select>
            </div>
          </motion.div>

          {loading ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
              {Array.from({ length: 10 }).map((_, index) => (
                <motion.div
                  key={index}
                  initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: prefersReducedMotion ? 0 : index * 0.035 }}
                >
                  <Skeleton className="aspect-video rounded-2xl" />
                </motion.div>
              ))}
            </div>
          ) : visibleAssets.length === 0 ? (
            <motion.div initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
              <Empty className="min-h-[50vh] border bg-background/60 shadow-sm backdrop-blur-sm">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><Sparkles /></EmptyMedia>
                  <EmptyTitle>{library.assets.length === 0 ? "Votre bibliothèque est prête" : "Aucun média ne correspond"}</EmptyTitle>
                  <EmptyDescription>
                    {library.assets.length === 0
                      ? "Survolez une image ou une vidéo dans la galerie et choisissez « Ajouter au B-roll », ou importez vos rushs directement."
                      : "Essayez un autre dossier, retirez un filtre ou modifiez votre recherche."}
                  </EmptyDescription>
                </EmptyHeader>
                {library.assets.length === 0 && (
                  <EmptyContent>
                    <Button onClick={() => fileInputRef.current?.click()}><Upload data-icon="inline-start" /> Importer des rushs</Button>
                  </EmptyContent>
                )}
              </Empty>
            </motion.div>
          ) : (
            <motion.div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4" layout={!prefersReducedMotion}>
              <AnimatePresence initial={!prefersReducedMotion} mode="popLayout">
              {visibleAssets.map((asset, index) => (
                <motion.article
                  className="group relative aspect-video cursor-pointer overflow-hidden rounded-2xl border bg-muted shadow-sm outline-none transition-[box-shadow,border-color] duration-300 hover:border-ring/40 hover:shadow-xl focus-visible:ring-3 focus-visible:ring-ring/50"
                  key={asset.id}
                  layout={!prefersReducedMotion}
                  initial={prefersReducedMotion ? false : { opacity: 0, y: 16, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={prefersReducedMotion ? undefined : { opacity: 0, scale: 0.96 }}
                  whileHover={prefersReducedMotion ? undefined : { y: -5 }}
                  transition={{
                    delay: prefersReducedMotion ? 0 : Math.min(index, 10) * 0.03,
                    duration: 0.4,
                    ease: [0.16, 1, 0.3, 1],
                    layout: { duration: 0.3 },
                  }}
                  onMouseEnter={(event) => {
                    event.currentTarget.querySelector("video")?.play().catch(() => {});
                  }}
                  onMouseLeave={(event) => {
                    const video = event.currentTarget.querySelector("video");
                    if (video) {
                      video.pause();
                      video.currentTime = 0;
                    }
                  }}
                >
                  {asset.mediaType === "video" ? (
                    <video className="size-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]" src={asset.url} muted loop playsInline preload="metadata" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="size-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]" src={asset.url} alt={assetLabel(asset)} loading="lazy" />
                  )}

                  <button
                    aria-label={`Ouvrir l’aperçu de ${assetLabel(asset)}`}
                    className="absolute inset-0 rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    onClick={() => setPreviewAsset(asset)}
                    type="button"
                  />

                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background/10 to-transparent opacity-90 transition-opacity duration-500 group-hover:opacity-70" />

                  <div className="pointer-events-none absolute top-2 left-2 flex items-center gap-1.5">
                    <Badge className="backdrop-blur-md" variant="secondary">
                      {asset.mediaType === "video" ? <Video data-icon="inline-start" /> : <ImageIcon data-icon="inline-start" />}
                      {asset.mediaType === "video" ? "Vidéo" : "Image"}
                    </Badge>
                    {formatDuration(asset.duration) && <Badge className="backdrop-blur-md" variant="outline">{formatDuration(asset.duration)}</Badge>}
                  </div>

                  {asset.mediaType === "video" && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <span className="flex size-11 items-center justify-center rounded-full bg-background/80 shadow-lg backdrop-blur-md transition-all duration-300 group-hover:scale-125 group-hover:opacity-0">
                        <Play className="fill-current" />
                      </span>
                    </div>
                  )}

                  <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 p-3 transition-all duration-300 group-hover:translate-y-2 group-hover:opacity-0 group-focus-within:translate-y-2 group-focus-within:opacity-0">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-medium">{assetLabel(asset)}</h3>
                    </div>
                    {asset.tagIds.length > 0 && (
                      <div className="flex min-w-0 gap-1 overflow-hidden">
                        {library.tags.filter((tag) => asset.tagIds.includes(tag.id)).slice(0, 3).map((tag) => <Badge key={tag.id} variant="secondary">{tag.name}</Badge>)}
                        {asset.tagIds.length > 3 && <Badge variant="outline">+{asset.tagIds.length - 3}</Badge>}
                      </div>
                    )}
                  </div>

                  <div className="absolute inset-x-3 bottom-3 flex translate-y-2 items-center justify-between gap-2 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100" onClick={(event) => event.stopPropagation()}>
                    <Button onClick={() => setPreviewAsset(asset)} size="sm" variant="secondary">
                      <Play data-icon="inline-start" /> Aperçu
                    </Button>
                    <div className="flex items-center gap-1">
                      {asset.mediaType === "image" && (
                        <Button aria-label="Utiliser dans Image" onClick={() => sendToGallery(asset, "images")} size="icon-sm" variant="secondary"><ImageIcon /></Button>
                      )}
                      <Button onClick={() => sendToGallery(asset, "videos")} size="sm">
                        <ArrowUpRight data-icon="inline-start" /> Vidéo
                      </Button>
                    </div>
                  </div>

                  <div className="absolute top-2 right-2 translate-y-1 opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100" onClick={(event) => event.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button aria-label={`Actions pour ${assetLabel(asset)}`} className="rounded-full bg-background/80 backdrop-blur-sm" size="icon-sm" variant="secondary" />}>
                        <MoreHorizontal />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          <DropdownMenuItem onClick={() => beginEditAsset(asset)}><Pencil /> Modifier</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => downloadAsset(asset)}><Download /> Télécharger</DropdownMenuItem>
                          {asset.mediaType === "video" && <DropdownMenuItem onClick={() => openVideoTextRemoval({ url: asset.url, title: assetLabel(asset) })}><CaptionsOff /> Supprimer les sous-titres</DropdownMenuItem>}
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          {asset.mediaType === "image" && <DropdownMenuItem onClick={() => sendToGallery(asset, "images")}><ImageIcon /> Utiliser dans Image</DropdownMenuItem>}
                          <DropdownMenuItem onClick={() => sendToGallery(asset, "videos")}><Video /> Utiliser dans Vidéo</DropdownMenuItem>
                        </DropdownMenuGroup>
                        {library.permissions.canDeleteAssets && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                              <DropdownMenuItem variant="destructive" onClick={() => void deleteAsset(asset)}><Trash2 /> Retirer</DropdownMenuItem>
                            </DropdownMenuGroup>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </motion.article>
              ))}
              </AnimatePresence>
            </motion.div>
          )}
        </section>
      </div>

      <Dialog open={Boolean(folderDialog)} onOpenChange={(open) => { if (!open && !saving) setFolderDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{folderDialog?.mode === "rename" ? "Renommer le dossier" : "Nouveau dossier"}</DialogTitle>
            <DialogDescription>Organisez vos rushs par campagne, produit, décor ou usage.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="folder-name">Nom du dossier</FieldLabel>
              <Input
                id="folder-name"
                autoFocus
                maxLength={80}
                value={folderDialog?.value ?? ""}
                onChange={(event) => setFolderDialog((current) => current ? { ...current, value: event.target.value } : current)}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveFolder(); } }}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button disabled={saving} onClick={() => setFolderDialog(null)} variant="outline">Annuler</Button>
            <Button disabled={saving || !folderDialog?.value.trim()} onClick={() => void saveFolder()}>
              {saving ? <Spinner data-icon="inline-start" /> : <FolderPlus data-icon="inline-start" />}
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={tagDialogOpen} onOpenChange={(open) => { if (!saving) setTagDialogOpen(open); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Gérer les tags</DialogTitle>
            <DialogDescription>Créez un vocabulaire commun pour retrouver les bons rushs.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="new-tag-name">Nouveau tag</FieldLabel>
              <div className="flex gap-2">
                <Input id="new-tag-name" maxLength={40} placeholder="Ex. produit, lifestyle, extérieur" value={newTagName} onChange={(event) => setNewTagName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void createTag(); } }} />
                <Button aria-label="Créer le tag" disabled={saving || !newTagName.trim()} onClick={() => void createTag()} size="icon"><Plus /></Button>
              </div>
            </Field>
            <FieldSet>
              <FieldLegend variant="label">Tags disponibles</FieldLegend>
              {library.tags.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun tag pour le moment.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {library.tags.map((tag) => (
                    <Badge key={tag.id} variant="secondary">
                      {tag.name}
                      <button aria-label={`Supprimer le tag ${tag.name}`} className="rounded-full hover:text-destructive" onClick={() => void deleteTag(tag.id, tag.name)} type="button"><X /></button>
                    </Badge>
                  ))}
                </div>
              )}
            </FieldSet>
          </FieldGroup>
          <DialogFooter><Button onClick={() => setTagDialogOpen(false)}>Terminé</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingAsset)} onOpenChange={(open) => { if (!open && !saving) setEditingAsset(null); }}>
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Modifier le média</DialogTitle>
            <DialogDescription>Renommez, déplacez et taggez ce rush.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="asset-title">Nom</FieldLabel>
              <Input id="asset-title" maxLength={160} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
            </Field>
            <FieldSet>
              <FieldLegend variant="label">Dossier</FieldLegend>
              <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border p-1">
                <Button className="justify-start" onClick={() => setEditFolderId(null)} size="sm" variant={editFolderId === null ? "secondary" : "ghost"}>
                  <Library data-icon="inline-start" /> Sans dossier {editFolderId === null && <Check data-icon="inline-end" />}
                </Button>
                {library.folders.map((folder) => (
                  <Button className="justify-start" key={folder.id} onClick={() => setEditFolderId(folder.id)} size="sm" variant={editFolderId === folder.id ? "secondary" : "ghost"}>
                    <Folder data-icon="inline-start" /> <span className="truncate">{folder.name}</span> {editFolderId === folder.id && <Check data-icon="inline-end" />}
                  </Button>
                ))}
              </div>
            </FieldSet>
            <FieldSet>
              <FieldLegend variant="label">Tags</FieldLegend>
              {library.tags.length === 0 ? (
                <Button onClick={() => setTagDialogOpen(true)} variant="outline"><Tag data-icon="inline-start" /> Créer un premier tag</Button>
              ) : (
                <ToggleGroup className="flex w-full flex-wrap justify-start" multiple value={editTagIds} onValueChange={setEditTagIds} variant="outline">
                  {library.tags.map((tag) => <ToggleGroupItem key={tag.id} value={tag.id}><Tag data-icon="inline-start" /> {tag.name}</ToggleGroupItem>)}
                </ToggleGroup>
              )}
            </FieldSet>
          </FieldGroup>
          <DialogFooter>
            <Button disabled={saving} onClick={() => setEditingAsset(null)} variant="outline">Annuler</Button>
            <Button disabled={saving} onClick={() => void saveAsset()}>{saving ? <Spinner data-icon="inline-start" /> : <Check data-icon="inline-start" />} Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(previewAsset)} onOpenChange={(open) => { if (!open) setPreviewAsset(null); }}>
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto p-0 sm:max-w-5xl" showCloseButton={false}>
          <DialogHeader className="sr-only">
            <DialogTitle>{previewAsset ? assetLabel(previewAsset) : "Aperçu du média"}</DialogTitle>
            <DialogDescription>Aperçu grand format du média sélectionné.</DialogDescription>
          </DialogHeader>
          <div className="relative flex max-h-[75vh] min-h-64 items-center justify-center overflow-hidden rounded-t-xl bg-muted">
            {previewAsset?.mediaType === "video" ? (
              <video className="max-h-[75vh] w-full object-contain" src={previewAsset.url} controls autoPlay playsInline />
            ) : previewAsset ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="max-h-[75vh] w-full object-contain" src={previewAsset.url} alt={assetLabel(previewAsset)} />
            ) : null}
            <Button aria-label="Fermer l’aperçu" className="absolute top-3 right-3 rounded-full bg-background/80 backdrop-blur-sm" onClick={() => setPreviewAsset(null)} size="icon" variant="secondary"><X /></Button>
          </div>
          {previewAsset && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-4">
              <div className="min-w-0">
                <h3 className="truncate font-medium">{assetLabel(previewAsset)}</h3>
                <p className="text-sm text-muted-foreground">{previewAsset.mediaType === "video" ? "Vidéo" : "Image"}{formatDuration(previewAsset.duration) ? ` · ${formatDuration(previewAsset.duration)}` : ""}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {previewAsset.mediaType === "video" && <Button variant="outline" onClick={() => { const asset = previewAsset; setPreviewAsset(null); openVideoTextRemoval({ url: asset.url, title: assetLabel(asset) }); }}><CaptionsOff data-icon="inline-start" /> Supprimer les sous-titres</Button>}
                <Button onClick={() => { beginEditAsset(previewAsset); setPreviewAsset(null); }} variant="outline"><Pencil data-icon="inline-start" /> Modifier</Button>
                <Button onClick={() => downloadAsset(previewAsset)}><Download data-icon="inline-start" /> Télécharger</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
