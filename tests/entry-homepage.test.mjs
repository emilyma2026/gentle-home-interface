import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import postcss from "postcss";
import vm from "node:vm";

const htmlPath = new URL("../public/app/index.html", import.meta.url);
const appSource = readFileSync(htmlPath, "utf8");
const routeSource = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
const start = appSource.indexOf("function viewEntry(){");
const end = appSource.indexOf("function viewFamilyStart(){", start);
const viewEntrySource = appSource.slice(start, end);
const familyStart = end;
const familyEnd = appSource.indexOf("function fieldHTML(", familyStart);
const viewFamilyStartSource = appSource.slice(familyStart, familyEnd);
const joinStart = appSource.indexOf("function viewJoin(){");
const joinEnd = appSource.indexOf("function viewPaired(){", joinStart);
const viewJoinSource = appSource.slice(joinStart, joinEnd);
const profileStart = appSource.indexOf("function viewObMe(){");
const profileEnd = appSource.indexOf("function viewCode(){", profileStart);
const viewProfileSource = appSource.slice(profileStart, profileEnd);
const callerCardStart = appSource.indexOf("function callerCard(){");
const callerCardEnd = appSource.indexOf("function viewRinging(){", callerCardStart);
const callerCardSource = appSource.slice(callerCardStart, callerCardEnd);
const ringingEnd = appSource.indexOf("function viewTalking(){", callerCardEnd);
const viewRingingSource = appSource.slice(callerCardEnd, ringingEnd);
const persistUpdateStart = appSource.indexOf("function persistUpdate(");
const persistUpdateEnd = appSource.indexOf("async function runPendingAction", persistUpdateStart);
const persistUpdateSource = appSource.slice(persistUpdateStart, persistUpdateEnd);
const queueUpdateStart = appSource.indexOf("function queueUpdate(");
const queueUpdateEnd = appSource.indexOf("async function runPendingAction", queueUpdateStart);
const queueUpdateSource = appSource.slice(queueUpdateStart, queueUpdateEnd);
const availabilityStart = appSource.indexOf("function syncActionAvailability(){");
const availabilityEnd = appSource.indexOf("function setConnectionStatus", availabilityStart);
const availabilitySource = appSource.slice(availabilityStart, availabilityEnd);
const pairStart = appSource.indexOf("async function pair(code){");
const pairEnd = appSource.indexOf("async function hardExit(){", pairStart);
const pairSource = appSource.slice(pairStart, pairEnd);
const resetElderModeStart = appSource.indexOf("function resetElderModeSession(");
const hardExitStart = appSource.indexOf("async function hardExit(){", resetElderModeStart);
const hardExitEnd = appSource.indexOf("/* =====================================================================", hardExitStart);
const resetElderModeSource = appSource.slice(resetElderModeStart, hardExitStart);
const hardExitSource = appSource.slice(hardExitStart, hardExitEnd);
const pollStart = appSource.indexOf("function pollFamilyState(){");
const pollEnd = appSource.indexOf("async function connectAndRestore(){", pollStart);
const pollSource = pollStart >= 0 && pollEnd > pollStart ? appSource.slice(pollStart, pollEnd) : "";
const i18nStart = appSource.indexOf("var I18N = {");
const i18nEnd = appSource.indexOf("var Store=", i18nStart);
const i18n = vm.runInNewContext(`${appSource.slice(i18nStart, i18nEnd)}\nI18N;`);
const iconStart = appSource.indexOf("var IC = {");
const iconEnd = appSource.indexOf(
  "/* =====================================================================",
  iconStart,
);
const icons = vm.runInNewContext(`${appSource.slice(iconStart, iconEnd)}\nIC;`);
const styleText = appSource.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
const stylesheet = postcss.parse(styleText);

function declarations(selector) {
  const values = {};
  stylesheet.walkRules(selector, (rule) => {
    if (rule.selector !== selector) return;
    rule.walkDecls((declaration) => {
      values[declaration.prop] = declaration.value;
    });
  });
  return values;
}

