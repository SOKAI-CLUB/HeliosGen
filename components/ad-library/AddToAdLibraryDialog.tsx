"use client";

import { useEffect, useState } from "react";
import { Check, Folder, FolderPlus, Image as ImageIcon, Library, Tag, Video } from "lucide-react";

import VideoTrimDialog from "@/components/nodes/VideoTrimDialog";
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fetchAdLibrary, mutateAdLibrary, type AdLibraryData } from "@/lib/adLibrary";
import type { GalleryItem } from "@/lib/galleryUtils";
import { getToken } from "@/lib/galleryUtils";

interface TrimSelection {
  start: number;
  end: number;
  duration: number;
}

interface AddToAdLibraryDialogProps {
  item: GalleryItem | null;
  onClose: () => void;
  onAdded?: () => void;
}

const emptyLibrary: AdLibraryData = {
  folders: [],
  assets: [],
  tags: [],
  permissions: { canDeleteAssets: false },
};

export function AddToAdLibraryDialog({ item, onClose, onAdded }: AddToAdLibraryDialogProps) {
  if (!item) return null;
  return <AddToAdLibraryFlow key={item.id} item={item} onAdded={onAdded} onClose={onClose} />;
}

function AddToAdLibraryFlow({
  item,
  onClose,
  onAdded,
}: Omit<AddToAdLibraryDialogProps, "item"> & { item: GalleryItem }) {
  const [step, setStep] = useState<"trim" | "details">(item.mediaType === "video" ? "trim" : "details");
  const [library, setLibrary] = useState<AdLibraryData>(emptyLibrary);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [trim, setTrim] = useState<TrimSelection | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  useEffect(() => {
    let active = true;
    fetchAdLibrary()
      .then((data) => { if (active) setLibrary(data); })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : String(caught)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name || creatingFolder) return;
    setCreatingFolder(true);
    setError("");
    try {
      const nextLibrary = await mutateAdLibrary<AdLibraryData>({ action: "create-folder", name });
      setLibrary(nextLibrary);
      const created = nextLibrary.folders
        .filter((folder) => folder.name === name)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      if (created) setFolderId(created.id);
      setNewFolderName("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setCreatingFolder(false);
    }
  };

  const addToLibrary = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      let finalUrl = item.url;
      let sourceType: "generation" | "upload" | "trimmed" = item.source;
      let finalDuration: number | null = trim?.duration ?? null;
      let trimStart: number | null = null;
      let trimEnd: number | null = null;

      if (item.mediaType === "video" && trim) {
        const isTrimmed = trim.start > 0.01 || trim.end < trim.duration - 0.01;
        if (isTrimmed) {
          const token = await getToken();
          const response = await fetch("/api/trim-video", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ videoUrl: item.url, startTime: trim.start, endTime: trim.end }),
          });
          const payload = await response.json() as { cdnUrl?: string; error?: string };
          if (!response.ok || !payload.cdnUrl) throw new Error(payload.error ?? "La découpe a échoué.");
          finalUrl = payload.cdnUrl;
          sourceType = "trimmed";
          finalDuration = trim.end - trim.start;
          trimStart = trim.start;
          trimEnd = trim.end;
        }
      }

      await mutateAdLibrary({
        action: "add-asset",
        folderId,
        sourceItemId: item.id,
        sourceType,
        mediaType: item.mediaType,
        url: finalUrl,
        title: title.trim() || null,
        duration: finalDuration,
        trimStart,
        trimEnd,
        tagIds: selectedTagIds,
      });
      window.dispatchEvent(new Event("ad-library-updated"));
      onAdded?.();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  if (step === "trim") {
    return (
      <VideoTrimDialog
        key={item.id}
        confirmLabel="Continuer"
        description="Choisissez précisément le passage à conserver dans votre bibliothèque publicitaire."
        duration={0}
        minDuration={0.25}
        open
        title="Découper le B-roll"
        videoUrl={item.url}
        onApply={(start, end, duration) => {
          setTrim({ start, end, duration });
          setStep("details");
        }}
        onCancel={onClose}
      />
    );
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Library />
            Ajouter au B-roll
          </DialogTitle>
          <DialogDescription>
            Classez ce média maintenant. Vous pourrez ensuite le déplacer, le renommer et modifier ses tags.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-[180px_1fr]">
          <div className="relative aspect-video overflow-hidden rounded-xl border bg-muted md:aspect-[4/5]">
            {item.mediaType === "video" ? (
              <video className="size-full object-cover" src={item.url} muted loop autoPlay playsInline />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="size-full object-cover" src={item.url} alt="Aperçu du média" />
            )}
            <Badge className="absolute bottom-2 left-2" variant="secondary">
              {item.mediaType === "video" ? <Video data-icon="inline-start" /> : <ImageIcon data-icon="inline-start" />}
              {item.mediaType === "video" && trim ? `${(trim.end - trim.start).toFixed(1)} s` : item.mediaType === "video" ? "Vidéo" : "Image"}
            </Badge>
          </div>

          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="ad-library-title">Nom du média</FieldLabel>
              <Input
                id="ad-library-title"
                maxLength={160}
                placeholder={item.mediaType === "video" ? "Ex. Plan produit — mouvement latéral" : "Ex. Packshot produit"}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>

            <FieldSet>
              <FieldLegend variant="label">Dossier</FieldLegend>
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> Chargement des dossiers…</div>
              ) : (
                <div className="flex max-h-44 flex-col gap-1 overflow-y-auto rounded-lg border p-1">
                  <Button
                    className="justify-start"
                    onClick={() => setFolderId(null)}
                    size="sm"
                    variant={folderId === null ? "secondary" : "ghost"}
                  >
                    <Library data-icon="inline-start" />
                    Sans dossier
                    {folderId === null && <Check data-icon="inline-end" />}
                  </Button>
                  {library.folders.map((folder) => (
                    <Button
                      className="justify-start"
                      key={folder.id}
                      onClick={() => setFolderId(folder.id)}
                      size="sm"
                      variant={folderId === folder.id ? "secondary" : "ghost"}
                    >
                      <Folder data-icon="inline-start" />
                      <span className="truncate">{folder.name}</span>
                      {folderId === folder.id && <Check data-icon="inline-end" />}
                    </Button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  aria-label="Nom du nouveau dossier"
                  maxLength={80}
                  placeholder="Nouveau dossier"
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void createFolder(); } }}
                />
                <Button
                  aria-label="Créer le dossier"
                  disabled={!newFolderName.trim() || creatingFolder}
                  onClick={() => void createFolder()}
                  size="icon"
                  variant="outline"
                >
                  {creatingFolder ? <Spinner /> : <FolderPlus />}
                </Button>
              </div>
            </FieldSet>

            {library.tags.length > 0 && (
              <FieldSet>
                <FieldLegend variant="label">Tags</FieldLegend>
                <ToggleGroup
                  className="flex w-full flex-wrap justify-start"
                  multiple
                  value={selectedTagIds}
                  onValueChange={setSelectedTagIds}
                  variant="outline"
                >
                  {library.tags.map((tag) => (
                    <ToggleGroupItem key={tag.id} value={tag.id} size="sm">
                      <Tag data-icon="inline-start" />
                      {tag.name}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </FieldSet>
            )}
          </FieldGroup>
        </div>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        {!loading && library.folders.length === 0 && (
          <Empty className="border py-4">
            <EmptyHeader>
              <EmptyMedia variant="icon"><FolderPlus /></EmptyMedia>
              <EmptyTitle>Premier classement</EmptyTitle>
              <EmptyDescription>Créez un dossier ci-dessus ou gardez le média sans dossier.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        <DialogFooter>
          {item.mediaType === "video" && (
            <Button disabled={saving} onClick={() => setStep("trim")} variant="ghost">Modifier la coupe</Button>
          )}
          <Button disabled={saving} onClick={onClose} variant="outline">Annuler</Button>
          <Button disabled={loading || saving} onClick={() => void addToLibrary()}>
            {saving ? <Spinner data-icon="inline-start" /> : <Library data-icon="inline-start" />}
            {saving ? (item.mediaType === "video" ? "Préparation du clip…" : "Ajout…") : "Ajouter à la bibliothèque"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
