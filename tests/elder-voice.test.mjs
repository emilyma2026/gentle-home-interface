import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const appSource = readFileSync(new URL("../public/app/index.html", import.meta.url), "utf8");

function section(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = start < 0 ? -1 : appSource.indexOf(endMarker, start);
  return {
    found: start >= 0 && end > start,
    source: start >= 0 && end > start ? appSource.slice(start, end) : "",
  };
}

const todoSection = section("function elderTodoText(", "function todoMeta(");
const qaViewSection = section("function viewQa(){", "/* 老人不用记号码");
const freeQuestionSection = section("async function askFree(", "async function ask(i){");
const voiceSection = section("function beginElderVoice(){", "async function askFree(");
const pendingSection = section("function pendingGrouped(){", "function confirmCard(){");
const saveAnswerSection = section("function saveAnswer(", "function skipAnswer(");
const i18nStart = appSource.indexOf("var I18N = {");
const i18nEnd = appSource.indexOf("var Store=", i18nStart);
const i18n = vm.runInNewContext(`${appSource.slice(i18nStart, i18nEnd)}\nI18N;`);

test("elder reminders use direct elder-facing language", () => {
  assert.equal(todoSection.found, true);
  const context = {
    St: null,
    D: {
      factPill: "Remind Margaret to finish her blood pressure pills",
      elderFactPill: "Take your blood pressure medicine",
    },
    tp: (value) => String(value),
    todoWhat: (todo) => todo.text ?? context.D[todo.key],
  };
  vm.runInNewContext(todoSection.source, context);

  assert.equal(context.elderTodoText({ key: "factPill" }), "Take your blood pressure medicine");
  assert.equal(
    context.elderTodoText({ text: "Remind Mom to take her medicine" }),
    "Take your medicine",
  );
});

test("unconfirmed answer names the family member instead of guessing a pronoun", () => {
  assert.equal(i18n.en.ansNoConfirm, "{nick} hasn't confirmed that yet. I'll ask {nick}.");
  assert.doesNotMatch(i18n.zh.ansNoConfirm, /她|他/);
});

test("elder question view renders free-form text and a real hold-to-speak button", () => {
  assert.equal(qaViewSection.found, true);
  const output = vm.runInNewContext(`${qaViewSection.source}\nviewQa();`, {
    St: { thread: [{ role: "me", text: "When is Peter coming?" }] },
    App: { qaVoiceActive: false, qaVoiceText: "Peter is coming when?", qaVoiceErr: "" },
    D: {
      asks: ["Fixed question"],
      eListening: "I'm listening",
      eEmpty: "Ask anything",
      eSpeaking: "Speaking",
      eHold: "Hold to speak",
      eHoldListening: "Listening… release when done",
      eHeard: "I heard",
      eBack: "Back",
    },
    IC: { voice: "VOICE" },
    esc: (value) => String(value ?? ""),
    fill: (value, values) => String(value).replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""),
    tp: (value) => String(value).replace("{nick}", "Peter"),
  });

  assert.match(output, /When is Peter coming\?/);
  assert.match(output, /<button[^>]+data-voice-hold="1"/);
  assert.match(output, /data-qa-transcript="1"/);
  assert.match(output, /data-ask="0"/);
});

test("family pending card shows and answers a free-form elder question", () => {
  assert.equal(pendingSection.found, true);
  const context = {
    St: { pending: [{ id: "q1", question: "Where did I put my keys?" }] },
    App: { pendDraft: {} },
    D: {
      asks: [], pendingT: "Needs an answer", pendingD: "Please answer", pendingTimes: "Asked {n} times",
      pendingPh: "Type an answer", pendingSave: "Save", pendingSkip: "Skip", pendingHint: "Hint", pendingOk: "Done",
    },
    esc: (value) => String(value),
    fill: (value, values) => String(value).replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""),
  };
  const output = vm.runInNewContext(`${pendingSection.source}\npendingCard();`, context);

  assert.match(output, /Where did I put my keys\?/);
  assert.match(output, /data-ans="q1"/);
  assert.match(output, /data-ans-save="q1"/);
});