function renderEntry() {
  const context = {
    D: {
      appName: "APP_NAME_MARKER",
      appSub: "APP_SUB_MARKER",
      labelEntry: "ENTRY_LABEL_MARKER",
      entryTitle: "ENTRY_TITLE_MARKER",
      entrySub: "ENTRY_SUB_MARKER",
      roleFamilyT: "FAMILY_TITLE_MARKER",
      roleFamilyD: "FAMILY_DESCRIPTION_MARKER",
      roleElderT: "ELDER_TITLE_MARKER",
      roleElderD: "ELDER_DESCRIPTION_MARKER",
      stepsTitle: "STEPS_TITLE_MARKER",
      steps: ["STEP_ONE_MARKER", "STEP_TWO_MARKER", "STEP_THREE_MARKER"],
      hintEntry: "ENTRY_HINT_MARKER",
    },
    esc: (value) => String(value),
  };

  return vm.runInNewContext(`${viewEntrySource}\nviewEntry();`, context);
}

test("entry offers the family and elder sides as illustrated buttons over the cover art", () => {
  const output = renderEntry();

  assert.match(output, /<button class="pick family" data-go="familyStart">/);
  assert.match(output, /<button class="pick elder" data-go="elderPair">/);
  assert.match(output, /<img src="otter-family\.jpg"/);
  assert.match(output, /<img src="otter-nana\.jpg"/);
  assert.doesNotMatch(output, /hero-care-centered\.png/);
  assert.equal(existsSync(new URL("../public/app/otter-family.jpg", import.meta.url)), true);
  assert.equal(existsSync(new URL("../public/app/otter-nana.jpg", import.meta.url)), true);

  const pickStyles = declarations(".picks");
  assert.equal(pickStyles["grid-template-columns"], "1fr 1fr");
});

test("entry omits the setup walkthrough and demo note", () => {
  const output = renderEntry();

  assert.doesNotMatch(output, /STEPS_TITLE_MARKER/);
  assert.doesNotMatch(output, /STEP_ONE_MARKER/);
  assert.doesNotMatch(output, /ENTRY_HINT_MARKER/);
});

test("the first visit presents the English Remember Us brand", () => {
  const context = { D: i18n.en, esc: (value) => String(value) };
  const output = vm.runInNewContext(`${viewEntrySource}\nviewEntry();`, context);
  const labelStyles = declarations(".entry-eyebrow");

  assert.match(appSource, /<html lang="en">/);
  assert.match(appSource, /<title>Remember Us · Family Memory Companion<\/title>/);
  assert.match(appSource, /var St=null, D=null, lang="en", langTouched=false;/);
  assert.match(output, /<p class="entry-eyebrow">Remember Us<\/p>/);
  assert.equal(i18n.zh.appName, "Remember Us");
  assert.equal(i18n.en.appName, "Remember Us");
  assert.match(routeSource, /title="Remember Us prototype"/);
  assert.doesNotMatch(routeSource, /守护助手/);
  // eyebrow now reads as an uppercase kicker above the title, not the largest text
  assert.equal(labelStyles["text-transform"], "uppercase");
  assert.ok(parseFloat(labelStyles["letter-spacing"]) > 0);
  assert.ok(
    parseFloat(labelStyles["font-size"]) < parseFloat(declarations(".entry-title")["font-size"]),
  );
});

test("entry role buttons carry a short label and a one-line description", () => {
  const context = { D: i18n.zh, esc: (value) => String(value) };
  const output = vm.runInNewContext(`${viewEntrySource}\nviewEntry();`, context);
  const cardStyles = declarations(".pick");
  const descStyles = declarations(".pick span");

  assert.match(output, /<b>家人端<\/b><span>管理信息与提醒<\/span>/);
  assert.match(output, /<b>老人端<\/b><span>配对后安心使用<\/span>/);
  assert.equal(cardStyles["text-align"], "center");
  assert.equal(descStyles.display, "block");
});

test("entry uses the otter cover art as the full-bleed screen background", () => {
  const screenStyles = declarations(".screen:has(.entry)");
  const entryStyles = declarations(".entry");

  assert.match(screenStyles.background, /otter-bg\.jpg/);
  assert.equal(existsSync(new URL("../public/app/otter-bg.jpg", import.meta.url)), true);
  // content sits below the illustration's scene, not floating at the top edge
  assert.ok(parseFloat(entryStyles["padding-top"]) > 200);
});

