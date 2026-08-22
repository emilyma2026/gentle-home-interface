import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const configPath = new URL("../public/app/supabase-config.js", import.meta.url);
const storePath = new URL("../public/app/supabase-store.js", import.meta.url);
const FAMILY_A_ID = "11111111-1111-4111-8111-111111111111";
const FAMILY_B_ID = "22222222-2222-4222-8222-222222222222";

function fakeSupabase({
  userId,
  existingSession,
  getSessionError = null,
  authErrors = [],
  rpcHandlers = {},
  rpcResults = {},
  rpcErrors = {},
  tableResults = {},
}) {
  const user = { id: userId, is_anonymous: true };
  const calls = {
    getSession: 0,
    signInAnonymously: 0,
    rpc: [],
    from: [],
    channel: [],
    removeChannel: [],
  };
  const channels = [];
  const pendingAuthErrors = [...authErrors];

  return {
    calls,
    channels,
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
        return error ? { data: { user: null }, error } : { data: { user }, error: null };
      },
    },
    async rpc(name, parameters) {
      calls.rpc.push({ name, parameters });
      if (rpcHandlers[name]) return rpcHandlers[name](parameters);
      const configuredResult = rpcResults[name];
      return {
        data:
          typeof configuredResult === "function"
            ? await configuredResult(parameters)
            : (configuredResult ?? null),
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
          const configuredResult = tableResults[table];
          return typeof configuredResult === "function"
            ? configuredResult(query)
            : (configuredResult ?? { data: null, error: null });
        },
        async single() {
          const configuredResult = tableResults[table];
          return typeof configuredResult === "function"
            ? configuredResult(query)
            : (configuredResult ?? { data: null, error: null });
        },
      };

      return builder;
    },
    channel(name) {
      const realtimeChannel = {
        name,
        binding: null,
        handler: null,
        statusHandler: null,
        unsubscribeCalls: 0,
        on(type, filter, handler) {
          realtimeChannel.binding = { type, filter };
          realtimeChannel.handler = handler;
          return realtimeChannel;
        },
        subscribe(handler) {
          realtimeChannel.statusHandler = handler;
          return realtimeChannel;
        },
        unsubscribe() {
          realtimeChannel.unsubscribeCalls += 1;
        },
        emitChange(row) {
          return realtimeChannel.handler({ new: row });
        },
        emitStatus(status, error) {
          return realtimeChannel.statusHandler(status, error);
        },
      };
      channels.push(realtimeChannel);
      calls.channel.push({ name });
      return realtimeChannel;
    },
    async removeChannel(realtimeChannel) {
      calls.removeChannel.push(realtimeChannel);
    },
  };
}

function createStore(client, statuses = [], options = {}) {
  const source = readFileSync(storePath, "utf8");
  const context = { structuredClone, window: {}, ...options.context };
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
    onStatus: options.onStatus ?? ((...status) => statuses.push(status)),
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

function recursivelyReverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(recursivelyReverseObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, nestedValue]) => [key, recursivelyReverseObjectKeys(nestedValue)]),
  );
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function manualTimeouts() {
  const active = new Map();
  let nextId = 0;
  return {
    active,
    context: {
      setTimeout(callback, milliseconds) {
        const id = ++nextId;
        active.set(id, { callback, milliseconds });
        return id;
      },
      clearTimeout(id) {
        active.delete(id);
      },
    },
    fireOnly() {
      assert.equal(active.size, 1, "the stalled backend request must have one active timeout");
      const [{ callback, milliseconds }] = active.values();
      assert.equal(milliseconds, 12000);
      callback();
    },
  };
}

