import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { formatTimecode, validTimecode } from "../lib/adLibraryReview.ts";

const dataModule = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const compile = (code) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;

test("timecodes preserve zero and centiseconds, including minute/hour boundaries", () => {
  assert.equal(formatTimecode(0), "00:00.00");
  assert.equal(formatTimecode(5.23), "00:05.23");
  assert.equal(formatTimecode(59.999), "01:00.00");
  assert.equal(formatTimecode(3601.5), "01:00:01.50");
  assert.equal(validTimecode(0, 8), true);
  assert.equal(validTimecode(8, 8), true);
  assert.equal(validTimecode(null, 8), true);
  for (const invalid of [-1, 8.01, Infinity, NaN, "2", {}, 604801]) assert.equal(validTimecode(invalid, 8), false);
});

test("review API shares persisted threads while enforcing identity, ownership and timecode validation", async () => {
  const originalCwd = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), "helios-review-test-"));
  const dbCode = await readFile(new URL("../lib/guest/db.ts", import.meta.url), "utf8");
  const routeCode = await readFile(new URL("../app/api/ad-library/comments/route.ts", import.meta.url), "utf8");
  const coreCode = await readFile(new URL("../lib/adLibraryReview.ts", import.meta.url), "utf8");
  process.chdir(directory);
  try {
    const dbUrl = dataModule(compile(dbCode));
    const db = await import(dbUrl);
    const asset = db.insertAdLibraryAsset({ user_id: "alice", folder_id: null, source_item_id: null,
      source_type: "library_upload", media_type: "video", url: "https://example.com/video.mp4", title: "Test",
      duration: 8, trim_start: null, trim_end: null });
    const image = db.insertAdLibraryAsset({ ...asset, id: undefined, media_type: "image", duration: null });
    // Environment adapters only: mimic the production shared library and verified users.
    const dependencies = {
      "next/server": dataModule("export const NextResponse = Response;"),
      "@/lib/guestMode": dataModule('export const GUEST_MODE = true; export const resolveUser = async req => req.headers.get("authorization") ? { id: req.headers.get("authorization"), email: req.headers.get("authorization") + "@example.com" } : null;'),
      "@/lib/guest/db": dataModule(`export * from ${JSON.stringify(dbUrl)}; import * as db from ${JSON.stringify(dbUrl)}; export const getAdLibraryAssets = () => db.getAdLibraryAssets("alice");`),
      "@/lib/supabase/admin": dataModule("export const supabaseAdmin = null;"),
      "@/lib/adLibraryReview": dataModule(compile(coreCode)),
    };
    let compiled = compile(routeCode);
    for (const [path, url] of Object.entries(dependencies)) compiled = compiled.replaceAll(`"${path}"`, JSON.stringify(url));
    const route = await import(dataModule(compiled));
    const get = async (user, assetId = asset.id) => {
      const request = new Request(`http://localhost/api/ad-library/comments?assetId=${assetId}`, { headers: user ? { authorization: user } : {} });
      request.nextUrl = new URL(request.url);
      return route.GET(request);
    };
    const post = (user, mutation) => route.POST(new Request("http://localhost/api/ad-library/comments", {
      method: "POST", headers: { "content-type": "application/json", ...(user ? { authorization: user } : {}) }, body: JSON.stringify({ assetId: asset.id, ...mutation }),
    }));
    assert.equal((await get(null)).status, 401);
    assert.equal((await post(null, { action: "create", body: "No" })).status, 401);
    assert.equal((await get("alice", "invalid")).status, 400);
    assert.equal((await get("alice", randomUUID())).status, 404);
    for (const body of ["", "   ", "x".repeat(4001)]) assert.equal((await post("alice", { action: "create", body, timecode: 0 })).status, 400);
    for (const timecode of [-1, 8.1, "4", {}]) assert.equal((await post("alice", { action: "create", body: "Test", timecode })).status, 400);
    assert.equal((await post("alice", { action: "create", body: "Image", assetId: image.id, timecode: 1 })).status, 400);

    assert.equal((await post("alice", { action: "create", body: "  Couper ici  ", timecode: 2.34, authorName: "Forged", authorId: "bob", resolved: true })).status, 201);
    let state = await (await get("bob")).json();
    assert.equal(state.currentUserId, "bob");
    const parent = state.comments[0];
    assert.equal(parent.authorId, "alice");
    assert.equal(parent.authorName, "alice");
    assert.equal(parent.body, "Couper ici");
    assert.equal(parent.timecode, 2.34);
    assert.equal(parent.resolved, false);
    assert.equal((await post("bob", { action: "delete", commentId: parent.id })).status, 403);
    assert.equal((await post("bob", { action: "resolve", commentId: parent.id, resolved: "true" })).status, 400);
    assert.equal((await post("bob", { action: "resolve", commentId: parent.id, resolved: true })).status, 200);
    assert.equal((await post("bob", { action: "create", body: "Compris", parentId: parent.id, timecode: null })).status, 201);
    state = await (await get("alice")).json();
    const reply = state.comments.find((entry) => entry.parentId === parent.id);
    assert.equal(reply.authorId, "bob");
    assert.equal((await post("alice", { action: "create", body: "Nested", parentId: reply.id })).status, 404);
    assert.equal((await post("alice", { action: "create", body: "Wrong asset", parentId: parent.id, assetId: image.id })).status, 404);
    assert.equal((await post("alice", { action: "create", body: "Invalid reply", parentId: parent.id, timecode: 1 })).status, 400);
    assert.equal((await post("alice", { action: "resolve", commentId: reply.id, resolved: true })).status, 400);
    assert.equal((await post("bob", { action: "resolve", commentId: parent.id, assetId: image.id, resolved: false })).status, 404);
    assert.equal((await post("alice", { action: "resolve", commentId: parent.id, resolved: false })).status, 200);

    const stored = JSON.parse(await readFile(join(directory, "data/guest-db.json"), "utf8"));
    assert.equal(stored.ad_library_comments.length, 2);
    assert.equal(stored.ad_library_comments.find((entry) => entry.id === parent.id).resolved, false);
    assert.equal((await post("alice", { action: "delete", commentId: parent.id })).status, 200);
    assert.equal((await (await get("bob")).json()).comments.length, 0, "deleting a thread also removes its replies");
    assert.equal((await post("alice", { action: "create", body: "Start", timecode: 0 })).status, 201);
    assert.equal((await post("alice", { action: "create", body: "General", timecode: null })).status, 201);
    db.deleteAdLibraryAsset(asset.id, "alice");
    assert.equal(db.getAdLibraryComments(asset.id).length, 0, "deleting media cascades to review comments");
  } finally {
    process.chdir(originalCwd);
    await rm(directory, { recursive: true, force: true });
  }
});
