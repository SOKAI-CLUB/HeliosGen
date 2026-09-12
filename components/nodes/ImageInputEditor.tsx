"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Play, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Spinner } from "@/components/ui/spinner";
import CreditEstimate from "@/components/CreditEstimate";
import { IMAGE_MODELS } from "@/lib/modelConfig";
import { estimateImageCredits } from "@/lib/creditEstimate";
import { getModelProvider } from "@/lib/providers";
import { generateInputImage, uploadInputImage, type InputImage } from "@/lib/imageInput";
import { useWorkflowStore } from "@/lib/store";

interface Props {
  nodeId: string;
  currentUrl?: string;
  initialFile?: File;
  downstreamCount: number;
  onClose: () => void;
  onApply: (image: InputImage, rerun: boolean) => boolean;
}

export default function ImageInputEditor({ nodeId, currentUrl, initialFile, downstreamCount, onClose, onApply }: Props) {
  const [mode, setMode] = useState("import");
  const [image, setImage] = useState<InputImage | null>(null);
  const [url, setUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState(() => useWorkflowStore.getState().nodeDefaults.generateNode.model ?? "nano-banana-2");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [referenceMode, setReferenceMode] = useState("new");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const model = IMAGE_MODELS.find(m => m.id === modelId) ?? IMAGE_MODELS[0];
  const quality = model.defaultQuality ?? "1k";
  const useReference = referenceMode === "reference" && model.supportsImages && !!currentUrl;
  const estimate = estimateImageCredits({ model, quality, provider: getModelProvider(model.id), referenceImageCount: useReference ? 1 : 0 });
  const promptLimit = !useReference && model.textOnlyPromptMaxLength ? model.textOnlyPromptMaxLength : model.apiInput.promptMaxLength;

  async function prepare(operation: (signal: AbortSignal) => Promise<InputImage>, label: string) {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBusy(label);
    setError(null);
    setImage(null);
    try {
      const result = await operation(request.signal);
      if (!request.signal.aborted) setImage(result);
    } catch (err) {
      if (!request.signal.aborted) setError(err instanceof Error ? err.message : "Impossible de préparer cette image.");
    } finally {
      if (!request.signal.aborted) { setBusy(null); controller.current = null; }
    }
  }

  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (mounted && initialFile) void prepare(signal => uploadInputImage(initialFile, signal), "Import de l’image…");
    });
    return () => { mounted = false; controller.current?.abort(); };
    // The editor is mounted afresh for every edit, including a dropped file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = (rerun: boolean) => {
    if (!image || busy) return;
    if (onApply(image, rerun)) onClose();
    else setError("Une génération est en cours. Attendez sa fin avant de remplacer l’image.");
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="nodrag nopan nowheel flex max-h-[90dvh] flex-col sm:max-w-lg"
        onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
        onDrop={e => {
          e.preventDefault(); e.stopPropagation();
          const file = e.dataTransfer.files[0];
          if (file && !busy) { setMode("import"); void prepare(signal => uploadInputImage(file, signal), "Import de l’image…"); }
        }} onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}>
        <DialogHeader className="shrink-0">
          <DialogTitle>Modifier l’image d’entrée</DialogTitle>
          <DialogDescription>
            Choisissez une nouvelle image pour créer une déclinaison du workflow. Les prompts et les connexions sont conservés.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          {(image?.url || currentUrl) && (
            <div className="flex h-36 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image?.url ?? currentUrl} alt={image ? "Nouvelle image d’entrée" : "Image d’entrée actuelle"} className="size-full object-contain" />
            </div>
          )}
          <ToggleGroup value={[mode]} onValueChange={values => { if (values[0]) { setMode(String(values[0])); setError(null); } }} disabled={!!busy} variant="outline" aria-label="Source de l’image">
            <ToggleGroupItem value="import"><ImagePlus data-icon="inline-start" />Importer</ToggleGroupItem>
            <ToggleGroupItem value="generate"><Sparkles data-icon="inline-start" />Créer avec un prompt</ToggleGroupItem>
          </ToggleGroup>

          {mode === "import" ? (
            <FieldGroup>
              <Field data-disabled={!!busy}>
                <FieldLabel htmlFor={`${nodeId}-file`}>Choisir un fichier</FieldLabel>
                <Input id={`${nodeId}-file`} type="file" accept="image/*" disabled={!!busy} onChange={e => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void prepare(signal => uploadInputImage(file, signal), "Import de l’image…");
                }} />
                <FieldDescription>Vous pouvez aussi déposer une image ici. 100 Mo maximum.</FieldDescription>
              </Field>
              <Field data-disabled={!!busy}>
                <FieldLabel htmlFor={`${nodeId}-url`}>Ou coller une URL d’image</FieldLabel>
                <Input id={`${nodeId}-url`} type="url" placeholder="https://…" value={url} disabled={!!busy} onChange={e => { setUrl(e.target.value); setImage(null); }} />
                <Button variant="outline" disabled={!!busy || !url.trim()} onClick={() => void prepare(signal => uploadInputImage(url.trim(), signal), "Import de l’image…")}>Charger l’image</Button>
              </Field>
            </FieldGroup>
          ) : (
            <FieldGroup>
              <Field data-disabled={!!busy}>
                <FieldLabel htmlFor={`${nodeId}-prompt`}>Décrire la nouvelle image</FieldLabel>
                <Textarea id={`${nodeId}-prompt`} placeholder="Un nouvel avatar face caméra, lumière naturelle, cadrage vertical…" rows={3} maxLength={promptLimit} value={prompt} disabled={!!busy} onChange={e => setPrompt(e.target.value)} />
              </Field>
              <FieldGroup className="grid grid-cols-2 gap-3">
                <Field data-disabled={!!busy}>
                  <FieldLabel htmlFor={`${nodeId}-model`}>Modèle</FieldLabel>
                  <NativeSelect id={`${nodeId}-model`} value={model.id} disabled={!!busy} className="w-full" onChange={e => {
                    const next = IMAGE_MODELS.find(m => m.id === e.target.value)!;
                    setModelId(next.id);
                    if (!next.ratios.includes(aspectRatio)) setAspectRatio(next.ratios[0]);
                  }}>
                    {IMAGE_MODELS.map(m => <NativeSelectOption key={m.id} value={m.id}>{m.name}</NativeSelectOption>)}
                  </NativeSelect>
                </Field>
                <Field data-disabled={!!busy}>
                  <FieldLabel htmlFor={`${nodeId}-ratio`}>Format</FieldLabel>
                  <NativeSelect id={`${nodeId}-ratio`} value={aspectRatio} disabled={!!busy} className="w-full" onChange={e => setAspectRatio(e.target.value)}>
                    {model.ratios.map(ratio => <NativeSelectOption key={ratio} value={ratio}>{ratio}</NativeSelectOption>)}
                  </NativeSelect>
                </Field>
              </FieldGroup>
              {currentUrl && model.supportsImages && (
                <Field>
                  <FieldLabel>Image de référence</FieldLabel>
                  <ToggleGroup value={[referenceMode]} onValueChange={values => { if (values[0]) setReferenceMode(String(values[0])); }} disabled={!!busy} variant="outline" aria-label="Image de référence">
                    <ToggleGroupItem value="new">Sans référence</ToggleGroupItem>
                    <ToggleGroupItem value="reference">Utiliser l’image actuelle</ToggleGroupItem>
                  </ToggleGroup>
                </Field>
              )}
              <div className="flex items-center justify-between gap-2">
                <CreditEstimate estimate={estimate} />
                <Button disabled={!!busy || !prompt.trim() || prompt.length > promptLimit} onClick={() => void prepare(signal => generateInputImage({ model: model.id, prompt, aspectRatio, quality, referenceUrl: useReference ? currentUrl : undefined }, signal), "Génération de l’image…")}>
                  <Sparkles data-icon="inline-start" />Générer l’image
                </Button>
              </div>
            </FieldGroup>
          )}

          {busy && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />{busy}</p>}
          {error && <FieldError role="alert">{error}</FieldError>}
          {image && <p role="status" className="text-sm text-muted-foreground">Image prête. Appliquez-la seule ou relancez les {downstreamCount} étapes connectées.</p>}
          {downstreamCount > 0 && <p className="text-xs text-muted-foreground">La relance utilise les modèles et crédits habituels de chaque étape. Les résultats précédents restent dans l’historique.</p>}
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" disabled={!image || !!busy} onClick={() => apply(false)}>Remplacer l’image</Button>
          {downstreamCount > 0 && <Button disabled={!image || !!busy} onClick={() => apply(true)}><Play data-icon="inline-start" />Remplacer et relancer</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