async function attachedStore({
  payload = familyState("123456"),
  revision = 0,
  statuses = [],
  rpcHandlers = {},
  rpcErrors = {},
  tableResults = {},
  newFamily,
  context,
} = {}) {
  const fake = fakeSupabase({
    userId: "attached-user",
    existingSession: true,
    rpcHandlers,
    rpcErrors,
    rpcResults: {
      join_family: {
        family_id: FAMILY_A_ID,
        family_code: "123456",
        revision,
        payload,
      },
    },
    tableResults: {
      family_members: {
        data: { family_id: FAMILY_A_ID, role: "family", families: { code: "123456" } },
        error: null,
      },
      ...tableResults,
    },
  });
  const created = createStore(fake, statuses, { context, newFamily });
  await created.store.attach("123456", "family");
  return { ...created, fake, statuses };
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

  assert.deepEqual(statuses, [["connecting"], ["error", "Anonymous sign-in is unavailable"]]);
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
  assert.deepEqual(statuses, [["connecting"], ["error", "Session lookup is unavailable"]]);
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

test("a stalled session lookup times out and initialization remains retryable", async () => {
  const fake = fakeSupabase({ userId: "user-timeout", existingSession: true });
  const regularGetSession = fake.auth.getSession;
  const stalledSession = deferred();
  const activeTimers = new Map();
  let firstAttempt = true;
  let nextTimerId = 0;
  fake.auth.getSession = () => {
    if (firstAttempt) return stalledSession.promise;
    return regularGetSession();
  };
  const { store } = createStore(fake, [], {
    context: {
      setTimeout(callback, milliseconds) {
        const id = ++nextTimerId;
        activeTimers.set(id, { callback, milliseconds });
        return id;
      },
      clearTimeout(id) {
        activeTimers.delete(id);
      },
    },
  });

  const initialization = store.initialize();
  await Promise.resolve();

  assert.equal(activeTimers.size, 1, "authentication must not wait forever");
  const [{ callback, milliseconds }] = activeTimers.values();
  assert.equal(milliseconds, 12000);
  callback();
  await assert.rejects(initialization, {
    code: "REQUEST_TIMEOUT",
    message: "Unable to connect to your family right now.",
  });

  firstAttempt = false;
  const user = await store.initialize();
  assert.equal(user.id, "user-timeout");
});

test("create caches the returned family selection and exposes server state", async () => {
  const payload = familyState("123456");
  const fake = fakeSupabase({
    userId: "creator-a",
    existingSession: true,
    rpcResults: {
      create_family: [{ family_id: FAMILY_A_ID, family_code: "123456", revision: 0, payload }],
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
  assert.deepEqual(
    [...storage.entries()],
    [
      ["alz:family-id", FAMILY_A_ID],
      ["alz:code", "123456"],
      ["alz:role", "family"],
    ],
  );
});

test("create notifies subscribers with the returned server state", async () => {
  const payload = familyState("123456");
  const fake = fakeSupabase({
    userId: "creator-b",
    existingSession: true,
    rpcResults: {
      create_family: [{ family_id: FAMILY_B_ID, family_code: "123456", revision: 0, payload }],
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
      join_family: { family_id: FAMILY_A_ID, family_code: "123456", revision: 1, payload },
    },
    tableResults: {
      family_members: {
        data: { family_id: FAMILY_A_ID, role: "elder", families: { code: "123456" } },
        error: null,
      },
    },
  });
  const { storage, store } = createStore(fake);

  await store.attach("123456", "elder");

  assert.equal(store.role(), "elder");
  assert.strictEqual(store.get(), payload);
  assert.equal(fake.calls.rpc[0].name, "join_family");
  assert.equal(fake.calls.rpc[0].parameters.family_code, "123456");
  assert.equal(fake.calls.rpc[0].parameters.requested_role, "elder");
  assert.deepEqual(
    [...storage.entries()],
    [
      ["alz:family-id", FAMILY_A_ID],
      ["alz:code", "123456"],
      ["alz:role", "elder"],
    ],
  );
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
    ["alz:family-id", FAMILY_A_ID],
    ["alz:code", "123456"],
    ["alz:role", "elder"],
  ]);
  const fake = fakeSupabase({
    userId: "elder-d",
    existingSession: true,
    tableResults: {
      family_members: {
        data: { family_id: FAMILY_A_ID, role: "elder", families: { code: "123456" } },
        error: null,
      },
      family_states: {
        data: { family_id: FAMILY_A_ID, revision: 4, payload },
        error: null,
      },
    },
  });
  const { store } = createStore(fake, [], { storage });

  assert.strictEqual(await store.restoreSelection(), payload);
  assert.strictEqual(store.get(), payload);
  assert.equal(store.role(), "elder");
  assert.deepEqual(
    fake.calls.from.map(({ table }) => table),
    ["family_members", "family_states"],
  );
});

test("a stalled cached-family restore times out instead of locking initialization forever", async () => {
  const storage = new Map([
    ["alz:family-id", FAMILY_A_ID],
    ["alz:code", "123456"],
    ["alz:role", "family"],
  ]);
  const membershipStarted = deferred();
  const neverCompletes = deferred();
  const activeTimers = new Map();
  let nextTimerId = 0;
  const fake = fakeSupabase({
    userId: "stalled-restore",
    existingSession: true,
    tableResults: {
      family_members: () => {
        membershipStarted.resolve();
        return neverCompletes.promise;
      },
    },
  });
  const { store } = createStore(fake, [], {
    storage,
    context: {
      setTimeout(callback, milliseconds) {
        const id = ++nextTimerId;
        activeTimers.set(id, { callback, milliseconds });
        return id;
      },
      clearTimeout(id) {
        activeTimers.delete(id);
      },
    },
  });

  const restore = store.restoreSelection();
  await membershipStarted.promise;

  assert.equal(activeTimers.size, 1, "the stalled backend request must have an active timeout");
  const [{ callback, milliseconds }] = activeTimers.values();
  assert.equal(milliseconds, 12000);
  callback();

  await assert.rejects(restore, {
    code: "BACKEND_ERROR",
    message: "Unable to connect to your family right now.",
  });
});

test("a stalled join request times out instead of leaving the family screen loading", async () => {
  const requestStarted = deferred();
  const neverCompletes = deferred();
  const timeouts = manualTimeouts();
  const fake = fakeSupabase({
    userId: "elder-stalled-join",
    existingSession: true,
    rpcHandlers: {
      join_family: () => {
        requestStarted.resolve();
        return neverCompletes.promise;
      },
    },
  });
  const { store } = createStore(fake, [], { context: timeouts.context });

  const joining = store.attach("527487", "elder");
  await requestStarted.promise;
  timeouts.fireOnly();

  await assert.rejects(joining, {
    code: "BACKEND_ERROR",
    message: "Unable to connect to your family right now.",
  });
});

test("restore clears an invalid cached selection without exposing family state", async () => {
  const storage = new Map([
    ["alz:family-id", FAMILY_A_ID],
    ["alz:code", "123456"],
    ["alz:role", "elder"],
  ]);
  const fake = fakeSupabase({
    userId: "elder-e",
    existingSession: true,
    tableResults: {
      family_members: { data: null, error: null },
      family_states: {
        data: { family_id: FAMILY_A_ID, revision: 4, payload: familyState("123456") },
        error: null,
      },
    },
  });
  const { store } = createStore(fake, [], { storage });

  assert.equal(await store.restoreSelection(), null);
  assert.equal(store.get(), null);
  assert.equal(store.role(), null);
  assert.equal(storage.size, 0);
  assert.deepEqual(
    fake.calls.from.map(({ table }) => table),
    ["family_members"],
  );
});

test("restore rejects malformed cached selection metadata before querying the backend", async (t) => {
  const cases = [
    ["family ID", "not-a-uuid", "123456", "elder"],
    ["family code", FAMILY_A_ID, "１２３４５６", "elder"],
    ["family role", FAMILY_A_ID, "123456", "owner"],
  ];

  for (const [label, familyId, code, role] of cases) {
    await t.test(label, async () => {
      const storage = new Map([
        ["alz:family-id", familyId],
        ["alz:code", code],
        ["alz:role", role],
      ]);
      const fake = fakeSupabase({ userId: "elder-invalid", existingSession: true });
      const { store } = createStore(fake, [], { storage });

      assert.equal(await store.restoreSelection(), null);
      assert.equal(storage.size, 0);
      assert.deepEqual(fake.calls.from, []);
    });
  }
});

test("join trims a valid family code before calling the RPC", async () => {
  const payload = familyState("123456", "zh", { paired: true, rev: 1 });
  const fake = fakeSupabase({
    userId: "elder-trimmed",
    existingSession: true,
    rpcResults: {
      join_family: { family_id: FAMILY_A_ID, family_code: "123456", revision: 1, payload },
    },
    tableResults: {
      family_members: {
        data: { family_id: FAMILY_A_ID, role: "elder", families: { code: "123456" } },
        error: null,
      },
    },
  });
  const { store } = createStore(fake);

  await store.attach(" 123456 ", "elder");

  assert.equal(fake.calls.rpc[0].parameters.family_code, "123456");
});

test("join rejects a malformed family code without calling the RPC", async () => {
  const fake = fakeSupabase({ userId: "elder-bad-code", existingSession: true });
  const { store } = createStore(fake);

  await assert.rejects(store.attach("12 3456", "elder"), { code: "FAMILY_NOT_FOUND" });
  assert.deepEqual(fake.calls.rpc, []);
});

test("join rejects a malformed role without calling the RPC", async () => {
  const fake = fakeSupabase({ userId: "elder-bad-role", existingSession: true });
  const { store } = createStore(fake);

  await assert.rejects(store.attach("123456", "owner"), { code: "BACKEND_ERROR" });
  assert.deepEqual(fake.calls.rpc, []);
});

test("join caches the authoritative role for a pre-existing membership", async () => {
  const payload = familyState("123456");
  const fake = fakeSupabase({
    userId: "existing-family-member",
    existingSession: true,
    rpcResults: {
      join_family: { family_id: FAMILY_A_ID, family_code: "123456", revision: 0, payload },
    },
    tableResults: {
      family_members: {
        data: { family_id: FAMILY_A_ID, role: "family", families: { code: "123456" } },
        error: null,
      },
    },
  });
  const { storage, store } = createStore(fake);

  await store.attach("123456", "elder");

  assert.equal(store.role(), "family");
  assert.equal(storage.get("alz:role"), "family");
  assert.deepEqual(
    fake.calls.from.map(({ table }) => table),
    ["family_members"],
  );
});

test("create rejects malformed RPC rows as backend errors", async (t) => {
  const validRow = {
    family_id: FAMILY_A_ID,
    family_code: "123456",
    revision: 0,
    payload: familyState("123456"),
  };
  const cases = [
    ["family ID", { ...validRow, family_id: "not-a-uuid" }],
    ["family code", { ...validRow, family_code: "１２３４５６" }],
    ["negative revision", { ...validRow, revision: -1 }],
    ["fractional revision", { ...validRow, revision: 0.5 }],
    ["array payload", { ...validRow, payload: [] }],
    ["mismatched payload code", { ...validRow, payload: familyState("654321") }],
  ];

  for (const [label, row] of cases) {
    await t.test(label, async () => {
      const fake = fakeSupabase({
        userId: "creator-malformed",
        existingSession: true,
        rpcResults: { create_family: [row] },
      });
      const { storage, store } = createStore(fake, [], {
        newFamily: (code, lang) => familyState(code, lang),
      });

      await assert.rejects(store.create("zh"), { code: "BACKEND_ERROR" });
      assert.equal(store.get(), null);
      assert.equal(storage.size, 0);
    });
  }
});

test("join rejects a malformed RPC row as a backend error", async () => {
  const fake = fakeSupabase({
    userId: "elder-malformed",
    existingSession: true,
    rpcResults: {
      join_family: {
        family_id: FAMILY_A_ID,
        family_code: "123456",
        revision: 1,
        payload: familyState("654321", "zh", { rev: 1 }),
      },
    },
  });
  const { storage, store } = createStore(fake);

  await assert.rejects(store.attach("123456", "elder"), { code: "BACKEND_ERROR" });
  assert.equal(store.get(), null);
  assert.equal(storage.size, 0);
  assert.deepEqual(fake.calls.from, []);
});

test("create maps RPC errors and empty results to backend errors", async (t) => {
  await t.test("RPC error", async () => {
    const fake = fakeSupabase({
      userId: "creator-error",
      existingSession: true,
      rpcErrors: { create_family: new Error("database detail") },
    });
    const { store } = createStore(fake, [], {
      newFamily: (code, lang) => familyState(code, lang),
    });

    await assert.rejects(store.create("zh"), {
      code: "BACKEND_ERROR",
      message: "Unable to connect to your family right now.",
    });
  });

  await t.test("empty result", async () => {
    const fake = fakeSupabase({
      userId: "creator-empty",
      existingSession: true,
      rpcResults: { create_family: [] },
    });
    const { store } = createStore(fake, [], {
      newFamily: (code, lang) => familyState(code, lang),
    });

    await assert.rejects(store.create("zh"), { code: "BACKEND_ERROR" });
  });
});

test("a stalled create request times out instead of leaving family creation loading", async () => {
  const requestStarted = deferred();
  const neverCompletes = deferred();
  const timeouts = manualTimeouts();
  const fake = fakeSupabase({
    userId: "creator-stalled",
    existingSession: true,
    rpcHandlers: {
      create_family: () => {
        requestStarted.resolve();
        return neverCompletes.promise;
      },
    },
  });
  const { store } = createStore(fake, [], {
    context: timeouts.context,
    newFamily: (code, lang) => familyState(code, lang),
  });

  const creating = store.create("en");
  await requestStarted.promise;
  timeouts.fireOnly();

  await assert.rejects(creating, {
    code: "BACKEND_ERROR",
    message: "Unable to connect to your family right now.",
  });
});

test("an older deferred restore cannot clear or overwrite a newer creation", async (t) => {
  await t.test("does not clear the newer family after an invalid membership result", async () => {
    const membershipStarted = deferred();
    const membershipResult = deferred();
    const newPayload = familyState("654321");
    const storage = new Map([
      ["alz:family-id", FAMILY_A_ID],
      ["alz:code", "123456"],
      ["alz:role", "elder"],
    ]);
    const fake = fakeSupabase({
      userId: "race-clear",
      existingSession: true,
      rpcResults: {
        create_family: [
          { family_id: FAMILY_B_ID, family_code: "654321", revision: 0, payload: newPayload },
        ],
      },
      tableResults: {
        family_members: () => {
          membershipStarted.resolve();
          return membershipResult.promise;
        },
      },
    });
    const { store } = createStore(fake, [], {
      newFamily: (code, lang) => familyState(code, lang),
      storage,
    });

    const restore = store.restoreSelection();
    await membershipStarted.promise;
    await store.create("zh");
    membershipResult.resolve({ data: null, error: null });
    await restore;

    assert.strictEqual(store.get(), newPayload);
    assert.equal(storage.get("alz:family-id"), FAMILY_B_ID);
    assert.equal(storage.get("alz:code"), "654321");
    assert.equal(storage.get("alz:role"), "family");
  });

  await t.test("does not overwrite the newer family with an older state result", async () => {
    const stateStarted = deferred();
    const stateResult = deferred();
    const oldPayload = familyState("123456", "zh", { rev: 4 });
    const newPayload = familyState("654321");
    const storage = new Map([
      ["alz:family-id", FAMILY_A_ID],
      ["alz:code", "123456"],
      ["alz:role", "elder"],
    ]);
    const fake = fakeSupabase({
      userId: "race-overwrite",
      existingSession: true,
      rpcResults: {
        create_family: [
          { family_id: FAMILY_B_ID, family_code: "654321", revision: 0, payload: newPayload },
        ],
      },
      tableResults: {
        family_members: {
          data: { family_id: FAMILY_A_ID, role: "elder", families: { code: "123456" } },
          error: null,
        },
        family_states: () => {
          stateStarted.resolve();
          return stateResult.promise;
        },
      },
    });
    const { store } = createStore(fake, [], {
      newFamily: (code, lang) => familyState(code, lang),
      storage,
    });

    const restore = store.restoreSelection();
    await stateStarted.promise;
    await store.create("zh");
    stateResult.resolve({
      data: { family_id: FAMILY_A_ID, revision: 4, payload: oldPayload },
      error: null,
    });
    await restore;

    assert.strictEqual(store.get(), newPayload);
    assert.equal(storage.get("alz:family-id"), FAMILY_B_ID);
    assert.equal(storage.get("alz:code"), "654321");
    assert.equal(storage.get("alz:role"), "family");
  });
});

test("an empty-cache restore cannot invalidate an in-flight creation", async () => {
  const rpcStarted = deferred();
  const rpcResult = deferred();
  const payload = familyState("123456");
  const statuses = [];
  const fake = fakeSupabase({
    userId: "race-create-first",
    existingSession: true,
    rpcResults: {
      create_family: () => {
        rpcStarted.resolve();
        return rpcResult.promise;
      },
    },
  });
  const { storage, store } = createStore(fake, statuses, {
    newFamily: (code, lang) => familyState(code, lang),
  });

  const creation = store.create("zh");
  await rpcStarted.promise;
  assert.equal(await store.restoreSelection(), null);
  rpcResult.resolve([{ family_id: FAMILY_A_ID, family_code: "123456", revision: 0, payload }]);

  assert.equal(await creation, "123456");
  assert.strictEqual(store.get(), payload);
  assert.equal(store.role(), "family");
  assert.equal(storage.get("alz:family-id"), FAMILY_A_ID);
  assert.equal(storage.get("alz:code"), "123456");
  assert.equal(storage.get("alz:role"), "family");
  assert.deepEqual(statuses.at(-1), ["loading"]);
});

test("an empty-cache restore cannot invalidate an in-flight join", async () => {
  const rpcStarted = deferred();
  const rpcResult = deferred();
  const payload = familyState("123456", "zh", { paired: true, rev: 1 });
  const statuses = [];
  const fake = fakeSupabase({
    userId: "race-join-first",
    existingSession: true,
    rpcResults: {
      join_family: () => {
        rpcStarted.resolve();
        return rpcResult.promise;
      },
    },
    tableResults: {
      family_members: {
        data: { family_id: FAMILY_A_ID, role: "elder", families: { code: "123456" } },
        error: null,
      },
    },
  });
  const { storage, store } = createStore(fake, statuses);

  const joining = store.attach("123456", "elder");
  await rpcStarted.promise;
  assert.equal(await store.restoreSelection(), null);
  rpcResult.resolve({ family_id: FAMILY_A_ID, family_code: "123456", revision: 1, payload });

  assert.strictEqual(await joining, payload);
  assert.strictEqual(store.get(), payload);
  assert.equal(store.role(), "elder");
  assert.equal(storage.get("alz:family-id"), FAMILY_A_ID);
  assert.equal(storage.get("alz:code"), "123456");
  assert.equal(storage.get("alz:role"), "elder");
  assert.deepEqual(statuses.at(-1), ["loading"]);
});

test("a selection storage failure does not discard newly created server state", async () => {
  const payload = familyState("123456");
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (key === "alz:code") throw new Error("Storage is unavailable");
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
  const fake = fakeSupabase({
    userId: "creator-storage",
    existingSession: true,
    rpcResults: {
      create_family: [{ family_id: FAMILY_A_ID, family_code: "123456", revision: 0, payload }],
    },
  });
  const { store } = createStore(fake, [], {
    newFamily: (code, lang) => familyState(code, lang),
    storage,
  });

  assert.equal(await store.create("zh"), "123456");
  assert.strictEqual(store.get(), payload);
  assert.equal(store.role(), "family");
  assert.deepEqual([...values.entries()], []);
});

test("update notifies optimistically and reconciles the server acknowledgement", async () => {
  const statuses = [];
  const rpcStarted = deferred();
  const rpcResult = deferred();
  const initialPayload = familyState("123456", "zh", { rev: 4 });
  const acceptedPayload = familyState("123456", "zh", {
    rev: 5,
    elder: { ...initialPayload.elder, name: "王奶奶", address: "服务端确认地址" },
  });
  const { fake, store } = await attachedStore({
    payload: initialPayload,
    revision: 4,
    statuses,
    rpcHandlers: {
      replace_family_state: (parameters) => {
        rpcStarted.resolve(parameters);
        return rpcResult.promise;
      },
    },
    tableResults: {
      family_states: {
        data: { family_id: FAMILY_A_ID, revision: 4, payload: initialPayload },
        error: null,
      },
    },
  });
  await fake.channels[0].emitStatus("SUBSCRIBED");
  const notifications = [];
  store.subscribe((nextState) => notifications.push(nextState));
  statuses.length = 0;

  const updating = store.update((draft) => {
    draft.elder.name = "王奶奶";
  });

  assert.equal(store.get().elder.name, "王奶奶");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].elder.name, "王奶奶");
  assert.deepEqual(statuses, [["saving"]]);

  const parameters = await rpcStarted.promise;
  assert.equal(fake.calls.rpc.at(-1).name, "replace_family_state");
  assert.equal(parameters.target_family_id, FAMILY_A_ID);
  assert.equal(parameters.expected_revision, 4);
  assert.equal(parameters.next_payload.elder.name, "王奶奶");
  rpcResult.resolve({
    data: [
      {
        family_id: FAMILY_A_ID,
        family_code: "123456",
        revision: 5,
        payload: acceptedPayload,
      },
    ],
    error: null,
  });

  assert.strictEqual(await updating, acceptedPayload);
  assert.strictEqual(store.get(), acceptedPayload);
  assert.strictEqual(notifications.at(-1), acceptedPayload);
  assert.deepEqual(statuses, [["saving"], ["synced"]]);
});

