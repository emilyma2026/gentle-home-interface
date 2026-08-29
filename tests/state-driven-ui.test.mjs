import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import vm from "node:vm";

const appSource = readFileSync(new URL("../public/app/index.html", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");

function loadRouteOptions() {
  const compiled = ts.transpileModule(routeSource, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  const fakeRequire = (specifier) => {
    if (specifier === "@tanstack/react-router") {
      return { createFileRoute: () => (options) => ({ options, useSearch: () => ({}) }) };
    }
    if (specifier === "react/jsx-runtime") {
      return { jsx: () => null, jsxs: () => null };
    }
    throw new Error(`Unexpected route dependency: ${specifier}`);
  };
  vm.runInNewContext(compiled, { exports: module.exports, module, require: fakeRequire, URLSearchParams });
  return module.exports.Route.options;
}

function between(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = start < 0 ? -1 : appSource.indexOf(endMarker, start);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  return appSource.slice(start, end);
}

test("automatic elder pronouns follow the configured relationship instead of a fixed gender", () => {
  const source = between("function elderGrammar(", "function esc(");
  const context = { St: null };
  vm.runInNewContext(source, context);

  assert.equal(context.elderGrammar({ elder: { name: "Dad", pronouns: "auto" } }).subject, "he");
  assert.equal(context.elderGrammar({ elder: { name: "妈妈", pronouns: "auto" } }).subject, "she");
  assert.equal(context.elderGrammar({ elder: { name: "Alex", pronouns: "auto" } }).subject, "they");
  assert.equal(context.elderGrammar({ elder: { name: "Dad", pronouns: "she" } }).subject, "she");
});

test("call recognition follows the active call person instead of a stale previous caller", () => {
  const source = between("function focusPerson(", "function elderGrammar(");
  const state = {
    people: [
      { id: "p1", nick: "Emily", photo: "emily" },
      { id: "p2", nick: "Peter", photo: "peter" },
    ],
    lastCaller: "p1",
    call: { phase: "ringing", personId: "p2" },
  };
  const context = {};
  vm.runInNewContext(source, context);

  assert.equal(context.focusPerson(state).nick, "Peter");
  assert.equal(context.focusPerson(state).photo, "peter");
});

test("a reminder stays family-only as a draft and disappears from the elder home once completed", () => {
  const source = between("function todoDate(", "function dayParts(");
  const date = "2026-08-24";
  const state = {
    facts: [
      { id: "draft", type: "todo", status: "draft", date, repeat: "none", done: {}, what: "Draft" },
      {
        id: "saved",
        type: "todo",
        status: "done",
        date,
        repeat: "none",
        done: {},
        what: "Medicine",
      },
    ],
  };
  const context = { St: state, todayKey: () => date, App: { cal: { sel: date } }, Date, Math };
  vm.runInNewContext(source, context);

  assert.deepEqual(
    Array.from(context.todosOn(state, date), (item) => item.id),
    ["saved"],
  );
  assert.deepEqual(
    Array.from(context.todosOn(state, date, true), (item) => item.id),
    ["draft", "saved"],
  );
  assert.equal(context.todayTodoOf(state).id, "saved");
  context.markTodoDone(state, "saved", date, true);
  assert.equal(context.todayTodoOf(state), null);
  assert.equal(
    state.facts.length,
    2,
    "completion checks the original row instead of appending one",
  );
});

test("unfinished reminder drafts stay with the family member who created them", () => {
  const source = between("function todoDate(", "function dayParts(");
  const date = "2026-08-24";
  const state = {
    facts: [
      { id: "mine", ownerId: "family-1", type: "todo", status: "draft", date, repeat: "none" },
      { id: "theirs", ownerId: "family-2", type: "todo", status: "draft", date, repeat: "none" },
      { id: "legacy", type: "todo", status: "draft", date, repeat: "none" },
      { id: "saved", type: "todo", status: "done", date, repeat: "none" },
    ],
  };
  const context = {
    St: state,
    App: { cal: { sel: date } },
    selectedMemberId: () => "family-1",
    todayKey: () => date,
    Date,
    Math,
  };
  vm.runInNewContext(source, context);

  assert.deepEqual(
    Array.from(context.todosOn(state, date, true), (item) => item.id),
    ["mine", "legacy", "saved"],
  );
});

test("a second device cannot replace an active family call", () => {
  const source = between("function callDir(", "function elderScreen(");
  const state = { call: { phase: "idle" }, people: [], lastCaller: null };
  const context = { Date, Math };
  vm.runInNewContext(source, context);

  assert.equal(context.beginSharedCall(state, "p1", "in", "call-1"), true);
  assert.equal(context.beginSharedCall(state, "p2", "in", "call-2"), false);
  assert.equal(state.call.id, "call-1");
  assert.equal(state.call.personId, "p1");
});

test("alerts are derived from current risk and a fresh departure reopens a cleared alert", () => {
  const riskSource = between("function riskState(){", "function statusText(){");
  const gpsSource = between("function applyGpsPosition(", "function startGps(){");
  const state = {
    home: { lat: 1, lng: 1, radiusM: 800 },
    loc: { lat: 1, lng: 1 },
    locReported: true,
    alertCleared: true,
    risk: { state: "safe", outsideCount: 2 },
    guide: { active: false, done: false, step: 0 },
    timeline: [{ kind: "home", date: "2026-08-23" }],
  };
  const context = {
    St: state,
    App: { route: "family" },
    D: {},
    window: { Navigation: { distanceMeters: () => 1200 } },
    homePoint: (s) => s.home,
    rangeM: () => 800,
    queueUpdate: (mutator) => mutator(state),
    clockNow: () => "17:11",
    todayKey: () => "2026-08-24",
    render: () => {},
  };
  vm.runInNewContext(`${riskSource}\n${gpsSource}`, context);

  assert.equal(context.riskState(), "none", "historical timeline rows do not keep an alert alive");
  context.applyGpsPosition({ coords: { latitude: 2, longitude: 2, accuracy: 5 } });
  assert.equal(state.alertCleared, false);
  assert.equal(state.guide.active, true);
  assert.equal(context.riskState(), "on");
});

test("live weather uses the elder's reported position and synchronizes its timezone", async () => {
  const source = between("var Weather={", "/* 读给我听");
  const state = {
    homeSet: true,
    locReported: true,
    home: { lat: 23.1291, lng: 113.3644 },
    loc: { lat: 1.3521, lng: 103.8198 },
    timezone: "",
  };
  let requestedUrl = "";
  const context = {
    St: state,
    App: { route: "elder" },
    Date,
    D: {},
    homeOf: (s) => s.home,
    locOf: (s) => s.loc,
    queueUpdate: (mutator) => mutator(state),
    render: () => {},
    fetch: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        json: async () => ({
          current: { temperature_2m: 29.6, weather_code: 3 },
          timezone: "Asia/Singapore",
        }),
      };
    },
  };
  vm.runInNewContext(source, context);
  await context.ensureWeather(true);

  assert.match(requestedUrl, /latitude=1\.3521/);
  assert.match(requestedUrl, /longitude=103\.8198/);
  assert.equal(context.Weather.data.temp, 30);
  assert.equal(state.timezone, "Asia/Singapore");

  let failedRequests = 0;
  context.fetch = async () => {
    failedRequests += 1;
    return { ok: false, json: async () => null };
  };
  await context.ensureWeather(true);
  assert.equal(context.Weather.state, "failed");
  assert.equal(context.Weather.data, null);
  await context.ensureWeather(false);
  assert.equal(failedRequests, 1, "a failure remains visible until the user retries");
});

test("ending the in-app call extracts its transcript instead of always inserting fallback rows", async () => {
  const source = between("var endingCall=false;", "function setLoc(");
  const state = { facts: [], timeline: [], call: { phase: "talking", personId: null, dir: "in" } };
  let extractions = 0;
  const context = {
    St: state,
    callActive: (target) => ["ringing", "talking"].includes(target?.call?.phase),
    isSameCall: (target, snapshot) =>
      target.call.personId === snapshot.personId && target.call.dir === snapshot.dir,
    hasPendingCallItem: () => false,
    extractCallItems: async () => {
      extractions += 1;
      return [
        {
          id: "from-input",
          type: "fact",
          origin: "call",
          status: "open",
          text: "Input-derived fact",
        },
      ];
    },
    queueUpdate: (mutator) => mutator(state),
    clockNow: () => "17:12",
    todayKey: () => "2026-08-24",
  };
  vm.runInNewContext(source, context);
  await context.endCall();

  assert.equal(extractions, 1);
  assert.equal(state.facts[0].text, "Input-derived fact");
  assert.equal(state.call.phase, "ended");
});

test("the memory chat reports an API failure without synthesizing a proposal", async () => {
  const source = between("async function chatSend(", "function chatSaveProp(");
  const input = { value: "Something to do today" };
  const context = {
    App: {
      chat: {
        voiceActive: false,
        draft: "",
        msgs: [],
        busy: false,
        seedPend: null,
      },
    },
    D: { chatFailed: "That didn't go through. Try saying it again." },
    St: { lang: "en", elder: { name: "Mom" }, people: [] },
    aiAsk: async () => null,
    aiJSON: () => null,
    el: (id) => (id === "chatIn" ? input : null),
    render: () => {},
    todayKey: () => "2026-08-29",
  };

  vm.runInNewContext(source, context);
  await context.chatSend();

  assert.equal(context.App.chat.busy, false);
  assert.equal(context.App.chat.msgs[1].role, "ai");
  assert.equal(context.App.chat.msgs[1].text, "That didn't go through. Try saying it again.");
  assert.equal(context.App.chat.msgs.length, 2);
});

test("browser AI requests carry the active Supabase access token", async () => {
  const source = between("var AI={", "/* 模型偶尔会在 JSON 外面包一层反引号");
  let requestOptions = null;
  const context = {
    SupabaseClient: {
      auth: {
        getSession: async () => ({ data: { session: { access_token: "session-token" } } }),
      },
    },
    window: { AbortController: null },
    fetch: async (_url, options) => {
      requestOptions = options;
      return {
        ok: true,
        json: async () => ({ provider: "openai", text: "model response" }),
      };
    },
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(source, context);

  const output = await context.aiAsk({ system: "system", user: "user", json: false });

  assert.equal(output, "model response");
  assert.equal(requestOptions.headers.authorization, "Bearer session-token");
});

test("navigation distance copy measures the current position from home", () => {
  const source = between("function guideHomeDistance(", "function viewGuide(");
  const home = { lat: 1, lng: 1 };
  const current = { lat: 2, lng: 2 };
  let measuredDestination = null;
  const context = {
    St: { home },
    homePoint: (state) => state.home,
    window: {
      Navigation: {
        distanceMeters: (_from, destination) => {
          measuredDestination = destination;
          return 896;
        },
      },
    },
  };
  vm.runInNewContext(source, context);

  assert.equal(context.guideHomeDistance(current), 896);
  assert.equal(measuredDestination, home);
});

test("the comparison route embeds both roles for the same family", () => {
  assert.doesNotMatch(routeSource, /typeof window/);
  assert.match(routeSource, /Route\.useSearch\(\)/);
  assert.match(routeSource, /frame\.set\("dualRole", role\)/);
  assert.match(routeSource, /frameSrc\("family"\)/);
  assert.match(routeSource, /frameSrc\("elder"\)/);
  assert.match(routeSource, /Family side/);
  assert.match(routeSource, /Elder side/);
});

test("the root route keeps empty comparison defaults out of the address and preserves a valid family code", () => {
  const validateSearch = loadRouteOptions().validateSearch;

  assert.deepEqual({ ...validateSearch({}) }, {});
  assert.deepEqual(
    { ...validateSearch({ compare: "1", code: "527487", localDemo: false }) },
    { compare: true, code: "527487" },
  );
});
