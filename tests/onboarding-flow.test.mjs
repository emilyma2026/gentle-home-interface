import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const htmlPath = new URL("../public/app/index.html", import.meta.url);
const source = readFileSync(htmlPath, "utf8");

function between(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  return source.slice(start, end);
}

const seedSource = between("var SEED = {", "var I18N = {");
const seeds = vm.runInNewContext(`${seedSource}\nSEED;`);
const newFamilySource = between("function newFamily(", "var Connection=");
const newPersonSource = between("function newPerson(", "function syncSubs(");
const elderViewSource = between("function viewObElder(){", "function speakBlock(){");
const personViewSource = between("function viewObMe(){", "function viewCode(){");
const speakSource = between("function doSpeak(){", "function doSpeakStop(){");
const speakUseSource = between("async function doSpeakUse(){", "function readPhoto(");

test("new onboarding records start blank instead of exposing demo data", () => {
  const family = vm.runInNewContext(`${newFamilySource}\nnewFamily("", "en");`, {
    HOME_LL: { lat: 23.1, lng: 113.3 },
    SEED: seeds,
  });
  const person = vm.runInNewContext(`${newPersonSource}\nnewPerson("en");`, {
    Date,
    Math,
    SEED: seeds,
  });

  assert.equal(family.elder.name, "");
  assert.equal(family.elder.phone, "");
  assert.equal(family.elder.address, "");
  assert.deepEqual(
    [person.nick, person.relation, person.phone, person.recent, person.hint],
    ["", "", "", "", ""],
  );
});

test("both onboarding pages offer an explicit sample action and person setup can go back", () => {
  const common = {
    esc: String,
    fieldHTML: (path) => `<input data-field="${path}">`,
  };
  const elder = vm.runInNewContext(`${elderViewSource}\nviewObElder();`, {
    ...common,
    elderPronounFieldHTML: () => '<select data-field="elder.pronouns"></select>',
    D: {
      back: "Back",
      fillSample: "Fill sample",
      fElderPhone: "Phone",
      fHome: "Home",
      fName: "Name",
      homeHint: "Home hint",
      next: "Next",
      obElderSub: "Sub",
      obElderTitle: "Title",
      mapUseGps: "Use GPS",
    },
    homeMapStatus: () => "STATUS",
    rangeFieldHTML: () => "RANGE",
  });
  const person = vm.runInNewContext(`${personViewSource}\nviewObMe();`, {
    ...common,
    App: { speak: 0 },
    D: {
      addPhoto: "Add photo",
      back: "Back",
      done: "Done",
      fHint: "Memory",
      fNick: "Name",
      fPhone: "Phone",
      fRecent: "Recent life",
      fRel: "Relationship",
      fillSample: "Fill sample",
      hintHint: "Hint",
      obMeSub: "Sub",
      obMeTitle: "Title",
      photoHint2: "Photo hint",
    },
    IC: { mic: "MIC" },
    St: { setup: false },
    editTarget: () => ({ nick: "", relation: "", phone: "", recent: "", hint: "" }),
    speakBlock: () => "SPEAK",
  });

  assert.match(elder, /data-go="fillElderSample"/);
  assert.match(person, /data-go="fillPersonSample"/);
  assert.match(person, /data-go="backPerson"/);
  assert.match(person, /class="avatar-picker"[^>]*>\+<input[^>]*type="file"/);
});

test("sample actions fill only their own onboarding fields", async () => {
  const actionsSource = between("async function fillElderSample(){", "function syncSubs(");
  const state = {
    lang: "en",
    elder: { name: "", phone: "", address: "", home: { lat: 0, lng: 0 }, radius: "500" },
    people: [
      { id: "person-1", nick: "", relation: "", phone: "", recent: "", hint: "", photo: "photo" },
    ],
  };
  const context = {
    App: { editingPerson: "person-1" },
    HOME_LL: { lat: 23.1, lng: 113.3 },
    SEED: seeds,
    St: state,
    persistUpdate: async (mutator) => mutator(state),
    render: () => {},
  };

  await vm.runInNewContext(`${actionsSource}\nfillElderSample();`, context);
  assert.deepEqual(
    [state.elder.name, state.elder.phone, state.elder.address, state.elder.radius],
    ["Mom", "", "Toa Payoh Central, Singapore (sample)", "800"],
  );
  assert.equal(state.people[0].nick, "");

  await vm.runInNewContext(`${actionsSource}\nfillPersonSample();`, context);
  assert.deepEqual(
    [state.people[0].nick, state.people[0].relation, state.people[0].phone],
    ["Yuki", "Daughter", ""],
  );
  assert.equal(state.people[0].recent, "Works in Singapore, lives independently.");
  assert.equal(state.people[0].hint, "You walked me to No.3 Primary School every morning, rain or shine.");
  assert.equal(state.people[0].photo, "photo");
});