test("update serializes concurrent writes against confirmed revisions", async () => {
  const firstRpc = deferred();
  const secondRpc = deferred();
  let writeNumber = 0;
  const initialPayload = familyState("123456");
  const firstAccepted = familyState("123456", "zh", {
    rev: 1,
    elder: { ...initialPayload.elder, name: "王奶奶" },
  });
  const secondAccepted = familyState("123456", "zh", {
    rev: 2,
    elder: { ...initialPayload.elder, name: "王奶奶", radius: "1200" },
  });
  const { fake, store } = await attachedStore({
    payload: initialPayload,
    rpcHandlers: {
      replace_family_state: () => (++writeNumber === 1 ? firstRpc.promise : secondRpc.promise),
    },
  });

  const firstUpdate = store.update((draft) => {
    draft.elder.name = "王奶奶";
  });
  const secondUpdate = store.update((draft) => {
    draft.elder.radius = "1200";
  });
  await Promise.resolve();

  let writes = fake.calls.rpc.filter(({ name }) => name === "replace_family_state");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].parameters.expected_revision, 0);
  firstRpc.resolve({
    data: [
      {
        family_id: FAMILY_A_ID,
        family_code: "123456",
        revision: 1,
        payload: firstAccepted,
      },
    ],
    error: null,
  });
  await firstUpdate;
  await Promise.resolve();

  writes = fake.calls.rpc.filter(({ name }) => name === "replace_family_state");
  assert.equal(writes.length, 2);
  assert.equal(writes[1].parameters.expected_revision, 1);
  assert.equal(writes[1].parameters.next_payload.elder.name, "王奶奶");
  assert.equal(writes[1].parameters.next_payload.elder.radius, "1200");
  secondRpc.resolve({
    data: [
      {
        family_id: FAMILY_A_ID,
        family_code: "123456",
        revision: 2,
        payload: secondAccepted,
      },
    ],
    error: null,
  });

  assert.strictEqual(await secondUpdate, secondAccepted);
  assert.strictEqual(store.get(), secondAccepted);
});