test("family pages keep safe gutters and align their overview at the top", () => {
  const familyStyles = declarations(".view.pad0");

  assert.equal(familyStyles["padding-left"], "22px");
  assert.equal(familyStyles["padding-right"], "22px");
  assert.equal(familyStyles["justify-content"], "flex-start");
  assert.equal(familyStyles["padding-top"], "8px");
  assert.match(familyStyles["padding-bottom"], /clamp\(/);
});

test("family choice page shows create and join side by side without a duplicate title", () => {
  const context = { D: i18n.zh, esc: (value) => String(value) };
  const output = vm.runInNewContext(`${viewFamilyStartSource}\nviewFamilyStart();`, context);
  const pageStyles = declarations(".family-start");
  const rolesStyles = declarations(".family-start .roles");

  assert.match(output, /class="family-start"/);
  // the small eyebrow above the h1 is gone — only the h1 title remains
  assert.doesNotMatch(output, /class="eyebrow"/);
  assert.equal((output.match(/class="h1"/g) || []).length, 1);
  assert.match(output, /data-go="create"/);
  assert.match(output, /data-go="joinFamily"/);
  assert.match(output, /<img src="otter-join\.jpg"/);
  assert.equal(pageStyles["min-height"], "100%");
  assert.equal(rolesStyles["grid-template-columns"], "1fr 1fr");
});

test("join page prefills a working fictional demo family code", () => {
  const context = {
    App: { joinAs: "family", err: "" },
    D: i18n.en,
    DEMO_CODE: "527487",
    esc: (value) => String(value),
  };
  const output = vm.runInNewContext(`${viewJoinSource}\nviewJoin();`, context);

  assert.match(output, /id="codeIn"[^>]*value="527487"/);
  assert.match(output, /Demo family code/);
  assert.match(output, />527487</);
});

test("profile form centers a neutral add-photo placeholder without the old explanation", () => {
  const context = {
    App: { speak: 0 },
    St: { setup: false },
    D: i18n.zh,
    IC: { mic: "MIC" },
    editTarget: () => null,
    esc: (value) => String(value),
    fieldHTML: () => '<div class="field"></div>',
    speakBlock: () => "",
  };
  const output = vm.runInNewContext(`${viewProfileSource}\nviewObMe();`, context);
  const placeholderStyles = declarations(".avatar-picker");

  assert.match(output, /class="avatar-picker"[^>]*>\+<input[^>]*type="file"/);
  assert.doesNotMatch(output, /只用于来电匹配/);
  assert.equal(output.includes(i18n.zh.photoHint2), false);
  assert.equal(placeholderStyles["margin-left"], "auto");
  assert.equal(placeholderStyles["margin-right"], "auto");
  assert.equal(placeholderStyles.background, "#E8E3DE");
});

test("incoming call card prioritizes the face and one familiar recognition cue", () => {
  const person = {
    id: "family-1",
    nick: "Emily",
    relation: "Daughter",
    phone: "+65 8371 0994",
    recent: "Moved to Singapore for a new role.",
    hint: "We baked peach pies together every summer.",
    photo: "data:image/jpeg;base64,photo",
  };
  const context = {
    St: { people: [person], lastCaller: person.id },
    D: i18n.en,
    focusPerson: () => person,
    avatarHTML: () => '<span class="avatar av-lg photo"></span>',
    esc: (value) => String(value),
  };

  const output = vm.runInNewContext(`${callerCardSource}\ncallerCard();`, context);

  assert.match(output, /class="caller-name"[^>]*>Emily</);
  assert.match(output, /class="caller-relation"[^>]*>Daughter</);
  assert.match(
    output,
    />A memory to share<\/dt><dd[^>]*>We baked peach pies together every summer\.<\/dd>/,
  );
  assert.doesNotMatch(output, />Phone<\/dt>/);
  assert.doesNotMatch(output, />Recent life<\/dt>/);
  assert.doesNotMatch(output, /, your/);
  assert.equal(declarations(".pcard .avatar").width, "128px");
});

test("decline control uses a standard horizontal hang-up handset", () => {
  const person = {
    id: "family-1",
    nick: "Emily",
    relation: "Daughter",
    phone: "+65 8371 0994",
    recent: "Recent life",
    hint: "Shared memory",
    photo: "photo",
  };
  const context = {
    St: { people: [person], lastCaller: person.id },
    D: i18n.en,
    IC: icons,
    focusPerson: () => person,
    callerCard: () => "CALLER_CARD",
    esc: (value) => String(value),
  };

  const output = vm.runInNewContext(`${viewRingingSource}\nviewRinging();`, context);
  const declineIconStyles = declarations(".ctrl .no .hangup-symbol");

  assert.match(output, /data-go="decline"[^>]*><i><svg class="hangup-symbol"/);
  assert.equal(declineIconStyles.fill, "currentColor");
  assert.equal(declineIconStyles.stroke, "none");
  assert.doesNotMatch(output, /class="nm"/);
});

test("entry loads the pinned Supabase browser runtime and adapter before the application", () => {
  const externalScripts = [...appSource.matchAll(/<script\s+src="([^"]+)"[^>]*><\/script>/g)].map(
    (match) => match[1],
  );

  assert.deepEqual(externalScripts, [
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4",
    "/app/maps-config.js",
    "/app/supabase-config.js",
    "/app/supabase-store.js",
    "/app/voice.js",
    "/app/navigation.js",
  ]);
  assert.ok(appSource.indexOf(externalScripts[2]) < appSource.indexOf("(function(){"));
});

