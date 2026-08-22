import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const htmlPath = new URL("../public/app/index.html", import.meta.url);
const appSource = readFileSync(htmlPath, "utf8");

function section(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = start < 0 ? -1 : appSource.indexOf(endMarker, start);
  return {
    found: start >= 0 && end > start,
    source: start >= 0 && end > start ? appSource.slice(start, end) : "",
  };
}

const homeSection = section("function tabHome(){", "/* 家人端首页的待办");
const confirmSection = section("function confirmCard(){", "/* 今日摘要");
const peopleSection = section("function tabPeople(){", "function tabbar(){");
const talkingSection = section("function viewTalking(){", "function viewQa(){");
const reminderSection = section("function openNewReminder(){", "function syncSubs(){");
const audioSection = section("function callAudioSrc(", "function syncSubs(){");
const callTimelineSection = section("var CALL_CUES=", "function syncSubs(){");

function familyContext(overrides = {}) {
  const context = {
    St: {
      elder: { name: "Margaret" },
      paired: true,
      call: { phase: "idle", dir: "in", line: 0 },
      people: [{ id: "p1", nick: "Peter", relation: "Son" }],
    },
    D: {
      greet: "Hello",
      greetSub: "A calm overview for {elder}",
      notPaired: "NOT_PAIRED",
      notPairedD: "PAIR {code}",
      inRingT: "INCOMING",
      inRingD: "INCOMING_DETAIL",
      fDecline: "Decline",
      fAnswer: "Answer",
      ringT: "RINGING",
      ringD: "RINGING_DETAIL",
      talkT: "On a call",
      talkD: "Recording demo",
      hangup: "Hang up",
      callBtn: "Call Margaret",
      peopleT: "Family",
      peopleSub: "Family profiles",
      meTag: "You",
      familyCodeT: "Family code",
      familyCodeD: "Share this code",
      settingsT: "Settings",
      langRow: "Language",
      langRowV: "English",
      logoutT: "Log out",
      logoutD: "Log out detail",
    },
    App: { callNeedsPlay: false },
    esc: (value) => String(value),
    fill: (value, values) => String(value).replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""),
    alertBar: () => "ALERT_BAR",
    riskState: () => "none",
    pendingCard: () => "PENDING_CARD",
    todaySummary: () => "TODAY_SUMMARY",
    todoCard: () => "TODO_CARD",
    confirmCard: () => "CONFIRM_CARD",
    statusText: () => "WAITING_FOR_LOCATION",
    me: () => ({ nick: "Peter", relation: "Son" }),
    avatarHTML: () => "PETER_AVATAR",
    callDir: () => "in",
    waveEl: () => "WAVE",
    callTranscript: () => '<div class="call-transcript">TRANSCRIPT</div>',
    callPlaybackButton: () => "",
    selectedMemberId: () => "p1",
    ...overrides,
  };
  return context;
}

test("family home describes the elder without location waiting or caregiver identity", () => {
  assert.equal(homeSection.found, true);
  const output = vm.runInNewContext(`${homeSection.source}\ntabHome();`, familyContext());

  assert.match(output, /Margaret/);
  assert.match(output, /A calm overview for Margaret/);
  assert.doesNotMatch(output, /WAITING_FOR_LOCATION/);
  assert.doesNotMatch(output, /Peter|Son|PETER_AVATAR/);
  assert.doesNotMatch(output, /CONFIRM_CARD/);
});

test("family call review is presented as a modal instead of an inline home card", () => {
  assert.equal(confirmSection.found, true);
  const context = familyContext({
    callItems: () => [{ id: "fact-1", type: "fact", text: "Saturday visit", status: "open" }],
    todoLine: () => "Reminder",
    tp: (value) => String(value),
  });
  Object.assign(context.D, {
    cfT: "Call summary",
    cfD: "Review what was captured",
    tTodo: "Reminder",
    tFact: "Fact",
    aOk: "Confirm",
    aEdit: "Edit",
    aSkip: "Ignore",
  });

  const output = vm.runInNewContext(`${confirmSection.source}\nconfirmCard();`, context);

  assert.match(output, /class="sheet-mask call-review-mask"/);
  assert.match(output, /role="dialog"/);
  assert.match(output, /Saturday visit/);
});