test("Realtime ignores stale revisions and accepts a newer family state", async () => {
  const statuses = [];
  const initialPayload = familyState("123456", "zh", { rev: 3 });
  const { fake, store } = await attachedStore({
    payload: initialPayload,
    revision: 3,
    statuses,
    tableResults: {
      family_states: {
        data: { family_id: FAMILY_A_ID, revision: 3, payload: initialPayload },
        error: null,
      },
    },
  });
  await fake.channels[0].emitStatus("SUBSCRIBED");
  const notifications = [];
  store.subscribe((nextState) => notifications.push(nextState));

  assert.equal(fake.channels.length, 1);
  assert.equal(fake.channels[0].binding.type, "postgres_changes");
  assert.equal(fake.channels[0].binding.filter.event, "UPDATE");
  assert.equal(fake.channels[0].binding.filter.schema, "public");
  assert.equal(fake.channels[0].binding.filter.table, "family_states");
  assert.equal(fake.channels[0].binding.filter.filter, `family_id=eq.${FAMILY_A_ID}`);

  fake.channels[0].emitChange({
    family_id: FAMILY_A_ID,
    revision: 3,
    payload: familyState("123456", "zh", {
      rev: 3,
      elder: { ...initialPayload.elder, name: "过期名字" },
    }),
  });
  assert.strictEqual(store.get(), initialPayload);
  assert.equal(notifications.length, 0);

  const newerPayload = familyState("123456", "zh", {
    rev: 4,
    elder: { ...initialPayload.elder, name: "李奶奶" },
  });
  fake.channels[0].emitChange({
    family_id: FAMILY_A_ID,
    revision: 4,
    payload: newerPayload,
  });

  assert.strictEqual(store.get(), newerPayload);
  assert.strictEqual(notifications.at(-1), newerPayload);
  assert.deepEqual(statuses.at(-1), ["synced"]);
});

test("restore establishes the scoped Realtime subscription", async () => {
  const payload = familyState("123456", "zh", { rev: 2 });
  const storage = new Map([
    ["alz:family-id", FAMILY_A_ID],
    ["alz:code", "123456"],
    ["alz:role", "elder"],
  ]);
  const fake = fakeSupabase({
    userId: "restore-realtime",
    existingSession: true,
    tableResults: {
      family_members: {
        data: { family_id: FAMILY_A_ID, role: "elder", families: { code: "123456" } },
        error: null,
      },
      family_states: {
        data: { family_id: FAMILY_A_ID, revision: 2, payload },
        error: null,
      },
    },
  });
  const { store } = createStore(fake, [], { storage });

  await store.restoreSelection();

  assert.equal(fake.channels.length, 1);
  assert.equal(fake.channels[0].binding.filter.filter, `family_id=eq.${FAMILY_A_ID}`);
});

test("Realtime channel cleanup prevents an old family event from replacing a newer attachment", async () => {
  const firstPayload = familyState("123456", "zh", { rev: 1 });
  const secondPayload = familyState("654321", "zh", { rev: 7 });
  const fake = fakeSupabase({
    userId: "family-switch",
    existingSession: true,
    rpcHandlers: {
      join_family: ({ family_code }) => ({
        data: {
          family_id: family_code === "123456" ? FAMILY_A_ID : FAMILY_B_ID,
          family_code,
          revision: family_code === "123456" ? 1 : 7,
          payload: family_code === "123456" ? firstPayload : secondPayload,
        },
        error: null,
      }),
    },
    tableResults: {
      family_members: ({ filters }) => {
        const selectedId = filters.find(([column]) => column === "family_id")[1];
        const code = selectedId === FAMILY_A_ID ? "123456" : "654321";
        return {
          data: { family_id: selectedId, role: "family", families: { code } },
          error: null,
        };
      },
    },
  });
  const { store } = createStore(fake);

  await store.attach("123456", "family");
  const oldChannel = fake.channels[0];
  await store.attach("654321", "family");

  assert.equal(fake.calls.removeChannel.length, 1);
  assert.strictEqual(fake.calls.removeChannel[0], oldChannel);
  assert.equal(fake.channels.length, 2);
  oldChannel.emitChange({
    family_id: FAMILY_A_ID,
    revision: 99,
    payload: familyState("123456", "zh", { rev: 99 }),
  });
  assert.strictEqual(store.get(), secondPayload);
});

test("update retries one revision conflict against a fresh server state", async () => {
  const initialPayload = familyState("123456", "zh", { rev: 2 });
  const freshPayload = familyState("123456", "zh", {
    rev: 3,
    elder: { ...initialPayload.elder, address: "另一台设备更新的地址" },
  });
  const acceptedPayload = familyState("123456", "zh", {
    rev: 4,
    elder: { ...freshPayload.elder, name: "王奶奶" },
  });
  let attempts = 0;
  const { fake, store } = await attachedStore({
    payload: initialPayload,
    revision: 2,
    rpcHandlers: {
      replace_family_state: ({ expected_revision, next_payload }) => {
        attempts += 1;
        if (attempts === 1) {
          return {
            data: null,
            error: { code: "40001", message: "REVISION_CONFLICT" },
          };
        }
        assert.equal(expected_revision, 3);
        assert.equal(next_payload.elder.name, "王奶奶");
        assert.equal(next_payload.elder.address, "另一台设备更新的地址");
        return {
          data: [
            {
              family_id: FAMILY_A_ID,
              family_code: "123456",
              revision: 4,
              payload: acceptedPayload,
            },
          ],
          error: null,
        };
      },
    },
    tableResults: {
      family_states: {
        data: { family_id: FAMILY_A_ID, revision: 3, payload: freshPayload },
        error: null,
      },
    },
  });

  const result = await store.update((draft) => {
    draft.elder.name = "王奶奶";
  });

  assert.strictEqual(result, acceptedPayload);
  assert.strictEqual(store.get(), acceptedPayload);
  assert.equal(attempts, 2);
  assert.deepEqual(
    fake.calls.from.map(({ table }) => table),
    ["family_members", "family_states"],
  );
});

