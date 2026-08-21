# Supabase Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace browser-only family storage with Supabase persistence, anonymous device identity, six-digit family pairing, and cross-device Realtime synchronization.

**Architecture:** Preserve the existing `newFamily()` JSON state shape and replace the local `Store` implementation with a Supabase-backed adapter. Three Postgres tables and three security-definer RPC functions enforce membership, revision checks, and RLS; the browser renders optimistically and reconciles server acknowledgements and Realtime events.

**Tech Stack:** Existing HTML/CSS/JavaScript application, Supabase Auth, PostgreSQL, PostgREST RPC, Supabase Realtime, Supabase JavaScript client v2, Node.js built-in test runner, PostCSS, Vite/TanStack Start, Cloudflare Workers.

**Spec:** `docs/superpowers/specs/2026-08-21-supabase-backend-foundation-design.md`

## Global Constraints

- Keep the current `newFamily()` payload as the only application state model in this milestone.
- Use Supabase anonymous authentication; do not add visible account registration or passwords.
- Use only the project URL and publishable key in browser code.
- Never commit or expose a secret key, `service_role` key, database password, or personal access token.
- All public tables must have RLS enabled; browser writes must go through the defined RPC functions.
- Do not silently fall back to `localStorage` family data when Supabase is unavailable.
- Preserve the existing simulated call, fixed Q&A, virtual location, guide flow, bilingual copy, and responsive UI.
- Realtime changes should appear on a second device within two seconds under normal network conditions.
- Use fictional demo data only; do not enter real health, location, or family information during development.

## File Map

- Create `supabase/migrations/202608210001_backend_foundation.sql`: schema, functions, grants, RLS, indexes, and Realtime publication.
- Create `tests/backend-migration.test.mjs`: static contract checks for the committed migration.
- Create `public/app/supabase-config.js`: project URL and publishable key.
- Create `public/app/supabase-store.js`: auth, RPC, cache, optimistic writes, revision conflict handling, Realtime, and status events.
- Create `tests/supabase-store.test.mjs`: adapter tests using a deterministic fake Supabase client.
- Create `tests/backend-docs.test.mjs`: documentation contract for setup, deployment, and secret-safety guidance.
- Modify `public/app/index.html`: load Supabase, replace local Store wiring, await create/join/restore, and render connection feedback.
- Modify `tests/entry-homepage.test.mjs`: verify required backend scripts and connection UI are present.
- Modify `README.md`: dashboard setup, migration, local run, Cloudflare build/deploy, and two-device verification.
- Modify `todo.md`: mark P0-01 through P0-04 complete only after remote and two-device acceptance passes.

---

### Task 1: Commit the Database Contract

**Files:**

- Create: `tests/backend-migration.test.mjs`
- Create: `supabase/migrations/202608210001_backend_foundation.sql`

**Interfaces:**

- Produces tables `families`, `family_members`, and `family_states`.
- Produces RPCs `create_family(initial_payload jsonb, requested_role text)`, `join_family(family_code text, requested_role text)`, and `replace_family_state(target_family_id uuid, expected_revision bigint, next_payload jsonb)`.
- RPC success rows expose `family_id uuid`, `family_code text`, `revision bigint`, and `payload jsonb` where applicable.

- [ ] **Step 1: Write the failing migration contract test**

Create a Node test that reads the migration and requires the exact schema and security contracts:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sql = readFileSync(
  new URL("../supabase/migrations/202608210001_backend_foundation.sql", import.meta.url),
  "utf8",
);

