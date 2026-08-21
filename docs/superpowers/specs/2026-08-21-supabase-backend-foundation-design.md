# Supabase Backend Foundation Design

**Date:** 2026-08-21

**Status:** Approved in chat

**Scope:** Backend persistence and cross-device synchronization for the existing family and elder demo

## Goal

Replace the browser-only `localStorage + BroadcastChannel` store with a Supabase-backed store so that two different phones can join the same family, persist user input, and receive state changes in near real time.

The first milestone preserves the existing simulated call, fixed question-and-answer, virtual location, and return-home flows. Gemini, real speech input, TTS, GPS, maps, production accounts, and production device credentials remain outside this milestone.

## Success Criteria

1. A family device can create a family and receive a unique six-digit family code.
2. An elder device in another browser or on another phone can enter the code and join the same family.
3. Elder details, family member details, facts, pending questions, simulated call state, simulated location, and guide state persist in Supabase.
4. A change made on either device appears on the other device within two seconds under normal network conditions.
5. Reloading either page restores its Supabase session, family membership, role, and latest family state.
6. A user cannot read or change a family they have not joined.
7. An invalid or unknown family code produces the existing friendly error and reveals no family data.
8. A failed write is visible to the user and is not reported as successfully synchronized.

## Non-Goals

- Email, phone, social, or password login
- Multi-level family administration and invitations
- Production-grade revocable elder-device credentials
- Gemini audio understanding or generated answers
- Browser speech recognition or text-to-speech
- Real GPS, geofencing, route planning, or landmark lookup
- Normalizing people, facts, calls, and location events into separate production tables
- Offline-first conflict-free replication
- Medical advice, medication decisions, or open-domain conversation

## Architecture

The existing interface remains in `public/app/index.html`. A new Supabase adapter replaces the persistence and synchronization responsibilities of the current `Store` object while preserving its state shape and UI behavior.

```text
Family browser ─┐
                ├─ Supabase Anonymous Auth
Elder browser ──┘
                         │ JWT
                         ▼
              Postgres RPC + RLS policies
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
      families     family_members   family_states
                                           │
                                           ▼
                                  Supabase Realtime
                                           │
                         both browsers receive updates
```

The browser uses only the project URL and Supabase publishable key. No secret key, `service_role` key, database password, or personal access token is committed or exposed to browser code.

## Client Integration

### Supabase client

The first milestone loads the Supabase JavaScript client as a pinned browser module from a public CDN. This avoids a broad rewrite of the current static iframe application. The project URL and publishable key live in a small public configuration module because publishable keys are designed for browser use and all data access is enforced by RLS.

The integration must fail closed: if the Supabase client, configuration, or anonymous session cannot initialize, the app displays a connection error and does not silently fall back to isolated `localStorage` families.

### Store compatibility

The existing state returned by `newFamily()` remains the canonical payload for this milestone:

```text
code, lang, rev, setup, paired, elder, people, facts, pending,
timeline, call, lastCaller, thread, askCounts, loc, guide
```

The replacement store exposes the same conceptual operations:

- `create(lang)` creates the initial state in Supabase and returns a family code.
- `attach(code, role)` joins or restores a family, fetches its current state, and subscribes to changes.
- `get()` reads the in-memory copy of the latest state.
- `update(mutator)` applies an optimistic local mutation, persists it through an RPC, and reconciles the returned revision.
- `subscribe(callback)` notifies the renderer when the local state changes.
- `resetFamily()` replaces the payload with a new demo state while preserving the family, memberships, and code.
- `signOut()` removes the local role and family selection but preserves the anonymous Supabase identity unless the user explicitly clears the site data.

Local storage may cache the last selected family ID, code, and role for startup convenience. It is not the source of truth for family data.

## Authentication and Device Identity

1. On startup, the browser asks Supabase Auth for the existing session.
2. If no session exists, it calls anonymous sign-in.
3. Supabase persists the anonymous session in browser storage and supplies a JWT for database and Realtime requests.
4. The user chooses family or elder mode in the existing interface.
5. Creating or joining a family creates a membership tied to `auth.uid()`.
6. After reload, the client validates the cached family selection against `family_members` before rendering protected family data.

The family code is the pairing secret for this demo milestone. Knowing the code permits a new anonymous device to join. Rate limiting and replacement with revocable one-time device credentials remain P1 work and must be completed before real-family use.

## Data Model

### `families`

| Column       | Type          | Constraints and purpose                        |
| ------------ | ------------- | ---------------------------------------------- |
| `id`         | `uuid`        | Primary key, generated server-side             |
| `code`       | `text`        | Unique, exactly six ASCII digits               |
| `created_by` | `uuid`        | Required, equals the creator's `auth.users.id` |
| `created_at` | `timestamptz` | Required, defaults to current time             |

