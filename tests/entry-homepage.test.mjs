import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import postcss from "postcss";
import vm from "node:vm";

const htmlPath = new URL("../public/app/index.html", import.meta.url);
const appSource = readFileSync(htmlPath, "utf8");
const start = appSource.indexOf("function viewEntry(){");
const end = appSource.indexOf("function viewFamilyStart(){", start);
const viewEntrySource = appSource.slice(start, end);
const familyStart = end;
const familyEnd = appSource.indexOf("function fieldHTML(", familyStart);
const viewFamilyStartSource = appSource.slice(familyStart, familyEnd);
const profileStart = appSource.indexOf("function viewObMe(){");
const profileEnd = appSource.indexOf("function viewCode(){", profileStart);
const viewProfileSource = appSource.slice(profileStart, profileEnd);
const i18nStart = appSource.indexOf("var I18N = {");
const i18nEnd = appSource.indexOf("var Store=", i18nStart);
const i18n = vm.runInNewContext(`${appSource.slice(i18nStart, i18nEnd)}\nI18N;`);
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

test("entry presents the Alzheimer care assistant name as a prominent label", () => {
  const context = { D: i18n.zh, esc: (value) => String(value) };
  const output = vm.runInNewContext(`${viewEntrySource}\nviewEntry();`, context);
  const labelStyles = declarations(".entry-eyebrow");

  assert.match(output, /<p class="entry-eyebrow">阿尔茨海默守护助手<\/p>/);
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

test("family pages keep safe side gutters and scroll from the top", () => {
  const familyStyles = declarations(".view.pad0");

  assert.equal(familyStyles["padding-left"], "22px");
  assert.equal(familyStyles["padding-right"], "22px");
  assert.equal(familyStyles["justify-content"], "flex-start");
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
  assert.ok(parseFloat(roleStyles["min-height"]) >= 120);
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
    initial: () => "",
    waveEl: () => "",
  };
  const output = vm.runInNewContext(`${viewProfileSource}\nviewObMe();`, context);
  const placeholderStyles = declarations(".avatar-picker");

  assert.match(output, /class="avatar-picker"[^>]*>\+<\/div>/);
  assert.doesNotMatch(output, /只用于来电匹配/);
  assert.equal(placeholderStyles["margin-left"], "auto");
  assert.equal(placeholderStyles["margin-right"], "auto");
  assert.equal(placeholderStyles.background, "#E8E3DE");
});

test("entry loads the pinned Supabase browser runtime and adapter before the application", () => {
  const externalScripts = [...appSource.matchAll(/<script\s+src="([^"]+)"[^>]*><\/script>/g)].map(
    (match) => match[1],
  );

  assert.deepEqual(externalScripts, [
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4",
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

test("entry awaits asynchronous family lifecycle actions", () => {
  assert.match(appSource, /document\.addEventListener\("click",\s*async function/);
  assert.match(appSource, /await Store\.create\(lang\)/);
  assert.match(appSource, /await Store\.attach\(code,/);
  assert.match(appSource, /await Store\.resetFamily\(\)/);
  assert.match(appSource, /await Store\.signOut\(\)/);
});