test("entry uses the Supabase store without a local family-state fallback", () => {
  assert.match(appSource, /window\.createSupabaseStore\s*\(/);
  assert.doesNotMatch(appSource, /数据层：localStorage \+ BroadcastChannel/);
  assert.doesNotMatch(appSource, /new BroadcastChannel\s*\(/);
  assert.doesNotMatch(appSource, /alz:family:/);
});

test("entry exposes accessible connection states and an initialization retry", () => {
  assert.match(appSource, /id="connectionStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  for (const state of ["connecting", "loading", "saving", "offline", "error", "synced"]) {
    assert.match(appSource, new RegExp(`(?:"|')${state}(?:"|')`));
  }
  assert.match(appSource, /data-go="retryConnection"/);
});

test("entry keeps initialization retry available when the first connection is offline", () => {
  assert.match(
    appSource,
    /Connection\.initFailed\s*&&\s*\(Connection\.state==="error"\s*\|\|\s*Connection\.state==="offline"\)/,
  );
});

test("failed initialization unlocks family lifecycle buttons for a direct retry", () => {
  const create = {
    disabled: true,
    matches: (selector) => selector.includes('[data-go="create"]'),
  };
  const pair = {
    disabled: true,
    matches: (selector) => selector.includes('[data-go="pair"]'),
  };
  const profileField = { disabled: false, matches: () => false };
  const context = {
    Connection: {
      authenticated: false,
      initFailed: true,
      pendingAction: false,
      state: "error",
    },
    document: {
      querySelectorAll: () => [create, pair, profileField],
    },
    protectedActionSelector: () => "protected controls",
  };

  vm.runInNewContext(`${availabilitySource}\nsyncActionAvailability();`, context);

  assert.equal(create.disabled, false);
  assert.equal(pair.disabled, false);
  assert.equal(profileField.disabled, true);
});

test("entry awaits asynchronous family lifecycle actions", () => {
  assert.match(appSource, /document\.addEventListener\("click",\s*async function/);
  assert.match(appSource, /await Store\.create\(langTouched \? lang : "en"\)/);
  assert.match(appSource, /await Store\.attach\(code,/);
  assert.match(appSource, /await Store\.resetFamily\(\)/);
  assert.match(appSource, /await Store\.signOut\(\)/);
});

test("switching away from the elder mode ends transient screens but keeps family data", () => {
  const state = {
    guide: {
      active: true,
      done: true,
      step: 2,
      instructions: [{ text: "turn left" }],
      routeId: "route-1",
    },
    call: { phase: "talking", line: 3, startedAt: 123 },
    facts: [{ id: "memory-1", text: "Saturday visit" }],
    todos: [{ id: "todo-1", what: "Medicine" }],
  };

  vm.runInNewContext(`${resetElderModeSource}\nresetElderModeSession(state);`, { state });

  assert.equal(state.guide.active, false);
  assert.equal(state.guide.done, false);
  assert.equal(state.guide.step, 0);
  assert.equal(state.guide.instructions.length, 0);
  assert.equal(state.guide.routeId, "");
  assert.equal(state.call.phase, "idle");
  assert.equal(state.call.line, -1);
  assert.equal("startedAt" in state.call, false);
  assert.equal(state.facts[0].text, "Saturday visit");
  assert.equal(state.todos[0].what, "Medicine");
});

test("Switch role persists the elder session reset and refreshes the page", async () => {
  const state = {
    guide: { active: true, done: false, step: 1, instructions: ["step"], routeId: "route" },
    call: { phase: "ringing", line: -1 },
  };
  let signedOut = 0;
  let reloads = 0;
  const context = {
    App: {
      route: "elder", tab: 2, qa: true, pick: true, eset: true,
      qaVoiceActive: true, qaVoiceText: "question", qaVoiceErr: "error",
      callNeedsPlay: true, editingPerson: "person-1", paired: true, demoLocation: true,
    },
    St: state,
    Store: { signOut: async () => { signedOut += 1; } },
    EMBEDDED: false,
    window: { location: { reload: () => { reloads += 1; } } },
    storeRole: () => "elder",
    stopSpeech: () => {},
    stopSubs: () => {},
    stopGps: () => {},
    clearDevice: () => {},
    persistUpdate: async (mutator) => mutator(state),
    resetElderModeSession: vm.runInNewContext(`${resetElderModeSource}\nresetElderModeSession;`),
    reportStoreError: (error) => { throw error; },
    I18N: { en: {} },
    lang: "en",
    D: {},
    render: () => assert.fail("a browser refresh should replace the fallback render"),
  };

  await vm.runInNewContext(`${hardExitSource}\nhardExit();`, context);

  assert.equal(state.guide.active, false);
  assert.equal(state.call.phase, "idle");
  assert.equal(signedOut, 1);
  assert.equal(reloads, 1);
  assert.equal(context.App.route, "entry");
  assert.equal(context.App.callNeedsPlay, false);
});

test("the app polls shared family state when Realtime cannot connect", async () => {
  assert.ok(pollSource, "pollFamilyState must exist");
  let refreshes = 0;
  const context = {
    Store: { refresh: async () => { refreshes += 1; } },
    St: { code: "123456" },
    Connection: { authenticated: true, pendingAction: false, state: "offline" },
    reportStoreError: (error) => { throw error; },
  };

  vm.runInNewContext(`${pollSource}\npollFamilyState();`, context);
  await Promise.resolve();

  assert.equal(refreshes, 1);
  assert.match(appSource, /setInterval\(pollFamilyState,\s*2000\)/);
});

test("elder pairing persists the paired state before entering the elder screen", async () => {
  const state = { paired: false, lang: "zh" };
  const events = [];
  const context = {
    App: { joinAs: "elder", err: "old error", paired: false, route: "join" },
    D: { joinErr: "not found" },
    Store: {
      async attach(code, role) {
        events.push(`attach:${code}:${role}`);
      },
      get() {
        return state;
      },
    },
    St: null,
    newPerson: () => assert.fail("elder pairing must not create a family member"),
    persistUpdate: async (mutator) => {
      events.push("update");
      mutator(state);
    },
    rememberDevice: (role, code, memberId) => {
      events.push(`remember:${role}:${code}:${memberId}`);
    },
    render: () => {},
    reportStoreError: (error) => {
      throw error;
    },
    runPendingAction: async (action) => action(),
    storeRole: () => "elder",
  };

  await vm.runInNewContext(`${pairSource}\npair(" 123456 ");`, context);

  assert.equal(state.paired, true);
  assert.equal(context.App.paired, true);
  assert.equal(context.App.route, "elder");
  assert.deepEqual(events, ["attach:123456:elder", "update", "remember:elder:123456:null"]);
});

test("persistUpdate reports a failed write and keeps the returned promise rejected", async () => {
  const failure = Object.assign(new Error("write failed"), { code: "BACKEND_ERROR" });
  let reported = null;
  const context = {
    Store: { update: () => Promise.reject(failure) },
    reportStoreError: (error) => {
      reported = error;
      return null;
    },
  };

  const update = vm.runInNewContext(`${persistUpdateSource}\npersistUpdate(() => {});`, context);

  await assert.rejects(update, (error) => error === failure);
  assert.equal(reported, failure);
});

test("fire-and-forget updates explicitly consume already-reported rejections", () => {
  assert.ok(queueUpdateStart >= 0, "expected a fire-and-forget update wrapper");
  let rejectionHandler = null;
  const context = {
    persistUpdate: () => ({
      then() {
        return {
          catch(handler) {
            rejectionHandler = handler;
          },
        };
      },
    }),
  };

  const result = vm.runInNewContext(`${queueUpdateSource}\nqueueUpdate(() => {});`, context);
  const behaviorSource = appSource.slice(
    appSource.indexOf("function bindInputs(){"),
    appSource.indexOf(
      "/* =====================================================================\n   11. 启动",
    ),
  );
  const unsafeCalls = behaviorSource
    .split(/\r?\n/)
    .filter((line) => line.includes("persistUpdate(") && !line.includes("await persistUpdate("));

  assert.equal(result, undefined);
  assert.equal(typeof rejectionHandler, "function");
  assert.doesNotThrow(() => rejectionHandler(new Error("already reported")));
  assert.deepEqual(unsafeCalls, []);
});