Clients do not list or search this table directly. Joining by code happens only through a security-definer RPC that returns the matched family ID after creating membership.

### `family_members`

| Column      | Type          | Constraints and purpose                        |
| ----------- | ------------- | ---------------------------------------------- |
| `family_id` | `uuid`        | Foreign key to `families`, cascade on delete   |
| `user_id`   | `uuid`        | Foreign key to `auth.users`, cascade on delete |
| `role`      | `text`        | Check constraint: `family` or `elder`          |
| `joined_at` | `timestamptz` | Required, defaults to current time             |

The composite primary key is `(family_id, user_id)`. A user has one role per family in this milestone.

### `family_states`

| Column       | Type          | Constraints and purpose                                      |
| ------------ | ------------- | ------------------------------------------------------------ |
| `family_id`  | `uuid`        | Primary key and foreign key to `families`, cascade on delete |
| `payload`    | `jsonb`       | Required, contains the current demo state                    |
| `revision`   | `bigint`      | Required, starts at `0`, increments on every accepted write  |
| `updated_by` | `uuid`        | Required, identifies the last anonymous device identity      |
| `updated_at` | `timestamptz` | Required, defaults to current time                           |

`payload` must be a JSON object and must contain a `code` matching the owning family. The RPC validates payload size and rejects malformed or excessively large state.

## Database Functions

### `create_family(initial_payload jsonb, requested_role text)`

- Requires an authenticated Supabase user, including an anonymous user.
- Accepts only the `family` role for this milestone.
- Generates a random six-digit code server-side and retries on the unique constraint.
- Creates the family, creator membership, and initial family state in one transaction.
- Writes the generated code into the stored payload.
- Returns `family_id`, `family_code`, `revision`, and `payload`.

### `join_family(family_code text, requested_role text)`

- Requires an authenticated Supabase user.
- Accepts exactly six digits and a role of `family` or `elder`.
- Looks up the code without exposing the `families` table to unaffiliated users.
- Inserts membership idempotently.
- Sets `payload.paired` to true when an elder joins and increments the revision.
- Returns the family ID and latest state.
- Returns a generic not-found result for invalid and unknown codes.

### `replace_family_state(family_id uuid, expected_revision bigint, next_payload jsonb)`

- Requires membership in the target family.
- Confirms that `expected_revision` equals the current revision.
- Validates required top-level fields, family code consistency, and payload size.
- Replaces the payload, increments the revision, and records `updated_by` and `updated_at` atomically.
- Returns the accepted payload and new revision.
- Returns a conflict result when revisions differ, without overwriting newer data.

All security-definer functions set a fixed `search_path`, fully qualify table names, validate `auth.uid()`, and revoke default public execution before granting execution to `authenticated`.

## Row-Level Security

RLS is enabled on all three public tables.

- `families`: a user may select a row only when a matching `family_members` row exists for `auth.uid()`; direct insert, update, and delete are denied.
- `family_members`: a user may select only their own membership rows; direct insert, update, and delete are denied.
- `family_states`: a user may select a row only when they belong to the family; direct insert, update, and delete are denied because writes go through RPC functions.

The Supabase Realtime publication includes `family_states`. Realtime delivery therefore follows the authenticated user's ability to select that family state.

## Synchronization and Conflict Handling

1. `attach()` fetches the latest row and records its server revision.
2. The client subscribes to changes for the selected `family_id` only.
3. A local action clones the latest state, applies the existing mutator, and renders optimistically.
4. The client calls `replace_family_state` with the last confirmed revision.
5. On success, it replaces the optimistic state with the accepted server payload and revision.
6. On a revision conflict, it fetches the latest state, reapplies the same mutator once, and retries once.
7. If the retry conflicts or fails, it restores the latest server state and shows a synchronization error.
8. Realtime events with a revision less than or equal to the last confirmed revision are ignored.
9. Realtime events with a newer revision replace the local state and trigger rendering.

This is optimistic concurrency, not offline-first replication. It prevents silent last-write-wins overwrites during ordinary two-device demo use without introducing a CRDT or event-sourcing system.

## Loading and Error States

The interface adds a small connection-status layer shared by both roles:

- `connecting`: Supabase client or anonymous session is initializing.
- `loading`: family membership and state are being restored.
- `synced`: the latest write has been acknowledged by the server.
- `saving`: an optimistic local change is waiting for acknowledgement.
- `offline`: the browser has lost network connectivity or Realtime has disconnected.
- `error`: initialization, join, read, or write failed and needs a retry.

The app disables family creation, joining, and protected mutations while authentication is unavailable. A failed save must not display a success confirmation. Existing user-entered form values remain visible while a retry is possible.