test("a family answer immediately replaces the elder's unconfirmed reply in shared state", () => {
  assert.equal(saveAnswerSection.found, true);
  const state = {
    pending: [{ id: "q1", question: "Where are my keys?" }],
    facts: [], timeline: [],
    thread: [
      { role: "me", text: "Where are my keys?" },
      { role: "ai", key: "ansNoConfirm", src: "srcUnk", text: null },
    ],
  };
  const context = {
    App: { pendDraft: {} },
    Date: { now: () => 789 },
    document: { querySelector: () => ({ value: "They are in the blue bowl." }) },
    pendingQuestion: (item) => item.question,
    selectedMemberId: () => "family-1",
    appendUniqueItems: (target, items) => {
      target.facts.push(...items);
      return items.length;
    },
    factById: (target, id) => target.facts.find((item) => item.id === id) || null,
    clockNow: () => "10:05",
    todayKey: () => "2026-08-24",
    queueUpdate: (mutator) => mutator(state),
  };
  vm.runInNewContext(`${saveAnswerSection.source}\nsaveAnswer("q1");`, context);

  assert.equal(state.pending.length, 0);
  assert.equal(state.facts[0].question, "Where are my keys?");
  assert.equal(state.thread[1].key, "ansPlain");
  assert.equal(state.thread[1].text, "They are in the blue bowl.");
  assert.equal(state.thread[1].src, "srcFact");
});

test("a stale second family answer cannot overwrite the first confirmed answer", () => {
  const state = {
    pending: [],
    facts: [
      {
        id: "first-answer",
        type: "fact",
        question: "Where are my keys?",
        text: "They are in the blue bowl.",
        status: "done",
      },
    ],
    timeline: [],
    thread: [],
  };
  let notice = "";
  const context = {
    App: { pendDraft: { q1: "They are by the door." } },
    Date,
    Math,
    D: { collabAnswerKept: "first answer kept" },
    document: { querySelector: () => ({ value: "They are by the door." }) },
    pendingQuestion: (item) => item.question,
    selectedMemberId: () => "family-2",
    appendUniqueItems: (target, items) => {
      target.facts.push(...items);
      return items.length;
    },
    factById: (target, id) => target.facts.find((item) => item.id === id) || null,
    showNotice: (message) => {
      notice = message;
    },
    queueUpdate: (mutator, _onError, onDone) => {
      mutator(state);
      onDone(state);
    },
  };

  vm.runInNewContext(`${saveAnswerSection.source}\nsaveAnswer("q1");`, context);

  assert.equal(state.facts.length, 1);
  assert.equal(state.facts[0].text, "They are in the blue bowl.");
  assert.equal(notice, "first answer kept");
});

test("a matched free question answers only from confirmed shared family information", async () => {
  assert.equal(freeQuestionSection.found, true);
  const state = {
    lang: "en", thread: [], pending: [], timeline: [],
    facts: [{ id: "f1", type: "fact", status: "done", text: "Peter is coming Saturday afternoon" }],
  };
  const context = {
    St: state,
    D: {},
    Date: { now: () => 123 },
    matchFreeQuestion: async () => state.facts[0],
    phraseAnswer: async () => null,
    factLine: (fact) => fact.text,
    clockNow: () => "10:00",
    todayKey: () => "2026-08-24",
    queueUpdate: (mutator) => mutator(state),
  };
  vm.runInNewContext(freeQuestionSection.source, context);
  await context.askFree("When is Peter coming?");

  assert.equal(state.thread[0].text, "When is Peter coming?");
  assert.equal(state.thread[1].text, "Peter is coming Saturday afternoon");
  assert.equal(state.thread[1].src, "srcFact");
  assert.equal(state.pending.length, 0);
});

test("an unmatched free question syncs to the family instead of inventing an answer", async () => {
  assert.equal(freeQuestionSection.found, true);
  const state = { lang: "en", thread: [], pending: [], timeline: [], facts: [] };
  const context = {
    St: state,
    D: {},
    Date: { now: () => 456 },
    matchFreeQuestion: async () => null,
    phraseAnswer: async () => null,
    factLine: (fact) => fact.text,
    clockNow: () => "10:00",
    todayKey: () => "2026-08-24",
    queueUpdate: (mutator) => mutator(state),
  };
  vm.runInNewContext(freeQuestionSection.source, context);
  await context.askFree("Where are my keys?");

  assert.equal(state.pending[0].question, "Where are my keys?");
  assert.equal(state.thread[1].key, "ansNoConfirm");
  assert.equal(state.thread[1].src, "srcUnk");
});

test("press-and-hold speech submits the recognized words, never sample content", () => {
  assert.equal(voiceSection.found, true);
  let heard = "";
  let recognitionCallback;
  const context = {
    App: { qaVoiceActive: false, qaVoiceText: "", qaVoiceErr: "" },
    D: { eVoiceNoMic: "No microphone", eVoiceFailed: "Try again" },
    speechSupported: () => true,
    startSpeech: (callback) => { recognitionCallback = callback; return true; },
    stopSpeech: () => {},
    patchQaVoice: () => {},
    render: () => {},
    askFree: (text) => { heard = text; },
  };
  vm.runInNewContext(voiceSection.source, context);
  context.beginElderVoice();
  recognitionCallback("Where are my keys?", true);

  assert.equal(heard, "Where are my keys?");
  assert.equal(context.App.qaVoiceText, "Where are my keys?");
});
