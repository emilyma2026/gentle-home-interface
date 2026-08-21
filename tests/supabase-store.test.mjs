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
        return error ? { data: { user: null }, error } : { data: { user }, error: null };
      },
    },
    async rpc(name, parameters) {
      calls.rpc.push({ name, parameters });
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
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
