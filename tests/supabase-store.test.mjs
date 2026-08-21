import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const configPath = new URL("../public/app/supabase-config.js", import.meta.url);
const storePath = new URL("../public/app/supabase-store.js", import.meta.url);

function fakeSupabase({
  userId,
  existingSession,
  getSessionError = null,
  authErrors = [],
}) {
  const user = { id: userId, is_anonymous: true };
  const calls = { getSession: 0, signInAnonymously: 0 };
  const pendingAuthErrors = [...authErrors];

  return {
    calls,
    auth: {
      async getSession() {
        calls.getSession += 1;
        return getSessionError
          ? { data: { session: null }, error: getSessionError }
          : { data: { session: existingSession ? { user } : null }, error: null };
      },
      async signInAnonymously() {
        calls.signInAnonymously += 1;
        const error = pendingAuthErrors.shift();
        return error
          ? { data: { user: null }, error }
          : { data: { user }, error: null };
      },
    },
  };
}

function createStore(client, statuses = []) {
  const source = readFileSync(storePath, "utf8");
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: "supabase-store.js" });

  const calls = { newFamily: 0 };
  const store = context.window.createSupabaseStore({
    client,
    newFamily: () => {
      calls.newFamily += 1;
      throw new Error("Authentication must not create a local family.");
    },
    onStatus: (...status) => statuses.push(status),
    storage: new Map(),
  });

  return { calls, store };
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
  const { store } = createStore(fake);

  const user = await store.initialize();

  assert.equal(user.id, "user-a");
  assert.equal(fake.calls.signInAnonymously, 0);
});

test("initialize creates an anonymous session when absent", async () => {
  const fake = fakeSupabase({ userId: "user-b", existingSession: false });
  const { store } = createStore(fake);

  const user = await store.initialize();

  assert.equal(user.id, "user-b");
  assert.equal(fake.calls.signInAnonymously, 1);
});

test("initialize reports an authentication error and does not create local state", async () => {
  const statuses = [];
  const fake = fakeSupabase({
    userId: "user-c",
    existingSession: false,
    authErrors: [new Error("Anonymous sign-in is unavailable")],
  });
  const { calls, store } = createStore(fake, statuses);

  await assert.rejects(store.initialize(), /Anonymous sign-in is unavailable/);

  assert.deepEqual(statuses, [
    ["connecting"],
    ["error", "Anonymous sign-in is unavailable"],
  ]);
  assert.equal(calls.newFamily, 0);
});

test("initialize reports a session lookup error without attempting anonymous sign-in", async () => {
  const statuses = [];
  const fake = fakeSupabase({
    userId: "user-d",
    existingSession: false,
    getSessionError: new Error("Session lookup is unavailable"),
  });
  const { calls, store } = createStore(fake, statuses);

  await assert.rejects(store.initialize(), /Session lookup is unavailable/);

  assert.equal(fake.calls.signInAnonymously, 0);
  assert.equal(calls.newFamily, 0);
  assert.deepEqual(statuses, [
    ["connecting"],
    ["error", "Session lookup is unavailable"],
  ]);
});

test("concurrent initialization shares one anonymous authentication request", async () => {
  const fake = fakeSupabase({ userId: "user-e", existingSession: false });
  const { store } = createStore(fake);

  const [firstUser, secondUser] = await Promise.all([store.initialize(), store.initialize()]);

  assert.equal(fake.calls.getSession, 1);
  assert.equal(fake.calls.signInAnonymously, 1);
  assert.strictEqual(firstUser, secondUser);
});

test("initialize reuses the authenticated user after a successful initialization", async () => {
  const fake = fakeSupabase({ userId: "user-f", existingSession: false });
  const { store } = createStore(fake);

  const firstUser = await store.initialize();
  const secondUser = await store.initialize();

  assert.equal(fake.calls.getSession, 1);
  assert.equal(fake.calls.signInAnonymously, 1);
  assert.strictEqual(firstUser, secondUser);
});

test("initialize can retry after an anonymous authentication failure", async () => {
  const fake = fakeSupabase({
    userId: "user-g",
    existingSession: false,
    authErrors: [new Error("Temporary sign-in failure")],
  });
  const { store } = createStore(fake);

  await assert.rejects(store.initialize(), /Temporary sign-in failure/);
  const user = await store.initialize();

  assert.equal(user.id, "user-g");
  assert.equal(fake.calls.getSession, 2);
  assert.equal(fake.calls.signInAnonymously, 2);
});