test("a queued update preserves server fields learned during an earlier conflict rebase", async () => {
  const initialPayload = familyState("123456", "zh", { rev: 2 });
  const freshPayload = familyState("123456", "zh", {
    rev: 3,
    elder: { ...initialPayload.elder, address: "另一台设备更新的地址" },
  });
  const firstAccepted = familyState("123456", "zh", {
    rev: 4,
    elder: { ...freshPayload.elder, name: "王奶奶" },
  });
  const finalAccepted = familyState("123456", "zh", {
    rev: 5,
    elder: { ...firstAccepted.elder, radius: "1200" },
  });
  let attempt = 0;
  let finalWrite = null;
  const { store } = await attachedStore({
    payload: initialPayload,
    revision: 2,
    rpcHandlers: {
      replace_family_state: (parameters) => {
        attempt += 1;
        if (attempt === 1) {
          return {
            data: null,
            error: { code: "40001", message: "REVISION_CONFLICT" },
          };
        }
        if (attempt === 2) {
          return {
            data: [
              {
                family_id: FAMILY_A_ID,
                family_code: "123456",
                revision: 4,
                payload: firstAccepted,
              },
            ],
            error: null,
          };
        }
        finalWrite = parameters;
        return {
          data: [
            {
              family_id: FAMILY_A_ID,
              family_code: "123456",
              revision: 5,
              payload: finalAccepted,
            },
          ],
          error: null,
        };
      },
    },
    tableResults: {
      family_states: {
        data: { family_id: FAMILY_A_ID, revision: 3, payload: freshPayload },
        error: null,
      },
    },
  });

  const firstUpdate = store.update((draft) => {
    draft.elder.name = "王奶奶";
  });
  const secondUpdate = store.update((draft) => {
    draft.elder.radius = "1200";
  });
  await Promise.all([firstUpdate, secondUpdate]);

  assert.equal(finalWrite.expected_revision, 4);
  assert.equal(finalWrite.next_payload.elder.name, "王奶奶");
  assert.equal(finalWrite.next_payload.elder.radius, "1200");
  assert.equal(finalWrite.next_payload.elder.address, "另一台设备更新的地址");
  assert.strictEqual(store.get(), finalAccepted);
});

test("update rolls back to the fresh server state after a repeated revision conflict", async () => {
  const statuses = [];
  const initialPayload = familyState("123456", "zh", { rev: 8 });
  const freshPayload = familyState("123456", "zh", {
    rev: 9,
    elder: { ...initialPayload.elder, address: "服务器上的最新地址" },
  });
  let attempts = 0;
  const { store } = await attachedStore({
    payload: initialPayload,
    revision: 8,
    statuses,
    rpcHandlers: {
      replace_family_state: () => {
        attempts += 1;
        return {
          data: null,
          error: { code: "40001", message: "REVISION_CONFLICT" },
        };
      },
    },
    tableResults: {
      family_states: {
        data: { family_id: FAMILY_A_ID, revision: 9, payload: freshPayload },
        error: null,
      },
    },
  });
  const notifications = [];
  store.subscribe((nextState) => notifications.push(nextState));
  statuses.length = 0;

  await assert.rejects(
    store.update((draft) => {
      draft.elder.name = "王奶奶";
    }),
    { code: "REVISION_CONFLICT" },
  );

  assert.equal(attempts, 2);
  assert.strictEqual(store.get(), freshPayload);
  assert.strictEqual(notifications.at(-1), freshPayload);
  assert.equal(
    statuses.some(([status]) => status === "synced"),
    false,
  );
  assert.deepEqual(statuses.at(-1), ["error", "Unable to connect to your family right now."]);
});

test("update preserves optimistic input while reporting offline and backend errors", async (t) => {
  await t.test("stalled network request", async () => {
    const statuses = [];
    const requestStarted = deferred();
    const neverCompletes = deferred();
    const timeouts = manualTimeouts();
    const { store } = await attachedStore({
      context: timeouts.context,
      statuses,
      rpcHandlers: {
        replace_family_state: () => {
          requestStarted.resolve();
          return neverCompletes.promise;
        },
      },
    });
    statuses.length = 0;

    const updating = store.update((draft) => {
      draft.elder.name = "仍然可见";
    });
    await requestStarted.promise;
    timeouts.fireOnly();

    await assert.rejects(updating, { code: "BACKEND_ERROR" });
    assert.equal(store.get().elder.name, "仍然可见");
    assert.deepEqual(statuses.at(-1), ["offline", "Unable to connect to your family right now."]);
  });

  await t.test("offline network failure", async () => {
    const statuses = [];
    const { store } = await attachedStore({
      statuses,
      rpcHandlers: {
        replace_family_state: () => {
          throw new TypeError("Failed to fetch");
        },
      },
    });
    statuses.length = 0;

    await assert.rejects(
      store.update((draft) => {
        draft.elder.name = "仍然可见";
      }),
      { code: "BACKEND_ERROR" },
    );

    assert.equal(store.get().elder.name, "仍然可见");
    assert.equal(
      statuses.some(([status]) => status === "synced"),
      false,
    );
    assert.deepEqual(statuses.at(-1), ["offline", "Unable to connect to your family right now."]);
  });

  await t.test("server write failure", async () => {
    const statuses = [];
    const { store } = await attachedStore({
      statuses,
      rpcHandlers: {
        replace_family_state: () => ({
          data: null,
          error: { code: "42501", message: "private database detail" },
        }),
      },
    });
    statuses.length = 0;

    await assert.rejects(
      store.update((draft) => {
        draft.elder.name = "仍然可见";
      }),
      { code: "BACKEND_ERROR" },
    );

    assert.equal(store.get().elder.name, "仍然可见");
    assert.deepEqual(statuses.at(-1), ["error", "Unable to connect to your family right now."]);
  });
});

test("Realtime disconnection reports offline without discarding family state", async () => {
  const statuses = [];
  const payload = familyState("123456");
  const { fake, store } = await attachedStore({ payload, statuses });
  statuses.length = 0;

  fake.channels[0].emitStatus("CHANNEL_ERROR", new Error("socket closed"));

  assert.strictEqual(store.get(), payload);
  assert.deepEqual(statuses, [["offline", "Unable to connect to your family right now."]]);
});

test("an old update acknowledgement cannot overwrite a newer family attachment", async () => {
  const updateStarted = deferred();
  const updateResult = deferred();
  const firstPayload = familyState("123456");
  const secondPayload = familyState("654321", "zh", { rev: 5 });
  const fake = fakeSupabase({
    userId: "update-family-switch",
    existingSession: true,
    rpcHandlers: {
      join_family: ({ family_code }) => ({
        data: {
          family_id: family_code === "123456" ? FAMILY_A_ID : FAMILY_B_ID,
          family_code,
          revision: family_code === "123456" ? 0 : 5,
          payload: family_code === "123456" ? firstPayload : secondPayload,
        },
        error: null,
      }),
      replace_family_state: (parameters) => {
        updateStarted.resolve(parameters);
        return updateResult.promise;
      },
    },
    tableResults: {
      family_members: ({ filters }) => {
        const selectedId = filters.find(([column]) => column === "family_id")[1];
        const code = selectedId === FAMILY_A_ID ? "123456" : "654321";
        return {
          data: { family_id: selectedId, role: "family", families: { code } },
          error: null,
        };
      },
    },
  });
  const { store } = createStore(fake);
  await store.attach("123456", "family");

  const oldUpdate = store.update((draft) => {
    draft.elder.name = "王奶奶";
  });
  await updateStarted.promise;
  await store.attach("654321", "family");
  updateResult.resolve({
    data: [
      {
        family_id: FAMILY_A_ID,
        family_code: "123456",
        revision: 1,
        payload: familyState("123456", "zh", { rev: 1 }),
      },
    ],
    error: null,
  });

  await oldUpdate;
  assert.strictEqual(store.get(), secondPayload);
});

test("resetFamily uses update with a fresh canonical payload and retains the family code", async () => {
  const initialPayload = familyState("123456", "zh", {
    rev: 6,
    people: [{ id: "person-1", name: "小王" }],
  });
  let resetArguments = null;
  const { fake, store } = await attachedStore({
    payload: initialPayload,
    revision: 6,
    newFamily: (code, lang) => {
      resetArguments = { code, lang };
      return familyState(code, lang);
    },
    rpcHandlers: {
      replace_family_state: ({ next_payload }) => ({
        data: [
          {
            family_id: FAMILY_A_ID,
            family_code: "123456",
            revision: 7,
            payload: { ...next_payload, rev: 7 },
          },
        ],
        error: null,
      }),
    },
  });

  await store.resetFamily();

  assert.deepEqual(resetArguments, { code: "123456", lang: "zh" });
  assert.equal(store.get().code, "123456");
  assert.deepEqual(store.get().people, []);
  assert.equal(fake.calls.rpc.at(-1).name, "replace_family_state");
});

