import assert from "node:assert/strict";
import test from "node:test";
import {
  getOutputVideoUrl, getRemovalProgress, replicateRequest, validateVideoUrl,
} from "../lib/videoTextRemoval.ts";

test("only public HTTPS video URLs can reach Replicate", () => {
  const url = "https://cdn.example.com/video.mp4?signature=abc";
  assert.equal(validateVideoUrl(url), url);
  for (const invalid of [null, {}, "", "/generated/video.mp4", "blob:https://example.com/123", "file:///tmp/a", "http://cdn.example.com/a", "https://127.0.0.1/a", "https://2130706433/a", "https://0x7f000001/a", "https://[::1]/a", "https://localhost/a", "https://host.internal/a", "https://user:password@example.com/a", "https://example.com:8080/a"]) {
    assert.throws(() => validateVideoUrl(invalid), { status: 400 }, String(invalid));
  }
});

test("output download is restricted to Replicate file storage", () => {
  assert.equal(getOutputVideoUrl("https://replicate.delivery/a.mp4"), "https://replicate.delivery/a.mp4");
  assert.equal(getOutputVideoUrl("https://pbxt.replicate.delivery/a.mp4"), "https://pbxt.replicate.delivery/a.mp4");
  for (const output of [null, [], { url: "https://replicate.delivery/a" }, "https://replicate.delivery.attacker.com/a", "https://example.com/a"]) assert.throws(() => getOutputVideoUrl(output));
});

test("progress uses the latest measured frame count and reserves completion for saving", () => {
  assert.equal(getRemovalProgress("Loading models"), undefined);
  assert.equal(getRemovalProgress("Progress: 30/300 frames (10.0%)\nProgress: 180/300 frames (60.0%)"), 60);
  assert.equal(getRemovalProgress("Progress: 300/300 frames (100.0%)"), 99);
});

test("provider failures are actionable and never disclose raw secrets", async (t) => {
  for (const [status, expected, text] of [[401, 502, "token"], [403, 502, "token"], [402, 502, "crédits"], [429, 429, "demandes"], [404, 410, "expiré"], [500, 502, "indisponible"]]) {
    const mock = t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ detail: "secret-token" }), { status }));
    await assert.rejects(replicateRequest("test-token", "/abc"), (error) => error.status === expected && error.message.includes(text) && !error.message.includes("secret-token"));
    mock.mock.restore();
  }
});

test("unexpected provider payloads are rejected", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ id: "../escape", status: "succeeded" }));
  await assert.rejects(replicateRequest("test-token", ""), { status: 502 });
});
