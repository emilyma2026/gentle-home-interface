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

test("entry renders the centered family artwork without image badges", () => {
  const output = renderEntry();

  assert.match(output, /<img src="hero-care-centered\.png"/);
  assert.doesNotMatch(output, /class="badge /);
  assert.equal(existsSync(new URL("../public/app/hero-care-centered.png", import.meta.url)), true);
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
  assert.ok(parseFloat(labelStyles["font-size"]) >= 18);
  assert.ok(
    parseFloat(labelStyles["font-size"]) > parseFloat(declarations(".entry-title")["font-size"]),
  );
});

test("entry role buttons use short one-line labels and descriptions", () => {
  const context = { D: i18n.zh, esc: (value) => String(value) };
  const output = vm.runInNewContext(`${viewEntrySource}\nviewEntry();`, context);
  const copyStyles = declarations(".pick-copy span");

  assert.match(output, />家人端</);
  assert.match(output, />管理信息与提醒</);
  assert.match(output, />老人端</);
  assert.match(output, />配对后安心使用</);
  assert.equal(copyStyles["white-space"], "nowrap");
  assert.equal(copyStyles["text-overflow"], "ellipsis");
});

test("entry safely centers its content and biases it below the top edge", () => {
  const entryStyles = declarations(".entry");

  assert.equal(entryStyles["justify-content"], "safe center");
  assert.ok(parseFloat(entryStyles["padding-top"]) > parseFloat(entryStyles["padding-bottom"]));
});

test("family pages keep safe gutters and vertically balance short content", () => {
  const familyStyles = declarations(".view.pad0");

  assert.equal(familyStyles["padding-left"], "22px");
  assert.equal(familyStyles["padding-right"], "22px");
  assert.equal(familyStyles["justify-content"], "safe center");
  assert.match(familyStyles["padding-top"], /clamp\(/);
  assert.match(familyStyles["padding-bottom"], /clamp\(/);
});

test("family choice page gives more height to its choices than to blank space", () => {
  const context = { D: i18n.zh, esc: (value) => String(value) };
  const output = vm.runInNewContext(`${viewFamilyStartSource}\nviewFamilyStart();`, context);
  const pageStyles = declarations(".family-start");
  const headStyles = declarations(".family-start-head");
  const rolesStyles = declarations(".family-start .roles");
  const roleStyles = declarations(".family-start .role");

  assert.match(output, /class="family-start"/);
  assert.equal(pageStyles["min-height"], "100%");
  assert.ok(parseFloat(headStyles["margin-bottom"]) >= 28);
  assert.equal(rolesStyles.flex, "1 1 auto");
  assert.ok(parseFloat(rolesStyles["max-height"]) >= 380);
  assert.ok(parseFloat(roleStyles["min-height"]) >= 132);
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
  assert.equal(placeholderStyles["margin-left"], "auto");
  assert.equal(placeholderStyles["margin-right"], "auto");
  assert.equal(placeholderStyles.background, "#E8E3DE");
});

test("incoming call card shows every family onboarding detail without a broken relationship sentence", () => {
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
  assert.match(output, />Phone<\/dt><dd[^>]*>\+65 8371 0994<\/dd>/);
  assert.match(output, />Recent life<\/dt><dd[^>]*>Moved to Singapore for a new role\.<\/dd>/);
  assert.match(
    output,
    />A memory to share<\/dt><dd[^>]*>We baked peach pies together every summer\.<\/dd>/,
  );
  assert.doesNotMatch(output, /, your/);
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
      catch(handler) {
        rejectionHandler = handler;
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