test("signOut cleans up the Realtime channel and cached family selection", async () => {
  const { fake, storage, store } = await attachedStore();
  const oldChannel = fake.channels[0];

  await store.signOut();

  assert.equal(store.get(), null);
  assert.equal(store.role(), null);
  assert.equal(storage.size, 0);
  assert.strictEqual(fake.calls.removeChannel.at(-1), oldChannel);
  oldChannel.emitChange({
    family_id: FAMILY_A_ID,
    revision: 99,
    payload: familyState("123456", "zh", { rev: 99 }),
  });
  assert.equal(store.get(), null);
});

test("a failed update stays projected over later Realtime state until a later write saves it", async () => {
  const statuses = [];
  const initialPayload = familyState("123456");
  const remotePayload = familyState("123456", "zh", {
    rev: 1,
    elder: { ...initialPayload.elder, address: "远端新地址" },
  });
  const acceptedPayload = familyState("123456", "zh", {
    rev: 2,
    elder: { ...remotePayload.elder, name: "未保存的本地姓名", radius: "1200" },
  });
  let writeAttempt = 0;
  let laterWrite = null;
  const { fake, store } = await attachedStore({
    payload: initialPayload,
    statuses,
    rpcHandlers: {
      replace_family_state: (parameters) => {
        writeAttempt += 1;
        if (writeAttempt === 1) {
          return {
            data: null,
            error: { code: "503", message: "temporarily unavailable" },
          };
        }
        laterWrite = parameters;
        return {
          data: [
            {
              family_id: FAMILY_A_ID,
              family_code: "123456",
              revision: 2,
              payload: acceptedPayload,
            },
          ],
          error: null,
        };
      },
    },
    tableResults: {
      family_states: {
        data: { family_id: FAMILY_A_ID, revision: 0, payload: initialPayload },
        error: null,
      },
    },
  });
  await fake.channels[0].emitStatus("SUBSCRIBED");
  statuses.length = 0;

  await assert.rejects(
    store.update((draft) => {
      draft.elder.name = "未保存的本地姓名";
    }),
    { code: "BACKEND_ERROR" },
  );
  fake.channels[0].emitChange({
    family_id: FAMILY_A_ID,
    revision: 1,
    payload: remotePayload,
  });

  assert.equal(store.get().elder.name, "未保存的本地姓名");
  assert.equal(store.get().elder.address, "远端新地址");
  assert.equal(statuses.at(-1)[0], "error");
  assert.equal(
    statuses.some(([status]) => status === "synced"),
    false,
  );

  await store.update((draft) => {
    draft.elder.radius = "1200";
  });

  assert.equal(laterWrite.expected_revision, 1);
  assert.equal(laterWrite.next_payload.elder.name, "未保存的本地姓名");
  assert.equal(laterWrite.next_payload.elder.address, "远端新地址");
  assert.equal(laterWrite.next_payload.elder.radius, "1200");
  assert.strictEqual(store.get(), acceptedPayload);
  assert.equal(statuses.at(-1)[0], "synced");
});

test("a self Realtime event does not replay an in-flight mutator or duplicate its acknowledgement", async () => {
  const rpcStarted = deferred();
  const rpcResult = deferred();
  const acceptedPayload = familyState("123456", "zh", {
    rev: 1,
    askCounts: { reminder: 1 },
  });
  const { fake, store } = await attachedStore({
    rpcHandlers: {
      replace_family_state: (parameters) => {
        rpcStarted.resolve(parameters);
        return rpcResult.promise;
      },
    },
  });
  const notifications = [];
  store.subscribe((nextState) => notifications.push(nextState));

  const updating = store.update((draft) => {
    draft.askCounts.reminder = (draft.askCounts.reminder || 0) + 1;
  });
  await rpcStarted.promise;
  fake.channels[0].emitChange({
    family_id: FAMILY_A_ID,
    revision: 1,
    payload: acceptedPayload,
  });

  assert.equal(store.get().askCounts.reminder, 1);
  assert.equal(notifications.length, 2);
  rpcResult.resolve({
    data: [
      {
        family_id: FAMILY_A_ID,
        family_code: "123456",
        revision: 1,
        payload: acceptedPayload,
      },
    ],
    error: null,
  });
  await updating;

  assert.equal(store.get().askCounts.reminder, 1);
  assert.equal(notifications.length, 2);
});

test("a repeated conflict fetches the newest state after Realtime advances during retry", async () => {
  const retryStarted = deferred();
  const retryResult = deferred();
  const initialPayload = familyState("123456", "zh", { rev: 8 });
  const firstFreshPayload = familyState("123456", "zh", { rev: 9 });
  const realtimePayload = familyState("123456", "zh", {
    rev: 10,
    elder: { ...initialPayload.elder, address: "Realtime 地址" },
  });
  const newestPayload = familyState("123456", "zh", {
    rev: 11,
    elder: { ...initialPayload.elder, address: "恢复查询最新地址" },
  });
  let writeAttempt = 0;
  let stateRead = 0;
  const { fake, store } = await attachedStore({
    payload: initialPayload,
    revision: 8,
    rpcHandlers: {
      replace_family_state: () => {
        writeAttempt += 1;
        if (writeAttempt === 1) {
          return { data: null, error: { code: "40001", message: "REVISION_CONFLICT" } };
        }
        retryStarted.resolve();
        return retryResult.promise;
      },
    },
    tableResults: {
      family_states: () => {
        stateRead += 1;
        return stateRead === 1
          ? {
              data: { family_id: FAMILY_A_ID, revision: 9, payload: firstFreshPayload },
              error: null,
            }
          : {
              data: { family_id: FAMILY_A_ID, revision: 11, payload: newestPayload },
              error: null,
            };
      },
    },
  });

  const updating = store.update((draft) => {
    draft.elder.name = "王奶奶";
  });
  await retryStarted.promise;
  fake.channels[0].emitChange({
    family_id: FAMILY_A_ID,
    revision: 10,
    payload: realtimePayload,
  });
  retryResult.resolve({
    data: null,
    error: { code: "40001", message: "REVISION_CONFLICT" },
  });

  await assert.rejects(updating, { code: "REVISION_CONFLICT" });
  assert.equal(stateRead, 2);
  assert.strictEqual(store.get(), newestPayload);
  assert.equal(store.get().rev, 11);
});

test("a failed repeated-conflict recovery never regresses newer Realtime state", async () => {
  const statuses = [];
  const retryStarted = deferred();
  const retryResult = deferred();
  const initialPayload = familyState("123456", "zh", { rev: 8 });
  const firstFreshPayload = familyState("123456", "zh", { rev: 9 });
  const realtimePayload = familyState("123456", "zh", {
    rev: 10,
    elder: { ...initialPayload.elder, address: "Realtime 地址" },
  });
  let writeAttempt = 0;
  let stateRead = 0;
  const { fake, store } = await attachedStore({
    payload: initialPayload,
    revision: 8,
    statuses,
    rpcHandlers: {
      replace_family_state: () => {
        writeAttempt += 1;
        if (writeAttempt === 1) {
          return { data: null, error: { code: "40001", message: "REVISION_CONFLICT" } };
        }
        retryStarted.resolve();
        return retryResult.promise;
      },
    },
    tableResults: {
      family_states: () => {
        stateRead += 1;
        if (stateRead === 1) {
          return {
            data: { family_id: FAMILY_A_ID, revision: 9, payload: firstFreshPayload },
            error: null,
          };
        }
        throw new TypeError("Failed to fetch");
      },
    },
  });
  statuses.length = 0;

  const updating = store.update((draft) => {
    draft.elder.name = "王奶奶";
  });
  await retryStarted.promise;
  fake.channels[0].emitChange({
    family_id: FAMILY_A_ID,
    revision: 10,
    payload: realtimePayload,
  });
  retryResult.resolve({
    data: null,
    error: { code: "40001", message: "REVISION_CONFLICT" },
  });

  await assert.rejects(updating, { code: "REVISION_CONFLICT" });
  assert.equal(stateRead, 2);
  assert.strictEqual(store.get(), realtimePayload);
  assert.equal(store.get().rev, 10);
  assert.equal(statuses.at(-1)[0], "offline");
});

