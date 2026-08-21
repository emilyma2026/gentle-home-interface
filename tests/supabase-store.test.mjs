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
  rpcResults = {},
  rpcErrors = {},
  tableResults = {},
}) {
  const user = { id: userId, is_anonymous: true };
  const calls = { getSession: 0, signInAnonymously: 0, rpc: [], from: [] };
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
    async rpc(name, parameters) {
      calls.rpc.push({ name, parameters });
      return {
        data: rpcResults[name] ?? null,
        error: rpcErrors[name] ?? null,
      };
    },
    from(table) {
      const query = { table, select: null, filters: [] };
      calls.from.push(query);

      const builder = {
        select(columns) {
          query.select = columns;
          return builder;
        },
        eq(column, value) {
          query.filters.push([column, value]);
          return builder;
        },
        async maybeSingle() {
          return tableResults[table] ?? { data: null, error: null };
        },
        async single() {
          return tableResults[table] ?? { data: null, error: null };
        },
      };

      return builder;
    },
  };
}

function createStore(client, statuses = [], options = {}) {
  const source = readFileSync(storePath, "utf8");
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: "supabase-store.js" });

  const calls = { newFamily: 0 };
  const storage = options.storage ?? new Map();
  const store = context.window.createSupabaseStore({
    client,
    newFamily: (code, lang) => {
      calls.newFamily += 1;
      if (options.newFamily) return options.newFamily(code, lang);
      throw new Error("Authentication must not create a local family.");
    },
    onStatus: (...status) => statuses.push(status),
    storage,
  });

  return { calls, storage, store };
}

function familyState(code, lang = "zh", overrides = {}) {
  return {
    code,
    lang,
    rev: 0,
    setup: false,
    paired: false,
    elder: { name: "陈爷爷", address: "梧桐路 8 号", radius: "800" },
    people: [],
    facts: [],
    pending: [],
    timeline: [{ t: "09:10", kind: "morning" }],
    call: { phase: "idle", personId: null, line: -1 },
    lastCaller: null,
    thread: [],
    askCounts: {},
    loc: { x: 130, y: 90 },
    guide: { active: false, step: 0, done: false },
    ...overrides,
  };
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

test("create caches the returned family selection and exposes server state", async () => {
  const payload = familyState("123456");
  const fake = fakeSupabase({
    userId: "creator-a",
    existingSession: true,
    rpcResults: {
      create_family: [{ family_id: "family-a", family_code: "123456", revision: 0, payload }],
    },
  });
  const { calls, storage, store } = createStore(fake, [], {
    newFamily: (code, lang) => familyState(code, lang),
  });
  assert.equal(await store.create("zh"), "123456");
  assert.equal(store.get().code, "123456");
  assert.equal(calls.newFamily, 1);
  assert.equal(fake.calls.rpc[0].name, "create_family");
  assert.equal(fake.calls.rpc[0].parameters.requested_role, "family");
  assert.equal(fake.calls.rpc[0].parameters.initial_payload.code, "");
  assert.equal(fake.calls.rpc[0].parameters.initial_payload.lang, "zh");
  assert.deepEqual([...storage.entries()], [
    ["alz:family-id", "family-a"],
    ["alz:code", "123456"],
    ["alz:role", "family"],
  ]);
});

test("create notifies subscribers with the returned server state", async () => {
  const payload = familyState("123456");
  const fake = fakeSupabase({
    userId: "creator-b",
    existingSession: true,
    rpcResults: {
      create_family: [{ family_id: "family-b", family_code: "123456", revision: 0, payload }],
    },
  });
  const { store } = createStore(fake, [], {
    newFamily: (code, lang) => familyState(code, lang),
  });
  const notifications = [];
  store.subscribe((nextState) => notifications.push(nextState));

  await store.create("zh");

  assert.deepEqual(notifications, [payload]);
});

test("join caches the selected elder role and exposes the latest server state", async () => {
  const payload = familyState("123456", "zh", { paired: true, rev: 1 });
  const fake = fakeSupabase({
    userId: "elder-a",
    existingSession: true,
    rpcResults: {
      join_family: { family_id: "family-a", family_code: "123456", revision: 1, payload },
    },
  });
  const { storage, store } = createStore(fake);

  await store.attach("123456", "elder");

  assert.equal(store.role(), "elder");
  assert.strictEqual(store.get(), payload);
  assert.equal(fake.calls.rpc[0].name, "join_family");
  assert.equal(fake.calls.rpc[0].parameters.family_code, "123456");
  assert.equal(fake.calls.rpc[0].parameters.requested_role, "elder");
  assert.deepEqual([...storage.entries()], [
    ["alz:family-id", "family-a"],
    ["alz:code", "123456"],
    ["alz:role", "elder"],
  ]);
});

test("join maps an empty RPC result to FAMILY_NOT_FOUND without exposing state", async () => {
  const fake = fakeSupabase({
    userId: "elder-b",
    existingSession: true,
    rpcResults: { join_family: [] },
  });
  const { storage, store } = createStore(fake);

  await assert.rejects(store.attach("000000", "elder"), {
    code: "FAMILY_NOT_FOUND",
  });

  assert.equal(store.get(), null);
  assert.equal(storage.size, 0);
});

test("join maps Supabase failures to a user-safe backend error", async () => {
  const fake = fakeSupabase({
    userId: "elder-c",
    existingSession: true,
    rpcErrors: { join_family: new Error("relation details must stay private") },
  });
  const { store } = createStore(fake);

  await assert.rejects(store.attach("123456", "elder"), {
    code: "BACKEND_ERROR",
    message: "Unable to connect to your family right now.",
  });
});

test("restore validates cached membership before exposing the latest state", async () => {
  const payload = familyState("123456", "zh", { rev: 4 });
  const storage = new Map([
    ["alz:family-id", "family-a"],
    ["alz:code", "123456"],
    ["alz:role", "elder"],
  ]);
  const fake = fakeSupabase({
    userId: "elder-d",
    existingSession: true,
    tableResults: {
      family_members: {
        data: { family_id: "family-a", role: "elder", families: { code: "123456" } },
        error: null,
      },
      family_states: {
        data: { family_id: "family-a", revision: 4, payload },
        error: null,
      },
    },
  });
  const { store } = createStore(fake, [], { storage });

  assert.strictEqual(await store.restoreSelection(), payload);
  assert.strictEqual(store.get(), payload);
  assert.equal(store.role(), "elder");
  assert.deepEqual(fake.calls.from.map(({ table }) => table), ["family_members", "family_states"]);
});

test("restore clears an invalid cached selection without exposing family state", async () => {
  const storage = new Map([
    ["alz:family-id", "family-a"],
    ["alz:code", "123456"],
    ["alz:role", "elder"],
  ]);
  const fake = fakeSupabase({
    userId: "elder-e",
    existingSession: true,
    tableResults: {
      family_members: { data: null, error: null },
      family_states: {
        data: { family_id: "family-a", revision: 4, payload: familyState("123456") },
        error: null,
      },
    },
  });
  const { store } = createStore(fake, [], { storage });

  assert.equal(await store.restoreSelection(), null);
  assert.equal(store.get(), null);
  assert.equal(store.role(), null);
  assert.equal(storage.size, 0);
  assert.deepEqual(fake.calls.from.map(({ table }) => table), ["family_members"]);
});
