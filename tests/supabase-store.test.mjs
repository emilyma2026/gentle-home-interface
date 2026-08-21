import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const configPath = new URL("../public/app/supabase-config.js", import.meta.url);
const storePath = new URL("../public/app/supabase-store.js", import.meta.url);

function fakeSupabase({ userId, existingSession, authError = null }) {
  const user = { id: userId, is_anonymous: true };
  const calls = { signInAnonymously: 0 };

  return {
    calls,
    auth: {
      async getSession() {
        return { data: { session: existingSession ? { user } : null } };
      },
      async signInAnonymously() {
        calls.signInAnonymously += 1;
        return authError
          ? { data: { user: null }, error: authError }
          : { data: { user }, error: null };
      },
    },
  };
}

function createStore(client, statuses = []) {
  const source = readFileSync(storePath, "utf8");
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: "supabase-store.js" });

  return context.window.createSupabaseStore({
    client,
    newFamily: () => ({}),
    onStatus: (...status) => statuses.push(status),
    storage: new Map(),
  });
}

test("public configuration exposes only the project URL and publishable key", () => {
  const source = readFileSync(configPath, "utf8");
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: "supabase-config.js" });

  assert.equal(context.window.SUPABASE_CONFIG.url, "https://kmkgbczjukbvktuxejhr.supabase.co");
  assert.match(context.window.SUPABASE_CONFIG.publishableKey, /^sb_publishable_/);
  assert.equal(Object.isFrozen(context.window.SUPABASE_CONFIG), true);
  assert.doesNotMatch(source, /service_role/i);
  assert.doesNotMatch(source, /secret(?:Key|_key)?\s*:/i);
});

test("initialize reuses an existing anonymous session", async () => {
  const fake = fakeSupabase({ userId: "user-a", existingSession: true });
  const store = createStore(fake);

  const user = await store.initialize();

  assert.equal(user.id, "user-a");
  assert.equal(fake.calls.signInAnonymously, 0);
});

test("initialize creates an anonymous session when absent", async () => {
  const fake = fakeSupabase({ userId: "user-b", existingSession: false });
  const store = createStore(fake);

  const user = await store.initialize();

  assert.equal(user.id, "user-b");
  assert.equal(fake.calls.signInAnonymously, 1);
});

test("initialize reports an authentication error and does not create local state", async () => {
  const statuses = [];
  const fake = fakeSupabase({
    userId: "user-c",
    existingSession: false,
    authError: new Error("Anonymous sign-in is unavailable"),
  });
  const store = createStore(fake, statuses);

  await assert.rejects(store.initialize(), /Anonymous sign-in is unavailable/);

  assert.deepEqual(statuses, [
    ["connecting"],
    ["error", "Anonymous sign-in is unavailable"],
  ]);
});