test("every Realtime SUBSCRIBED status catches up missed family state before syncing", async () => {
  const statuses = [];
  const initialPayload = familyState("123456", "zh", { rev: 1 });
  const missedPayload = familyState("123456", "zh", {
    rev: 2,
    elder: { ...initialPayload.elder, name: "断线期间的新名字" },
  });
  let stateRead = 0;
  const { fake, store } = await attachedStore({
    payload: initialPayload,
    revision: 1,
    statuses,
    tableResults: {
      family_states: () => {
        stateRead += 1;
        return {
          data: {
            family_id: FAMILY_A_ID,
            revision: stateRead === 1 ? 1 : 2,
            payload: stateRead === 1 ? initialPayload : missedPayload,
          },
          error: null,
        };
      },
    },
  });
  statuses.length = 0;

  await fake.channels[0].emitStatus("SUBSCRIBED");
  assert.equal(stateRead, 1);
  assert.equal(statuses.at(-1)[0], "synced");
  fake.channels[0].emitStatus("CHANNEL_ERROR", new Error("socket closed"));
  assert.equal(statuses.at(-1)[0], "offline");

  await fake.channels[0].emitStatus("SUBSCRIBED");

  assert.equal(stateRead, 2);
  assert.strictEqual(store.get(), missedPayload);
  assert.equal(statuses.at(-1)[0], "synced");
});

test("a failed family switch leaves the previous selection and Realtime channel active", async () => {
  const firstPayload = familyState("123456");
  const remotePayload = familyState("123456", "zh", {
    rev: 1,
    elder: { ...firstPayload.elder, name: "旧家庭仍在更新" },
  });
  const fake = fakeSupabase({
    userId: "failed-switch",
    existingSession: true,
    rpcHandlers: {
      join_family: ({ family_code }) =>
        family_code === "123456"
          ? {
              data: {
                family_id: FAMILY_A_ID,
                family_code,
                revision: 0,
                payload: firstPayload,
              },
              error: null,
            }
          : { data: null, error: { code: "503", message: "join failed" } },
    },
    tableResults: {
      family_members: {
        data: { family_id: FAMILY_A_ID, role: "family", families: { code: "123456" } },
        error: null,
      },
    },
  });
  const { store } = createStore(fake);
  await store.attach("123456", "family");
  const oldChannel = fake.channels[0];

  await assert.rejects(store.attach("654321", "family"), { code: "BACKEND_ERROR" });
  oldChannel.emitChange({
    family_id: FAMILY_A_ID,
    revision: 1,
    payload: remotePayload,
  });

  assert.strictEqual(store.get(), remotePayload);
  assert.equal(fake.calls.removeChannel.length, 0);
});

test("a hung write for one family does not block writes after selecting another family", async () => {
  const firstWriteStarted = deferred();
  const firstWriteResult = deferred();
  const firstPayload = familyState("123456");
  const secondPayload = familyState("654321", "zh", { rev: 5 });
  const firstAccepted = familyState("123456", "zh", { rev: 1 });
  const secondAccepted = familyState("654321", "zh", {
    rev: 6,
    elder: { ...secondPayload.elder, name: "第二个家庭的更新" },
  });
  let secondWriteStarted = false;
  const fake = fakeSupabase({
    userId: "partitioned-writes",
    existingSession: true,
    rpcHandlers: {
      join_family: ({ family_code }) => ({
        data: {
          family_id: family_code === "123456" ? FAMILY_A_ID : FAMILY_B_ID,
          family_code,
          revision: family_code === "123456" ? 0 : 5,
          payload: family_code === "123456" ? firstPayload : secondPayload,
        },
        error: null,
      }),
      replace_family_state: ({ target_family_id }) => {
        if (target_family_id === FAMILY_A_ID) {
          firstWriteStarted.resolve();
          return firstWriteResult.promise;
        }
        secondWriteStarted = true;
        return {
          data: [
            {
              family_id: FAMILY_B_ID,
              family_code: "654321",
              revision: 6,
              payload: secondAccepted,
            },
          ],
          error: null,
        };
      },
    },
    tableResults: {
      family_members: ({ filters }) => {
        const selectedId = filters.find(([column]) => column === "family_id")[1];
        const code = selectedId === FAMILY_A_ID ? "123456" : "654321";
        return {
          data: { family_id: selectedId, role: "family", families: { code } },
          error: null,
        };
      },
    },
  });
  const { store } = createStore(fake);
  await store.attach("123456", "family");
  const firstUpdate = store.update((draft) => {
    draft.elder.name = "第一个家庭的更新";
  });
  await firstWriteStarted.promise;
  await store.attach("654321", "family");
  const secondUpdate = store.update((draft) => {
    draft.elder.name = "第二个家庭的更新";
  });
  await Promise.resolve();
  await Promise.resolve();
  const startedBeforeFirstSettled = secondWriteStarted;

  firstWriteResult.resolve({
    data: [
      {
        family_id: FAMILY_A_ID,
        family_code: "123456",
        revision: 1,
        payload: firstAccepted,
      },
    ],
    error: null,
  });
  await Promise.allSettled([firstUpdate, secondUpdate]);

  assert.equal(startedBeforeFirstSettled, true);
  assert.strictEqual(store.get(), secondAccepted);
});

test("subscriber exceptions do not abort optimistic notification or persistence", async () => {
  const acceptedPayload = familyState("123456", "zh", {
    rev: 1,
    elder: { ...familyState("123456").elder, name: "王奶奶" },
  });
  const { fake, store } = await attachedStore({
    rpcHandlers: {
      replace_family_state: () => ({
        data: [
          {
            family_id: FAMILY_A_ID,
            family_code: "123456",
            revision: 1,
            payload: acceptedPayload,
          },
        ],
        error: null,
      }),
    },
  });
  let observedName = null;
  store.subscribe(() => {
    throw new Error("observer failed");
  });
  store.subscribe((nextState) => {
    observedName = nextState.elder.name;
  });

  await store.update((draft) => {
    draft.elder.name = "王奶奶";
  });

  assert.equal(observedName, "王奶奶");
  assert.equal(fake.calls.rpc.filter(({ name }) => name === "replace_family_state").length, 1);
});

test("status callback exceptions do not abort authentication, attachment, or persistence", async () => {
  const payload = familyState("123456");
  const acceptedPayload = familyState("123456", "zh", {
    rev: 1,
    elder: { ...payload.elder, name: "王奶奶" },
  });
  const fake = fakeSupabase({
    userId: "throwing-status",
    existingSession: true,
    rpcResults: {
      join_family: {
        family_id: FAMILY_A_ID,
        family_code: "123456",
        revision: 0,
        payload,
      },
      replace_family_state: [
        {
          family_id: FAMILY_A_ID,
          family_code: "123456",
          revision: 1,
          payload: acceptedPayload,
        },
      ],
    },
    tableResults: {
      family_members: {
        data: { family_id: FAMILY_A_ID, role: "family", families: { code: "123456" } },
        error: null,
      },
    },
  });
  const { store } = createStore(fake, [], {
    onStatus: () => {
      throw new Error("status observer failed");
    },
  });

  await store.attach("123456", "family");
  await store.update((draft) => {
    draft.elder.name = "王奶奶";
  });

  assert.strictEqual(store.get(), acceptedPayload);
});

test("mutator exceptions reject asynchronously without changing state or poisoning later writes", async () => {
  const statuses = [];
  const initialPayload = familyState("123456");
  const acceptedPayload = familyState("123456", "zh", {
    rev: 1,
    elder: { ...initialPayload.elder, name: "后续更新" },
  });
  const { fake, store } = await attachedStore({
    payload: initialPayload,
    statuses,
    rpcHandlers: {
      replace_family_state: () => ({
        data: [
          {
            family_id: FAMILY_A_ID,
            family_code: "123456",
            revision: 1,
            payload: acceptedPayload,
          },
        ],
        error: null,
      }),
    },
  });
  statuses.length = 0;
  let rejectedUpdate;

  assert.doesNotThrow(() => {
    rejectedUpdate = store.update(() => {
      throw new Error("mutator exploded");
    });
  });
  await assert.rejects(rejectedUpdate, { code: "BACKEND_ERROR" });

  assert.strictEqual(store.get(), initialPayload);
  assert.equal(statuses.at(-1)[0], "error");
  await store.update((draft) => {
    draft.elder.name = "后续更新";
  });
  assert.strictEqual(store.get(), acceptedPayload);
  assert.equal(fake.calls.rpc.filter(({ name }) => name === "replace_family_state").length, 1);
});

