import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

function fixture(mediaPromise, settings = {}) {
  const peers = [], requests = [], statuses = [], transcripts = [], inputs = [], mediaRequests = [];
  let tick;
  const track = new EventTarget();
  Object.assign(track, { stopped: false, readyState: "live", label: "Test microphone", stop() { this.stopped = true; } });
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  class Peer extends EventTarget {
    constructor() { super(); this.iceGatheringState = "complete"; this.connectionState = "new"; peers.push(this); }
    addTrack() {}
    createDataChannel() {
      this.channel = new EventTarget();
      Object.assign(this.channel, { readyState: "open", sent: [], send(data) { this.sent.push(JSON.parse(data)); }, close() { this.readyState = "closed"; } });
      return this.channel;
    }
    async createOffer() { return { type: "offer", sdp: "v=0\r\n" }; }
    async setLocalDescription(value) { this.localDescription = value; }
    async setRemoteDescription(value) { this.remoteDescription = value; }
    close() { this.connectionState = "closed"; }
  }
  class Audio { play() { return Promise.resolve(); } pause() {} }
  const context = { window: {}, navigator: { mediaDevices: { getUserMedia: (constraints) => { mediaRequests.push(constraints); return mediaPromise || Promise.resolve(stream); } } },
    RTCPeerConnection: Peer, Audio, MediaStream: class {}, setTimeout, clearTimeout, AbortController, AbortSignal, console,
    setInterval(fn) { tick = fn; return 1; }, clearInterval() { tick = null; },
    Date: { now: () => settings.now || 0 },
    fetch: async (url, options) => { requests.push({ url, options }); return Response.json({ session: { id: "live_opaque" }, transport: { type: "webrtc", sdp: "answer" } }); },
  };
  const source = fs.existsSync(new URL("../public/app/live-voice.js", import.meta.url)) ? fs.readFileSync(new URL("../public/app/live-voice.js", import.meta.url), "utf8") : "";
  context.window.AudioContext = class {
    state = "running";
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { fftSize: 256, getByteTimeDomainData(a) { a.fill(settings.sound ? 144 : 128); }, disconnect() {} }; }
    close() { return Promise.resolve(); }
  };
  vm.runInNewContext(source, context);
  assert.equal(typeof context.window.createLiveVoice, "function", "Live browser transport must be implemented");
  const client = context.window.createLiveVoice({ getToken: async () => "token", getFamilyId: () => "family", getLanguage: () => "en", getDeviceId: () => settings.deviceId || "", onInput: (v) => inputs.push(v), onState: (s) => statuses.push(s), onTranscript: (r) => transcripts.push(r) });
  const emit = (value) => { const event = new Event("message"); event.data = JSON.stringify(value); peers.at(-1).channel.dispatchEvent(event); };
  return { client, peers, requests, track, stream, emit, statuses, transcripts, inputs, mediaRequests, tick: () => tick?.() };
}
test("browser waits for session.started and sends microphone through WebRTC", async () => {
  const f = fixture();
  await f.client.start();
  assert.equal(f.requests[0].url, "/api/live/session");
  assert.equal(f.client.state().status, "connecting");
  assert.equal(f.peers[0].remoteDescription.sdp, "answer");
  f.emit({ type: "session.started", session: { id: "live_opaque" } });
  assert.equal(f.client.state().status, "connected");
  assert.equal(f.peers[0].channel.sent.some((e) => e.type === "session.start"), false);
  f.client.stop();
  assert.equal(f.track.stopped, true);
  assert.equal(f.peers[0].channel.sent.at(-1).type, "session.close");
  f.emit({ type: "session.closed", usage: { seconds: 2 } });
  assert.equal(f.peers[0].connectionState, "closed");
});
test("cancel during microphone permission closes the late stream without creating a session", async () => {
  let resolveMedia;
  const media = new Promise((resolve) => { resolveMedia = resolve; });
  const f = fixture(media);
  const start = f.client.start();
  f.client.stop();
  resolveMedia(f.stream);
  await start;
  assert.equal(f.track.stopped, true);
  assert.equal(f.requests.length, 0);
});
test("overlapping transcript fragments preserve both speakers and ignore duplicate events", async () => {
  const f = fixture(); await f.client.start();
  f.emit({ type: "session.started", session: { id: "live_opaque" } });
  const input = { type: "session.input_transcript.delta", event_id: "one", delta: "Where ", start_ms: 0, end_ms: 50 };
  f.emit(input); f.emit(input);
  f.emit({ type: "session.output_transcript.delta", event_id: "two", delta: "I'm here.", start_ms: 20, end_ms: 80 });
  f.emit({ type: "session.input_transcript.delta", event_id: "three", delta: "are my keys?", start_ms: 50, end_ms: 150 });
  const rows = f.client.transcript();
  assert.equal(rows.filter((r) => r.role === "user").map((r) => r.text).join(""), "Where are my keys?");
  assert.equal(rows.filter((r) => r.role === "assistant").map((r) => r.text).join(""), "I'm here.");
  f.client.dispose();
});
test("transport failure stops audio capture and exposes a retryable error", async () => {
  const f = fixture(); await f.client.start();
  f.peers[0].connectionState = "failed";
  f.peers[0].dispatchEvent(new Event("connectionstatechange"));
  assert.equal(f.track.stopped, true);
  assert.equal(f.client.state().status, "error");
  f.client.dispose();
});


test("selected microphone is used and its actual sound level is reported", async () => {
  const f = fixture(null, {deviceId: "headset", sound: true});
  await f.client.start(); f.tick();
  assert.equal(f.mediaRequests[0].audio.deviceId.exact, "headset");
  assert.ok(f.inputs.at(-1).level > 0);
  assert.equal(f.inputs.at(-1).label, "Test microphone");
  f.client.dispose();
});

test("silent microphone produces a useful warning without ending a connected session", async () => {
  const settings = {now: 0}; const f = fixture(null, settings);
  await f.client.start(); f.emit({type: "session.started"});
  settings.now = 10000; f.tick();
  assert.equal(f.inputs.at(-1).silent, true);
  assert.equal(f.client.state().status, "connected");
  f.client.dispose();
});

test("unplugging the input stops the conversation and reports a microphone error", async () => {
  const f = fixture(); await f.client.start();
  f.track.dispatchEvent(new Event("ended"));
  assert.equal(f.client.state().error, "LIVE_MIC_ENDED");
  assert.equal(f.peers[0].connectionState, "closed");
  f.client.dispose();
});
