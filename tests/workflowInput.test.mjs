import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Transpile the production modules with only browser/auth adapters substituted.
const modules = new Map();
async function moduleUrl(relative) {
  if (modules.has(relative)) return modules.get(relative);
  const path = new URL(relative, new URL("../lib/", import.meta.url));
  const source = await readFile(path, "utf8");
  let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const match of [...code.matchAll(/from "([^"]+)"/g)]) {
    const name = match[1];
    let url;
    if (name === "./supabase/client") {
      url = "data:text/javascript," + encodeURIComponent('export const createClient = () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "test-token" } } }) } });');
    } else if (name.startsWith(".") || name.startsWith("@/lib/")) {
      url = await moduleUrl(name.startsWith("@/lib/") ? name.slice(6) + ".ts" : name + ".ts");
    } else url = import.meta.resolve(name);
    code = code.replaceAll(`from "${name}"`, `from "${url}"`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  modules.set(relative, url);
  return url;
}

const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
const { useWorkflowStore: store } = await import(await moduleUrl("store.ts"));
const { makeUGCTemplate } = await import(await moduleUrl("templates.ts"));
const { resolveInputs, resolveImageUrl, buildPipelineWaves } = await import(await moduleUrl("executor.ts"));
const { getDownstreamNodeIds, getPipelineWaveStatus, invalidateOutputs } = await import(await moduleUrl("workflowGraph.ts"));
const { uploadInputImage, generateInputImage } = await import(await moduleUrl("imageInput.ts"));

function reset() {
  store.getState().setIsRunning(false);
  store.getState().createSpace("Test UGC", makeUGCTemplate());
}

test("replacing the example avatar updates all branches, preserves history and survives reload", () => {
  reset();
  const before = store.getState();
  const oldImage = before.nodes.find(n => n.id === "tpl-ig-1").data.imageUrl;
  assert.equal(store.getState().replaceInputImage("tpl-avatar", "https://cdn.example/new.png", "1080 / 1920"), true);
  const { nodes, edges } = store.getState();
  assert.deepEqual(edges, before.edges);
  const scope = getDownstreamNodeIds("tpl-avatar", edges);
  assert.equal(scope.length, 8);
  const waves = buildPipelineWaves(nodes.filter(n => scope.includes(n.id)), edges);
  assert.deepEqual(waves.map(w => w.length), [4, 4]);
  assert.deepEqual(nodes.filter(n => n.type === "promptNode"), before.nodes.filter(n => n.type === "promptNode"));
  for (let i = 1; i <= 4; i++) {
    assert.deepEqual(resolveInputs(`tpl-ig-${i}`, nodes, edges).imageUrls, ["https://cdn.example/new.png"]);
    assert.equal(resolveInputs(`tpl-vg-${i}`, nodes, edges).startFrameUrl, undefined);
  }
  assert.deepEqual(nodes.find(n => n.id === "tpl-ig-1").data.generations, [oldImage]);
  const persisted = JSON.parse(storage.get("heliosgen")).state;
  assert.equal(persisted.nodes.find(n => n.id === "tpl-avatar").data.r2Url, "https://cdn.example/new.png");
  assert.equal(persisted.spaces.find(s => s.id === persisted.activeSpaceId).nodes.find(n => n.id === "tpl-avatar").data.r2Url, "https://cdn.example/new.png");
  store.getState().undo();
  assert.equal(store.getState().nodes.find(n => n.id === "tpl-ig-1").data.imageUrl, oldImage);
  store.getState().redo();
  assert.equal(store.getState().nodes.find(n => n.id === "tpl-avatar").data.r2Url, "https://cdn.example/new.png");
});

test("fresh generated outputs win over the template cache and feed downstream videos", () => {
  reset();
  const image = store.getState().nodes.find(n => n.id === "tpl-ig-1");
  assert.equal(resolveImageUrl({ ...image, data: { ...image.data, imageUrl: "https://cdn.example/fresh.png" } }), "https://cdn.example/fresh.png");
  store.getState().updateNodeData(image.id, { imageUrl: "https://cdn.example/fresh.png", status: "done" });
  const { nodes, edges } = store.getState();
  assert.equal(nodes.find(n => n.id === image.id).data.r2Url, undefined);
  assert.equal(resolveInputs("tpl-vg-1", nodes, edges).startFrameUrl, "https://cdn.example/fresh.png");
  store.getState().updateNodeData("tpl-vg-1", { capturedFrameUrl: "old-frame", eagerStartFrameUrl: "old-first", eagerEndFrameUrl: "old-last" });
  store.getState().updateNodeData("tpl-vg-1", { videoUrl: "new-video" });
  assert.equal(store.getState().nodes.find(n => n.id === "tpl-vg-1").data.eagerEndFrameUrl, undefined);
});

test("replacement keeps the selected take even when it was missing from saved history", () => {
  const node = { id: "image", type: "generateNode", data: { imageUrl: "current", generations: ["older"], status: "done" } };
  const invalidated = invalidateOutputs(node);
  assert.deepEqual(invalidated.data.generations, ["older", "current"]);
  assert.equal(invalidated.data.imageUrl, undefined);
  assert.deepEqual(node.data.generations, ["older"]);
  assert.deepEqual(invalidateOutputs({ ...node, data: { ...node.data, generations: ["current"] } }).data.generations, ["current"]);
});

test("replacement is atomic, blocked during jobs, and does not alter unrelated branches", () => {
  reset();
  const unrelated = { id: "unrelated", type: "generateNode", position: { x: 0, y: 0 }, data: { label: "Other", imageUrl: "keep", status: "done" } };
  store.getState().addNode(unrelated);
  const original = store.getState().nodes;
  assert.equal(store.getState().replaceInputImage("tpl-avatar", "blob:temporary", "1 / 1"), false);
  assert.equal(store.getState().nodes, original);
  for (const patch of [{ status: "running" }, { status: "idle", pipelineStarting: true }, { pipelineStarting: false, pipelineQueued: true }]) {
    store.getState().updateNodeData("tpl-ig-1", patch);
    assert.equal(store.getState().replaceInputImage("tpl-avatar", "https://cdn.example/new.png", "1 / 1"), false);
  }
  store.getState().updateNodeData("tpl-ig-1", { status: "done", pipelineQueued: false });
  const other = store.getState().nodes.find(n => n.id === unrelated.id);
  assert.equal(store.getState().replaceInputImage("tpl-avatar", "https://cdn.example/new.png", "1 / 1"), true);
  assert.equal(store.getState().nodes.find(n => n.id === unrelated.id), other);
});

test("pipeline waits for every submitted node and stops on validation failure or cancellation", () => {
  const node = data => ({ id: "image", data });
  for (const data of [{ pendingGenerate: true }, { pipelineStarting: true }, { status: "pending" }, { status: "running" }]) {
    assert.equal(getPipelineWaveStatus([node(data)], ["image"]), "waiting");
  }
  for (const status of ["error", "idle", undefined]) assert.equal(getPipelineWaveStatus([node({ status })], ["image"]), "error");
  assert.equal(getPipelineWaveStatus([], ["image"]), "error");
  assert.equal(getPipelineWaveStatus([node({ status: "done" })], ["image"]), "done");
  assert.deepEqual(getDownstreamNodeIds("a", [{ source: "a", target: "b" }, { source: "b", target: "a" }]), ["b"]);
});

test("pipeline ordering traverses intermediate nodes and rejects cycles", () => {
  const nodes = [
    { id: "video", type: "videoGeneratorNode", data: {} },
    { id: "image", type: "generateNode", data: {} },
    { id: "text", type: "promptNode", data: {} },
  ];
  const edges = [{ source: "image", target: "text" }, { source: "text", target: "video" }];
  assert.deepEqual(buildPipelineWaves(nodes, edges), [["image"], ["video"]]);
  assert.deepEqual(buildPipelineWaves(nodes, [...edges, { source: "video", target: "image" }]), []);
  assert.deepEqual(buildPipelineWaves(nodes.slice(1), [{ source: "image", target: "text" }, { source: "text", target: "image" }]), []);
});

test("failed uploads and invalid URLs cannot supply a replacement", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Storage unavailable" }, { status: 503 }));
  await assert.rejects(uploadInputImage("https://example.com/image.png"), /Storage unavailable/);
  await assert.rejects(uploadInputImage("javascript:alert(1)"), /URL doit/);
  await assert.rejects(uploadInputImage(new File(["video"], "video.mp4", { type: "video/mp4" })), /Choisissez une image/);
});