test("subscribe returns an unsubscribe function that stops later notifications", async () => {
  const { fake, store } = await attachedStore();
  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications += 1;
  });

  assert.equal(typeof unsubscribe, "function");
  unsubscribe();
  fake.channels[0].emitChange({
    family_id: FAMILY_A_ID,
    revision: 1,
    payload: familyState("123456", "zh", { rev: 1 }),
  });

  assert.equal(notifications, 0);
});

test("a recursively reordered self Realtime payload covers a committed write after transport failure", async () => {
  const rpcStarted = deferred();
  const rpcResult = deferred();
  const acceptedPayload = familyState("123456", "zh", {
    rev: 1,
    askCounts: { reminder: 1 },
  });
  const reorderedPayload = recursivelyReverseObjectKeys(acceptedPayload);
  const { fake, store } = await attachedStore({
    rpcHandlers: {
      replace_family_state: (parameters) => {
        rpcStarted.resolve(parameters);
        return rpcResult.promise;
      },
    },
  });
  const notifications = [];
  store.subscribe((nextState) => notifications.push(nextState));

  const updating = store.update((draft) => {
    draft.askCounts.reminder = (draft.askCounts.reminder || 0) + 1;
  });
  await rpcStarted.promise;
  fake.channels[0].emitChange({
    family_id: FAMILY_A_ID,
    revision: 1,
    payload: reorderedPayload,
  });
  const countAfterRealtime = store.get().askCounts.reminder;
  rpcResult.reject(new TypeError("transport response lost"));
  const outcome = await updating.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );

  assert.equal(countAfterRealtime, 1);
  assert.equal(outcome.error, undefined);
  assert.strictEqual(outcome.value, reorderedPayload);
  assert.equal(store.get().askCounts.reminder, 1);
  assert.equal(notifications.length, 2);
  assert.equal(fake.calls.rpc.filter(({ name }) => name === "replace_family_state").length, 1);
});

test("an operation whose mutator fails during conflict replay cannot poison a later update", async () => {
  const initialPayload = familyState("123456");
  const freshPayload = familyState("123456", "zh", {
    rev: 1,
    elder: { ...initialPayload.elder, address: "冲突后的服务器地址" },
  });
  const acceptedPayload = familyState("123456", "zh", {
    rev: 2,
    elder: { ...freshPayload.elder, radius: "1200" },
  });
  let writeAttempt = 0;
  let laterWrite = null;
  const { store } = await attachedStore({
    payload: initialPayload,
    rpcHandlers: {
      replace_family_state: (parameters) => {
        writeAttempt += 1;
        if (writeAttempt === 1) {
          return { data: null, error: { code: "40001", message: "REVISION_CONFLICT" } };
        }
        laterWrite = parameters;
        return {
          data: [
            {
              family_id: FAMILY_A_ID,
              family_code: "123456",
              revision: 2,
              payload: acceptedPayload,
            },
          ],
          error: null,
        };
      },
    },
    tableResults: {
      family_states: {
        data: { family_id: FAMILY_A_ID, revision: 1, payload: freshPayload },
        error: null,
      },
    },
  });

  await assert.rejects(
    store.update((draft) => {
      if (draft.elder.address === "冲突后的服务器地址") {
        throw new Error("cannot replay on changed elder data");
      }
      draft.elder.name = "本地未提交姓名";
    }),
    { code: "BACKEND_ERROR" },
  );

  assert.strictEqual(store.get(), freshPayload);
  await store.update((draft) => {
    draft.elder.radius = "1200";
  });

  assert.equal(writeAttempt, 2);
  assert.equal(laterWrite.expected_revision, 1);
  assert.equal(laterWrite.next_payload.elder.name, "陈爷爷");
  assert.equal(laterWrite.next_payload.elder.address, "冲突后的服务器地址");
  assert.equal(laterWrite.next_payload.elder.radius, "1200");
  assert.strictEqual(store.get(), acceptedPayload);
});

test("a queued operation quarantined during replay stays unsaved until rejection and never writes", async () => {
  const statuses = [];
  const retryStarted = deferred();
  const retryResult = deferred();
  const initialPayload = familyState("123456");
  const freshPayload = familyState("123456", "zh", {
    rev: 1,
    elder: { ...initialPayload.elder, address: "冲突后的服务器地址" },
  });
  const acceptedPayload = familyState("123456", "zh", {
    rev: 2,
    elder: { ...freshPayload.elder, name: "第一项已保存" },
  });
  let writeAttempt = 0;
  let stateRead = 0;
  const { fake, store } = await attachedStore({
    payload: initialPayload,
    statuses,
    rpcHandlers: {
      replace_family_state: () => {
        writeAttempt += 1;
        if (writeAttempt === 1) {
          return { data: null, error: { code: "40001", message: "REVISION_CONFLICT" } };
        }
        if (writeAttempt === 2) {
          retryStarted.resolve();
          return retryResult.promise;
        }
        return { data: null, error: { code: "UNEXPECTED_WRITE" } };
      },
    },
    tableResults: {
      family_states: () => {
        stateRead += 1;
        return {
          data: {
            family_id: FAMILY_A_ID,
            revision: stateRead === 1 ? 0 : 1,
            payload: stateRead === 1 ? initialPayload : freshPayload,
          },
          error: null,
        };
      },
    },
  });
  await fake.channels[0].emitStatus("SUBSCRIBED");
  statuses.length = 0;

  const firstUpdate = store.update((draft) => {
    draft.elder.name = "第一项已保存";
  });
  let secondSettlementStatusCount = -1;
  const secondUpdate = store
    .update((draft) => {
      if (draft.elder.address === "冲突后的服务器地址") {
        throw new Error("cannot replay queued operation");
      }
      draft.elder.radius = "1200";
    })
    .then(
      (value) => {
        secondSettlementStatusCount = statuses.length;
        return { value };
      },
      (error) => {
        secondSettlementStatusCount = statuses.length;
        return { error };
      },
    );

  await retryStarted.promise;
  assert.equal(writeAttempt, 2);
  assert.equal(
    statuses.some(([status]) => status === "synced"),
    false,
  );
  retryResult.resolve({
    data: [
      {
        family_id: FAMILY_A_ID,
        family_code: "123456",
        revision: 2,
        payload: acceptedPayload,
      },
    ],
    error: null,
  });

  assert.strictEqual(await firstUpdate, acceptedPayload);
  const secondOutcome = await secondUpdate;

  assert.equal(secondOutcome.error.code, "BACKEND_ERROR");
  assert.deepEqual(
    {
      syncedBeforeSettlement: statuses
        .slice(0, secondSettlementStatusCount)
        .some(([status]) => status === "synced"),
      writeAttempt,
    },
    { syncedBeforeSettlement: false, writeAttempt: 2 },
  );
  assert.strictEqual(store.get(), acceptedPayload);
});

test("a valid queued update excludes a quarantined predecessor from its saved payload", async () => {
  const initialPayload = familyState("123456", "zh", {
    rev: 4,
    elder: {
      ...familyState("123456").elder,
      address: "服务器当前地址",
    },
  });
  const acceptedPayload = familyState("123456", "zh", {
    rev: 5,
    elder: {
      ...initialPayload.elder,
      radius: "1200",
    },
  });
  let writeAttempt = 0;
  let laterWrite = null;
  const { store } = await attachedStore({
    payload: initialPayload,
    revision: 4,
    rpcHandlers: {
      replace_family_state: (parameters) => {
        writeAttempt += 1;
        if (writeAttempt === 1) {
          return { data: null, error: { code: "BACKEND_ERROR", message: "write failed" } };
        }
        laterWrite = parameters;
        return {
          data: [
            {
              family_id: FAMILY_A_ID,
              family_code: "123456",
              revision: 5,
              payload: acceptedPayload,
            },
          ],
          error: null,
        };
      },
    },
  });
  let predecessorApplication = 0;

  const rejectedUpdate = store.update((draft) => {
    predecessorApplication += 1;
    if (predecessorApplication > 1) throw new Error("cannot replay failed predecessor");
    draft.elder.name = "不得保存的姓名";
  });
  const validUpdate = store.update((draft) => {
    draft.elder.radius = "1200";
  });

  await assert.rejects(rejectedUpdate, { code: "BACKEND_ERROR" });
  assert.strictEqual(await validUpdate, acceptedPayload);

  assert.equal(writeAttempt, 2);
  assert.equal(laterWrite.expected_revision, 4);
  assert.deepEqual(laterWrite.next_payload.elder, {
    name: "陈爷爷",
    address: "服务器当前地址",
    radius: "1200",
  });
  assert.strictEqual(store.get(), acceptedPayload);
});