test("migration defines the backend foundation", () => {
  for (const table of ["families", "family_members", "family_states"]) {
    assert.match(sql, new RegExp(`create table public\\.${table}`, "i"));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
  for (const fn of ["create_family", "join_family", "replace_family_state"]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${fn}`, "i"));
  }
  assert.match(sql, /revoke all on function/i);
  assert.match(sql, /grant execute on function/i);
  assert.match(sql, /supabase_realtime/i);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test --test-isolation=none tests/backend-migration.test.mjs`

Expected: FAIL with `ENOENT` for the missing migration.

- [ ] **Step 3: Implement the migration**

Write idempotent SQL with these concrete rules:

```sql
create table public.families (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[0-9]{6}$'),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.family_members (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('family', 'elder')),
  joined_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

create table public.family_states (
  family_id uuid primary key references public.families(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  revision bigint not null default 0 check (revision >= 0),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  check (octet_length(payload::text) <= 1048576)
);

create index family_members_user_id_idx on public.family_members(user_id);
```

Implement all three RPCs exactly as specified in the design. Each function must:

```sql
language plpgsql
security definer
set search_path = ''
```

Use `auth.uid()` as the caller identity, fully qualified table names, a six-digit server-generated code, transactional inserts, membership checks, and `revision = expected_revision` in the update statement. Revoke public execution and grant only to `authenticated`. Add `family_states` to `supabase_realtime` only when it is not already in the publication.

- [ ] **Step 4: Run the migration contract test**

Run: `node --test --test-isolation=none tests/backend-migration.test.mjs`

Expected: PASS with 1 test and 0 failures.

- [ ] **Step 5: Commit the database contract**

```sh
git add -- tests/backend-migration.test.mjs supabase/migrations/202608210001_backend_foundation.sql
git commit -m "Add Supabase backend schema"
```

---

### Task 2: Build the Supabase Store Authentication Core

**Files:**

- Create: `public/app/supabase-config.js`
- Create: `public/app/supabase-store.js`
- Create: `tests/supabase-store.test.mjs`

**Interfaces:**

- Consumes `window.supabase.createClient(url, publishableKey)` from Supabase JavaScript v2.
- Produces `window.createSupabaseStore(options)`.
- `options` contains `{ client, newFamily, onStatus, storage }`.
- Store status is one of `connecting`, `loading`, `saving`, `synced`, `offline`, or `error`.
- Produces async methods `initialize()`, `create(lang)`, `attach(code, role)`, and `signOut()` plus synchronous `get()`, `role()`, `codeOf()`, `meId()`, and `subscribe(callback)`.

- [ ] **Step 1: Write failing auth and configuration tests**

The tests load `supabase-store.js` in `vm`, inject a fake client, and assert:

```js
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
```

Also assert `supabase-config.js` contains the supplied project URL, a key beginning with `sb_publishable_`, and no `service_role` or secret-key field.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test --test-isolation=none tests/supabase-store.test.mjs`

Expected: FAIL because the store and config files do not exist.

- [ ] **Step 3: Implement configuration and authentication**

Create the public configuration:

```js
window.SUPABASE_CONFIG = Object.freeze({
  url: "https://kmkgbczjukbvktuxejhr.supabase.co",
  publishableKey: "sb_publishable_wKw9LTQlRJwSA0GoKQH62g_g_g9Bmey",
});
```

Create the store factory as a browser IIFE that also supports VM testing:

```js
(function (global) {
  function createSupabaseStore({ client, newFamily, onStatus, storage }) {
    let user = null;
    let state = null;
    let familyId = null;
    let revision = -1;
    let channel = null;
    const subscribers = [];

    async function initialize() {
      onStatus("connecting");
      const { data } = await client.auth.getSession();
      if (data.session?.user) user = data.session.user;
      else {
        const result = await client.auth.signInAnonymously();
        if (result.error) throw result.error;
        user = result.data.user;
      }
      onStatus("synced");
      return user;
    }

    return { initialize };
  }

  global.createSupabaseStore = createSupabaseStore;
})(typeof window === "undefined" ? globalThis : window);
```

Add explicit error conversion so auth failures call `onStatus("error", message)` and reject. Do not create a local-only family on failure.

- [ ] **Step 4: Run the store tests**

Run: `node --test --test-isolation=none tests/supabase-store.test.mjs`

Expected: PASS for configuration and both authentication paths.

- [ ] **Step 5: Commit the authentication core**

```sh
git add -- public/app/supabase-config.js public/app/supabase-store.js tests/supabase-store.test.mjs
git commit -m "Add Supabase store authentication"
```

---

### Task 3: Implement Family Creation, Joining, and Restoration

**Files:**

- Modify: `public/app/supabase-store.js`
- Modify: `tests/supabase-store.test.mjs`

**Interfaces:**

- Consumes RPCs `create_family` and `join_family` from Task 1.
- `create(lang)` returns the six-digit family code after caching the returned state.
- `attach(code, role)` returns the latest state or throws `{ code: "FAMILY_NOT_FOUND" }`.
- `restoreSelection()` validates cached `alz:family-id`, `alz:code`, and `alz:role` against `family_members` before loading state.

- [ ] **Step 1: Add failing create, join, and restore tests**

Cover these exact outcomes:

```js
assert.equal(await store.create("zh"), "123456");
assert.equal(store.get().code, "123456");

await store.attach("123456", "elder");
assert.equal(store.role(), "elder");

await assert.rejects(store.attach("000000", "elder"), {
  code: "FAMILY_NOT_FOUND",
});
```

Add a restore test in which cached membership is valid and one in which the membership query returns no row; the invalid cache must be removed without exposing state.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `node --test --test-isolation=none --test-name-pattern="create|join|restore" tests/supabase-store.test.mjs`

Expected: FAIL because the methods are missing.

- [ ] **Step 3: Implement RPC mapping and selection storage**

Use these exact RPC parameter names:

```js
client.rpc("create_family", {
  initial_payload: newFamily("", lang),
  requested_role: "family",
});

client.rpc("join_family", {
  family_code: code,
  requested_role: role,
});
```

Normalize Supabase single-row responses, set `familyId`, `revision`, and `state`, cache only the selection metadata, and notify subscribers. Map an empty `join_family` result to `FAMILY_NOT_FOUND`; propagate other Supabase errors as `BACKEND_ERROR` with a user-safe message.

- [ ] **Step 4: Run all store tests**

Run: `node --test --test-isolation=none tests/supabase-store.test.mjs`

Expected: PASS with authentication, create, join, and restore cases.

- [ ] **Step 5: Commit family lifecycle support**

```sh
git add -- public/app/supabase-store.js tests/supabase-store.test.mjs
git commit -m "Add Supabase family lifecycle"
```

---

### Task 4: Add Optimistic Writes, Revision Conflicts, and Realtime

**Files:**

- Modify: `public/app/supabase-store.js`
- Modify: `tests/supabase-store.test.mjs`

**Interfaces:**

- `update(mutator)` returns a Promise resolving to the accepted state.
- `resetFamily()` uses `update()` with a fresh payload while retaining server code and membership.
- Realtime subscribes to `postgres_changes` UPDATE events on `public.family_states` filtered by `family_id=eq.<uuid>`.
- Conflict code is `REVISION_CONFLICT`; one rebase/retry is allowed.

- [ ] **Step 1: Add failing synchronization tests**

Add tests for:

```js
await store.update((draft) => {
  draft.elder.name = "王奶奶";
});
assert.equal(store.get().elder.name, "王奶奶");
assert.equal(fake.calls.rpc.at(-1).name, "replace_family_state");
```

Also verify optimistic subscriber notification, server acknowledgement, stale Realtime event rejection, newer event acceptance, successful one-time conflict retry, repeated-conflict rollback, channel cleanup, and offline/error status.

- [ ] **Step 2: Run synchronization tests and verify failure**

Run: `node --test --test-isolation=none --test-name-pattern="update|Realtime|conflict|offline" tests/supabase-store.test.mjs`

Expected: FAIL because update and subscription behavior are missing.

- [ ] **Step 3: Implement queued optimistic synchronization**

Implement `update(mutator)` by cloning with `structuredClone`, notifying immediately, then serializing writes through a promise queue. Call:

```js
client.rpc("replace_family_state", {
  target_family_id: familyId,
  expected_revision: revision,
  next_payload: draft,
});
```

On `REVISION_CONFLICT`, fetch `family_states` by `family_id`, apply the same mutator to the fresh payload, and retry once. On a second conflict, restore the fetched server state, set `error`, and reject. Subscribe after attach/restore; ignore events whose revision is not newer than the last confirmed revision.

- [ ] **Step 4: Run all store tests**

Run: `node --test --test-isolation=none tests/supabase-store.test.mjs`

Expected: PASS with 0 failures.

- [ ] **Step 5: Commit synchronization support**

```sh
git add -- public/app/supabase-store.js tests/supabase-store.test.mjs
git commit -m "Add realtime family synchronization"
```

---

### Task 5: Integrate Supabase Into the Existing Interface

**Files:**

- Modify: `public/app/index.html`
- Modify: `tests/entry-homepage.test.mjs`

**Interfaces:**

- Consumes `window.SUPABASE_CONFIG`, `window.supabase`, and `window.createSupabaseStore`.
- Produces visible `#connectionStatus` with the six defined connection states.
- Existing click handlers await async create, pair, reset, and sign-out operations.

- [ ] **Step 1: Add failing HTML integration tests**

Assert the HTML contains, in this order:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="/app/supabase-config.js"></script>
<script src="/app/supabase-store.js"></script>
```

Also assert the old comment `数据层：localStorage + BroadcastChannel` is absent, `createSupabaseStore` is used, the document click listener is async, and `connectionStatus` is rendered.

- [ ] **Step 2: Run the existing and new HTML tests and verify failure**

Run: `node --test --test-isolation=none tests/entry-homepage.test.mjs`

Expected: existing 8 tests pass and new backend integration assertions fail.

- [ ] **Step 3: Replace the Store wiring with the Supabase adapter**

Load the three scripts before the existing application script. Keep `sessionStorage` only for selected role/code/member metadata. Construct the client and store:

```js
var SupabaseClient = window.supabase.createClient(
  window.SUPABASE_CONFIG.url,
  window.SUPABASE_CONFIG.publishableKey,
);
var Store = window.createSupabaseStore({
  client: SupabaseClient,
  newFamily: newFamily,
  storage: window.localStorage,
  onStatus: setConnectionStatus,
});
```

Make startup await `Store.initialize()` and `Store.restoreSelection()`. Make create and pair await their store calls, disable repeat clicks while pending, and preserve the existing friendly invalid-code copy. Convert all callers of `Store.update()` to tolerate its Promise and surface rejected writes through the connection status without producing unhandled rejections.

- [ ] **Step 4: Add connection-status UI and styles**

Render a compact, accessible status element with `role="status"` and `aria-live="polite"`. Show connecting, loading, saving, offline, and error states; hide or visually minimize synced state. Disable protected actions while connecting/loading and add a retry control for initialization failures.

- [ ] **Step 5: Run UI tests and build**

Run:

```sh
node --test --test-isolation=none tests/entry-homepage.test.mjs tests/supabase-store.test.mjs tests/backend-migration.test.mjs
npx eslint tests/entry-homepage.test.mjs tests/supabase-store.test.mjs tests/backend-migration.test.mjs
npm run build
```

Expected: all tests pass, targeted lint exits 0, and the production build exits 0. Restore only generated `src/routeTree.gen.ts` changes after verifying the build output.

- [ ] **Step 6: Commit UI integration**

```sh
git add -- public/app/index.html tests/entry-homepage.test.mjs
git commit -m "Connect the app to Supabase"
```

---

### Task 6: Apply the Migration and Verify Remote Security

**Files:**

- Use: `supabase/migrations/202608210001_backend_foundation.sql`
- Modify only if a verified remote SQL error requires a migration correction.

**Interfaces:**

- Requires the project owner to enable anonymous sign-ins and execute the committed migration in the Supabase dashboard.
- Uses only browser publishable-key sessions for verification.

- [ ] **Step 1: Ask the project owner to enable anonymous sign-ins**

In Supabase Dashboard, open Authentication settings and enable anonymous sign-ins. Do not request or share a secret key.

- [ ] **Step 2: Ask the project owner to apply the migration**

Open Supabase SQL Editor, paste the complete committed migration, execute it once, and provide only the success/error output. If it errors, diagnose the exact SQL statement before changing the migration.

- [ ] **Step 3: Run the remote two-session security smoke test**

Use two independent anonymous browser sessions and verify:

- Session A creates a family.
- Session B cannot select A's state before joining.
- Session B joins using the valid code and can then read the state.
- A third session using an invalid code receives no family data.
- A stale revision update is rejected.

- [ ] **Step 4: Commit only verified migration corrections**

If the remote migration required a correction:

```sh
git add -- supabase/migrations/202608210001_backend_foundation.sql tests/backend-migration.test.mjs
git commit -m "Fix Supabase migration compatibility"
```

If no correction was needed, do not create an empty commit.

---

### Task 7: Document Setup, Deploy, and Complete Two-Device Acceptance

**Files:**

- Modify: `README.md`
- Modify: `todo.md`

**Interfaces:**

- Cloudflare deploy command must build before deploy: `bun run build && npx wrangler deploy`.
- Acceptance requires two physical devices or isolated browser profiles over HTTPS.

- [ ] **Step 1: Add a failing documentation contract test**

Create `tests/backend-docs.test.mjs` to require README sections for Supabase URL/key type, anonymous auth, migration application, Cloudflare deploy command, and two-device verification. Assert README never contains `service_role` followed by an actual key value.

- [ ] **Step 2: Run the documentation test and verify failure**

Run: `node --test --test-isolation=none tests/backend-docs.test.mjs`

Expected: FAIL because the setup instructions are absent.

- [ ] **Step 3: Update README with exact operator steps**

Document:

1. Enable anonymous sign-ins.
2. Execute `supabase/migrations/202608210001_backend_foundation.sql`.
3. Use only the project URL and publishable key in browser configuration.
4. Run `npm install`, `npm run dev`, targeted tests, and `npm run build`.
5. Configure Cloudflare to run `bun run build && npx wrangler deploy`.
6. Perform the eight-step two-device acceptance test from the design spec.

- [ ] **Step 4: Deploy and run two-device acceptance**

Deploy over HTTPS, create a family on phone A, join on phone B, edit a person field, run the simulated call/fact/Q&A flow, reload both phones, and verify an invalid code reveals nothing. Record the deployed URL and acceptance date in README only after the deployment succeeds.

- [ ] **Step 5: Mark roadmap items complete only after acceptance**

Change P0-01 through P0-04 in `todo.md` from `[ ]` to `[x]`, update the counts from `0 / 38` to `4 / 38`, and leave P0-05 onward unchecked.

- [ ] **Step 6: Run final verification**

Run:

```sh
node --test --test-isolation=none tests
npx eslint tests
npx prettier --check README.md todo.md public/app/index.html public/app/supabase-config.js public/app/supabase-store.js tests supabase docs/superpowers
npm run build
git diff --check
git status --short --branch
```

Expected: all tests pass, lint and formatting exit 0, build exits 0, diff check is clean, and only intended files are modified. Restore generated `src/routeTree.gen.ts` worktree changes after the build.

- [ ] **Step 7: Commit verified documentation and roadmap state**

```sh
git add -- README.md todo.md tests/backend-docs.test.mjs
git commit -m "Document Supabase deployment"
```

Do not mark roadmap items complete or create this final commit if remote deployment or two-device acceptance has not passed.
