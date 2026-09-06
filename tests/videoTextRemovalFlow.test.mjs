import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import ts from "typescript";

const dataModule = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;

test("removal workflow persists, isolates owners, deduplicates submissions and saves exactly once", async (t) => {
  const originalCwd = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), "helios-subtitles-test-"));
  const originalToken = process.env.REPLICATE_API_TOKEN;
  const originalCallback = process.env.CALLBACK_BASE_URL;
  const coreUrl = new URL("../lib/videoTextRemoval.ts", import.meta.url).href;
  const dbUrl = new URL("../lib/guest/db.ts", import.meta.url).href;
  const code = await readFile(new URL("../lib/server/videoTextRemoval.ts", import.meta.url), "utf8");
  let uploads = 0;
  let posts = 0;
  let predictionState = "processing";
  let rejectDownload = false;
  let lastBody;
  globalThis.__textRemovalUpload = async (buffer, type, folder) => {
    uploads++;
    assert.equal(buffer.toString(), "video-bytes");
    assert.equal(type, "video/mp4");
    assert.equal(folder, "videos");
    return "https://cdn.example.com/cleaned.mp4";
  };
  const dependencies = {
    "@/lib/guestMode": dataModule("export const GUEST_MODE = true"),
    "@/lib/guest/db": dbUrl,
    "@/lib/supabase/admin": dataModule("export const supabaseAdmin = null"),
    "@/lib/r2": dataModule("export const uploadBuffer = (...args) => globalThis.__textRemovalUpload(...args)"),
    "@/lib/videoTextRemoval": coreUrl,
  };
  // Only replace environment adapters; run the actual production orchestration.
  let compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace('import "server-only";', "");
  for (const [path, url] of Object.entries(dependencies)) compiled = compiled.replaceAll(`"${path}"`, `"${url}"`);
  process.chdir(directory);
  process.env.CALLBACK_BASE_URL = "https://helios.example.com";
  process.env.REPLICATE_API_TOKEN = "test-replicate-secret";
  const sourceUrl = "https://cdn.example.com/original.mp4";
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url.startsWith("https://replicate.delivery/")) {
      assert.equal(init.redirect, "error");
      return rejectDownload ? new Response("unavailable", { status: 503 }) : new Response("video-bytes");
    }
    assert.ok(url.startsWith("https://api.replicate.com/v1/predictions"));
    assert.equal(init.headers.Authorization, "Bearer test-replicate-secret");
    if (init.method === "POST" && !url.endsWith("/cancel")) {
      posts++;
      lastBody = JSON.parse(init.body);
      assert.equal(init.headers["Cancel-After"], "1h");
      return Response.json({ id: `prediction${posts}`, status: "starting" });
    }
    return Response.json({ id: url.split("/").at(-1), status: predictionState, output: "https://replicate.delivery/output.mp4", input: { video: sourceUrl }, logs: "Progress: 120/200 frames (60.0%)" });
  });
  try {
    const service = await import(dataModule(compiled));
    const db = await import(dbUrl);
    const id = randomUUID();
    delete process.env.REPLICATE_API_TOKEN;
    await assert.rejects(service.startRemoval(id, "owner", sourceUrl), { status: 503 });
    assert.equal(posts, 0);
    assert.equal(await service.findRemovalJob(id, "owner"), null);
    process.env.REPLICATE_API_TOKEN = "test-replicate-secret";
    const [started] = await Promise.all([service.startRemoval(id, "owner", sourceUrl), service.startRemoval(id, "owner", sourceUrl)]);
    assert.equal(started.status, "pending");
    assert.equal(lastBody.version, "247c8385f3c6c322110a6787bd2d257acc3a3d60b9ed7da1726a628f72a42c4d");
    assert.equal(lastBody.input.video, sourceUrl);
    assert.equal(lastBody.input.method, "hybrid");
    assert.deepEqual(lastBody.webhook_events_filter, ["completed"]);
    const callback = new URL(lastBody.webhook);
    assert.equal(callback.pathname, "/api/remove-video-text/callback");
    assert.equal(service.verifyWebhookSignature(id, callback.searchParams.get("signature")), true);
    assert.equal(service.verifyWebhookSignature(randomUUID(), callback.searchParams.get("signature")), false);
    assert.equal(service.verifyWebhookSignature(id, "0".repeat(64)), false);
    assert.equal(service.verifyWebhookSignature(id, "invalid"), false);
    await service.startRemoval(id, "owner", sourceUrl);
    assert.equal(posts, 1, "retry cannot charge twice");
    await assert.rejects(service.pollRemoval(id, "another-user"), { status: 404 });
    assert.deepEqual(await service.listRemovalJobs("another-user"), []);
    const processing = await service.pollRemoval(id, "owner");
    assert.equal(processing.progress, 60);
    assert.equal(processing.sourceUrl, sourceUrl);
    predictionState = "succeeded";
    rejectDownload = true;
    await assert.rejects(service.pollRemoval(id, "owner"), { status: 503 });
    assert.equal((await service.findRemovalJob(id, "owner")).status, "pending", "storage failures stay retryable");
    rejectDownload = false;
    const [done, duplicate] = await Promise.all([service.pollRemoval(id, "owner"), service.pollRemoval(id, "owner")]);
    assert.equal(done.status, "done");
    assert.equal(duplicate.videoUrl, done.videoUrl);
    assert.equal(uploads, 1);
    assert.equal((await service.pollRemoval(id, "owner")).videoUrl, "https://cdn.example.com/cleaned.mp4");
    assert.equal(db.getGenerations("owner", "video").length, 1);
    assert.equal((await service.listRemovalJobs("owner")).length, 0);

    const failedId = randomUUID();
    await service.startRemoval(failedId, "owner", sourceUrl);
    predictionState = "failed";
    assert.equal((await service.pollRemoval(failedId, "owner")).status, "error");
    const canceledId = randomUUID();
    await service.startRemoval(canceledId, "owner", sourceUrl);
    predictionState = "canceled";
    assert.match((await service.pollRemoval(canceledId, "owner")).error, /annulé/);
    assert.equal(uploads, 1, "failed and canceled predictions never save a video");

    predictionState = "processing";
    for (let n = 0; n < 3; n++) await service.startRemoval(randomUUID(), "owner", sourceUrl);
    await assert.rejects(service.startRemoval(randomUUID(), "owner", sourceUrl), { status: 429 });
    await assert.rejects(service.pollRemoval("../../escape", "owner"), { status: 400 });
  } finally {
    process.chdir(originalCwd);
    if (originalToken === undefined) delete process.env.REPLICATE_API_TOKEN; else process.env.REPLICATE_API_TOKEN = originalToken;
    if (originalCallback === undefined) delete process.env.CALLBACK_BASE_URL; else process.env.CALLBACK_BASE_URL = originalCallback;
    delete globalThis.__textRemovalUpload;
    await rm(directory, { recursive: true, force: true });
  }
});