## File Responsibilities

Planned repository changes:

- `supabase/migrations/20260821_backend_foundation.sql`: tables, constraints, indexes, RPC functions, grants, RLS policies, and Realtime publication setup.
- `public/app/supabase-config.js`: project URL and publishable key only.
- `public/app/supabase-store.js`: anonymous authentication, RPC calls, in-memory cache, optimistic updates, Realtime subscription, conflict handling, and connection status.
- `public/app/index.html`: load the Supabase modules, replace the current local store wiring, and render connection/error feedback without changing unrelated UI.
- `tests/supabase-store.test.mjs`: adapter behavior with a fake Supabase client, including startup, create, join, update, Realtime, conflict, and failure paths.
- `tests/entry-homepage.test.mjs`: retain the existing UI regressions and add assertions that the backend modules are loaded.
- `.env.example` or deployment documentation: document the project URL and publishable-key names if the configuration is moved to build-time injection later.
- `README.md`: Supabase setup, anonymous-auth setting, migration application, local verification, Cloudflare variables, and two-device smoke test.

The implementation must not add a second independent family-state model. The existing `newFamily()` payload remains the single application state shape until a later normalization milestone.

## Test Strategy

### Automated client tests

Use dependency injection so `supabase-store.js` can be tested with a fake client. Tests cover:

- Existing anonymous session and new anonymous sign-in
- Successful family creation and code return
- Valid and invalid family joining
- Membership validation during session restoration
- Initial state fetch and subscription setup
- Optimistic update followed by acknowledgement
- Newer Realtime revision replacing local state
- Stale Realtime revision being ignored
- Conflict fetch, one retry, and successful reconciliation
- Repeated conflict restoring server state and reporting an error
- Network failure preserving visible local input while showing unsynced status
- Unsubscribe and family switch cleanup

### Database verification

Run the migration against the selected Supabase project, then verify with two anonymous sessions:

- Creator can create and read its family.
- A non-member cannot select the family or state.
- Join by valid code creates membership and returns state.
- Invalid code returns no family data.
- Joined family and elder sessions both receive state changes.
- A user from another family cannot read or update the first family.
- A stale revision cannot overwrite a newer revision.

### Manual two-device acceptance test

1. Open the deployed app on phone A and create a family.
2. Enter elder and family-member details and note the six-digit code.
3. Open the deployed app on phone B using a separate browser profile.
4. Choose elder mode and join with the code.
5. Edit a person field on phone A and confirm phone B updates within two seconds.
6. Trigger a simulated call, answer, confirm a fact, and ask the matching fixed question across the two devices.
7. Reload both phones and confirm role, membership, and latest state restore.
8. Enter an invalid code on a third session and confirm no family data is exposed.

## Deployment and Operator Steps

The repository can contain all schema and client code, but the project owner must complete these Supabase dashboard operations:

1. Enable anonymous sign-ins for the project.
2. Execute the committed migration in the Supabase SQL Editor or apply it through an authenticated Supabase CLI session.
3. Confirm `family_states` is included in Realtime replication.
4. Keep the provided publishable key in browser configuration only.
5. Never place a secret key, `service_role` key, database password, or personal access token in Git, frontend code, chat, or Cloudflare public variables.

For deployment, the existing Cloudflare build must run before Wrangler deploy so the generated Nitro/Wrangler configuration exists. Backend acceptance is not complete until the app is reachable from two separate devices over HTTPS.

## Rollout

1. Apply and verify the database migration.
2. Add the Supabase adapter behind the current Store interface.
3. Run automated tests while the local adapter remains available only in tests.
4. Switch the application runtime to Supabase with no silent browser-only fallback.
5. Run the two-device acceptance test.
6. Update `todo.md`: mark P0-01 through P0-04 complete only when their full acceptance criteria are met.

## Risks and Mitigations

- **Family code guessing:** acceptable only for the demo milestone; generic errors, server-side generation, and membership RLS limit exposure. Add rate limiting and one-time device credentials before real-family use.
- **Anonymous-session loss:** clearing browser data creates a new identity. The UI must explain this limitation; account recovery is outside this milestone.
- **Whole-state contention:** optimistic revision checks prevent silent overwrites, but repeated simultaneous edits can fail. Normalize high-contention entities in a later milestone.
- **Sensitive demo data:** use fictional data during development and demonstrations. Do not enter real health, location, or family information until privacy and production-security work is complete.
- **Realtime interruption:** subscription errors switch the UI to offline/error state and trigger a fresh state read after reconnection.
- **CDN dependency:** pin the browser client version and display initialization failure clearly. Moving the static app into the bundled application is a later maintainability task.