test("unsupported speech never fabricates a sample transcript", () => {
  const context = {
    App: { speak: 0, speakErr: "", transcript: "old" },
    D: { speakNoMic: "Recording is unavailable." },
    SEED: seeds,
    St: { lang: "en" },
    render: () => {},
    speechSupported: () => false,
  };

  vm.runInNewContext(`${speakSource}\ndoSpeak();`, context);

  assert.equal(context.App.transcript, "");
  assert.equal(context.App.speakErr, "Recording is unavailable.");
});

test("failed speech extraction leaves every profile field unchanged", async () => {
  const person = { id: "person-1", nick: "", relation: "", phone: "", recent: "", hint: "" };
  const state = { lang: "en", people: [person] };
  let persistenceCalls = 0;
  const context = {
    App: { editingPerson: "person-1", speak: 2, speakErr: "", transcript: "my real words" },
    D: { speakFailed: "Try again." },
    SEED: seeds,
    St: state,
    aiAsk: async () => null,
    aiJSON: () => null,
    document: { getElementById: () => ({ value: "my real words" }) },
    persistUpdate: async () => {
      persistenceCalls += 1;
    },
    render: () => {},
  };

  await vm.runInNewContext(`${speakUseSource}\ndoSpeakUse();`, context);

  assert.equal(persistenceCalls, 0);
  assert.deepEqual(
    [person.nick, person.relation, person.phone, person.recent, person.hint],
    ["", "", "", "", ""],
  );
  assert.equal(context.App.speak, 2);
});

test("partial speech extraction fills only facts that were actually said", async () => {
  const person = { id: "person-1", nick: "", relation: "", phone: "", recent: "", hint: "" };
  const state = { lang: "en", people: [person] };
  const context = {
    App: { editingPerson: "person-1", speak: 2, speakErr: "", transcript: "I work in London" },
    D: { speakFailed: "Try again." },
    SEED: seeds,
    St: state,
    aiAsk: async () => '{"recent":"Works in London"}',
    aiJSON: JSON.parse,
    document: { getElementById: () => ({ value: "I work in London" }) },
    persistUpdate: async (mutator) => mutator(state),
    render: () => {},
  };

  await vm.runInNewContext(`${speakUseSource}\ndoSpeakUse();`, context);

  assert.equal(person.recent, "Works in London");
  assert.deepEqual([person.nick, person.relation, person.phone, person.hint], ["", "", "", ""]);
  assert.equal(context.App.speak, 4);
});

test("person onboarding back navigation returns to the correct previous screen", () => {
  const backSource = between("function backFromPerson(){", "function syncSubs(");
  const onboarding = { App: { editingPerson: "person-1", route: "obMe", tab: 0 }, St: { setup: false } };
  vm.runInNewContext(`${backSource}\nbackFromPerson();`, onboarding);
  assert.equal(onboarding.App.route, "obElder");
  assert.equal(onboarding.App.editingPerson, "person-1");

  const editing = { App: { editingPerson: "person-1", route: "obMe", tab: 0 }, St: { setup: true } };
  vm.runInNewContext(`${backSource}\nbackFromPerson();`, editing);
  assert.equal(editing.App.route, "family");
  assert.equal(editing.App.tab, 3);
  assert.equal(editing.App.editingPerson, null);
});

test("English onboarding copy refers to the elder without assuming gender", () => {
  const i18nSource = between("var I18N = {", "var Store=");
  const i18n = vm.runInNewContext(`${i18nSource}\nI18N;`);
  const copy = [
    i18n.en.obElderSub,
    i18n.en.obMeSub,
    i18n.en.fElderPhone,
    i18n.en.homeHint,
    i18n.en.photoHint2,
    i18n.en.fHint,
    i18n.en.hintHint,
  ].join(" ");

  assert.equal(i18n.en.fHint, "A memory to share");
  assert.doesNotMatch(copy, /\b(?:she|her)\b/i);
});
