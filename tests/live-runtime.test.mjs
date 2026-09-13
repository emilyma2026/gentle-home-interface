import assert from "node:assert/strict";
import { test } from "node:test";

const runtime = await import("../server/live-runtime.mjs").catch(() => ({}));
const familyId = "11111111-1111-4111-8111-111111111111";
const env = { OPENAI_API_KEY: "server-secret", VITE_SUPABASE_URL: "https://family.example", VITE_SUPABASE_ANON_KEY: "public-key" };
const state = { lang: "en", facts: [
  { id: "confirmed", status: "done", type: "fact", text: "Peter will visit on Sunday." },
  { id: "draft", status: "open", type: "fact", text: "UNCONFIRMED" },
], people: [{ nick: "Peter", phone: "PRIVATE_PHONE", photo: "PRIVATE_PHOTO" }] };
function request(path, body, token = "user-token") {
  return new Request("http://localhost/api/live/" + path, {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: JSON.stringify({ familyId, ...body }),
  });
}
async function handle(...args) {
  assert.equal(typeof runtime.handleLiveRequest, "function", "Live request handler must be implemented");
  return runtime.handleLiveRequest(...args);
}
function stub(answer, capture = []) {
  return async (url, options) => {
    capture.push({ url, options });
    if (url.startsWith("https://family.example/")) return Response.json([{ payload: state }]);
    return answer;
  };
}
test("Live denies unauthenticated session creation before contacting providers", async () => {
  let calls = 0;
  const res = await handle(request("session", { sdp: "v=0\r\n" }, ""), env, async () => { calls++; });
  assert.equal(res.status, 401);
  assert.equal(calls, 0);
});
test("Live checks family membership with the caller token and fixes the voice model on the server", async () => {
  const calls = [];
  const res = await handle(request("session", { sdp: "v=0\r\n", model: "other-model" }), env,
    stub(Response.json({ session: { id: "live_opaque" }, transport: { type: "webrtc", sdp: "answer" }, secret: "never-return" }, { status: 201 }), calls));
  assert.equal(res.status, 201);
  assert.equal(calls[0].options.headers.authorization, "Bearer user-token");
  assert.match(calls[0].url, /family_id=eq\.11111111/);
  assert.equal(calls[1].url, "https://api.openai.com/v1/live/sessions");
  const sent = JSON.parse(calls[1].options.body);
  assert.equal(sent.session.model, "gpt-live-1");
  assert.equal(sent.session.delegation.type, "client");
  assert.equal(sent.transport.sdp, "v=0\r\n");
  assert.equal(sent.session.store, false);
  assert.doesNotMatch(calls[1].options.body, /PRIVATE_PHONE|PRIVATE_PHOTO|UNCONFIRMED/);
  assert.deepEqual(await res.json(), { session: { id: "live_opaque" }, transport: { type: "webrtc", sdp: "answer" } });
});
test("Live denies another family's data even with a valid session token", async () => {
  const res = await handle(request("session", { sdp: "v=0\r\n" }), env, async () => Response.json([]));
  assert.equal(res.status, 403);
});
test("Live rejects cross-origin requests and oversized payloads", async () => {
  const req = request("session", { sdp: "v=0\r\n" });
  req.headers.set("origin", "https://untrusted.example");
  assert.equal((await handle(req, env)).status, 403);
  assert.equal((await handle(request("session", { sdp: "v=0" + "x".repeat(70000) }), env)).status, 413);
});
test("Live lookup returns the stored fact rather than a model-authored answer", async () => {
  const calls = [];
  const res = await handle(request("query", { transcript: [{ role: "user", text: "When is Peter coming?" }] }), env,
    stub(Response.json({ choices: [{ message: { content: JSON.stringify({ question: "When is Peter coming?", factId: "confirmed", needsFamily: false, answer: "He comes tomorrow" }) } }] }), calls));
  const body = await res.json();
  assert.equal(body.answer, "Peter will visit on Sunday.");
  assert.equal(body.factId, "confirmed");
  assert.doesNotMatch(calls[1].options.body, /UNCONFIRMED|PRIVATE_PHONE/);
});
test("Unconfirmed or invented fact IDs are sent to family confirmation", async () => {
  for (const factId of ["draft", "invented", null]) {
    const res = await handle(request("query", { transcript: [{ role: "user", text: "Where are my keys?" }] }), env,
      stub(Response.json({ choices: [{ message: { content: JSON.stringify({ question: "Where are my keys?", factId, needsFamily: true }) } }] })));
    const body = await res.json();
    assert.equal(body.needsFamily, true);
    assert.equal(body.answer, null);
  }
});
test("Live reports missing credentials and provider failures without exposing secrets", async () => {
  const missing = await handle(request("session", { sdp: "v=0\r\n" }), { ...env, OPENAI_API_KEY: "" }, stub(Response.json({})));
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).error, "LIVE_KEY_MISSING");
  const failed = await handle(request("session", { sdp: "v=0\r\n" }), env, stub(Response.json({ error: { message: "server-secret" } }, { status: 403 })));
  assert.equal(failed.status, 502);
  assert.doesNotMatch(await failed.text(), /server-secret/);
});