test("family call view and elder call view both show the synchronized transcript", () => {
  const familyOutput = vm.runInNewContext(
    `${homeSection.source}\ntabHome();`,
    familyContext({
      St: {
        elder: { name: "Margaret" },
        paired: true,
        call: { phase: "talking", dir: "in", line: 2 },
        people: [{ id: "p1", nick: "Peter", relation: "Son" }],
      },
    }),
  );
  assert.match(familyOutput, /class="call-transcript"/);

  assert.equal(talkingSection.found, true);
  const elderOutput = vm.runInNewContext(`${talkingSection.source}\nviewTalking();`, {
    St: { elder: { name: "Margaret" }, call: { phase: "talking", dir: "out", line: 2 } },
    D: { eOnCall: "On a call", hangup: "Hang up" },
    App: { callNeedsPlay: false },
    focusPerson: () => ({ nick: "Peter", relation: "Son" }),
    esc: (value) => String(value),
    callTranscript: () => '<div class="call-transcript">TRANSCRIPT</div>',
    callPlaybackButton: () => "",
  });
  assert.match(elderOutput, /class="call-transcript"/);
});

test("call demo audio starts both devices at the shared elapsed position and stops after the call", async () => {
  assert.equal(audioSection.found, true);
  const players = [];
  class FakeAudio {
    constructor(src) {
      this.src = src;
      this.currentTime = 0;
      this.paused = true;
      this.playCount = 0;
      this.pauseCount = 0;
      players.push(this);
    }
    play() {
      this.paused = false;
      this.playCount += 1;
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
      this.pauseCount += 1;
    }
  }
  const context = {
    St: { lang: "en", call: { phase: "talking", startedAt: 1_000 } },
    App: { callNeedsPlay: false },
    Audio: FakeAudio,
    Date: { now: () => 6_000 },
    render: () => {},
    setTimeout,
    CallAudio: { player: null, src: "" },
  };
  vm.runInNewContext(`${audioSection.source}\nsyncCallAudio(true);`, context);
  await Promise.resolve();

  assert.equal(players.length, 1);
  assert.equal(players[0].src, "/app/call-demo-en.wav");
  assert.equal(players[0].currentTime, 5);
  assert.equal(players[0].playCount, 1);

  context.St.call.phase = "ended";
  vm.runInNewContext("syncCallAudio(false);", context);
  assert.equal(players[0].pauseCount, 1);
});

test("call demo ships fixed English and Chinese recordings", () => {
  for (const file of ["call-demo-en.wav", "call-demo-zh.wav"]) {
    const url = new URL(`../public/app/${file}`, import.meta.url);
    assert.equal(existsSync(url), true, `${file} should exist`);
    assert.ok(statSync(url).size > 10_000, `${file} should contain recorded speech`);
  }
});

test("call subtitle timing follows the shared recording timeline", () => {
  assert.equal(callTimelineSection.found, true);
  const context = {};
  vm.runInNewContext(callTimelineSection.source, context);
  const state = { lang: "en", call: { startedAt: 1_000 } };

  assert.equal(context.callLineAt(state, 1_000), 0);
  assert.equal(context.callLineAt(state, 7_000), 2);
  assert.equal(context.callLineAt(state, 19_000), 5);
  assert.equal(context.callLineAt(state, 22_000), 6);
});

test("add reminder opens a new reminder directly in the Reminders tab", () => {
  assert.equal(reminderSection.found, true);
  const context = {
    App: { tab: 0, cal: { open: null } },
    newTodo: () => ({ id: "todo-new", type: "todo" }),
    queueUpdate: (mutator) => mutator(context.state),
    state: { facts: [] },
  };

  vm.runInNewContext(`${reminderSection.source}\nopenNewReminder();`, context);

  assert.equal(context.App.tab, 2);
  assert.equal(context.App.cal.open, "todo-new");
  assert.deepEqual(context.state.facts, [{ id: "todo-new", type: "todo" }]);
});

test("family profile page no longer offers Add another relative", () => {
  assert.equal(peopleSection.found, true);
  const output = vm.runInNewContext(
    `${peopleSection.source}\ntabPeople();`,
    familyContext({
      App: { editingPerson: null },
      St: {
        code: "527487",
        people: [{ id: "p1", nick: "Peter", relation: "Son" }],
      },
      viewObMe: () => "EDIT_PROFILE",
    }),
  );

  assert.doesNotMatch(output, /data-go="addPerson"/);
});