test("prompt generation honors the chosen provider and optional reference and returns a durable image", async t => {
  const OriginalImage = globalThis.Image;
  globalThis.Image = class { naturalWidth = 1080; naturalHeight = 1920; set src(_) { queueMicrotask(() => this.onload?.()); } };
  localStorage.setItem("aiui-model-providers", JSON.stringify({ "gpt-image-2": "codex" }));
  let payload;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url === "/api/generate") { payload = JSON.parse(init.body); return Response.json({ taskId: "test-job" }); }
    assert.equal(url, "/api/job-status?taskId=test-job");
    return Response.json({ status: "done", imageUrl: "https://cdn.example/generated.png" });
  });
  try {
    const image = await generateInputImage({ prompt: " New avatar ", model: "gpt-image-2", aspectRatio: "9:16", quality: "1k", referenceUrl: "https://cdn.example/old.png" }, new AbortController().signal);
    assert.equal(payload.codexProvider, true);
    assert.deepEqual(payload.imageUrls, ["https://cdn.example/old.png"]);
    assert.equal(payload.prompt, "New avatar");
    assert.deepEqual(image, { url: "https://cdn.example/generated.png", naturalRatio: "1080 / 1920" });
  } finally { globalThis.Image = OriginalImage; localStorage.removeItem("aiui-model-providers"); }
});
