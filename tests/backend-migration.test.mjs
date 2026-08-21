import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sql = readFileSync(
  new URL("../supabase/migrations/202608210001_backend_foundation.sql", import.meta.url),
  "utf8",
);

const payloadKeys = [
  "code",
  "lang",
  "rev",
  "setup",
  "paired",
  "elder",
  "people",
  "facts",
  "pending",
  "timeline",
  "call",
  "lastCaller",
  "thread",
  "askCounts",
  "loc",
  "guide",
];

function block(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  assert.notEqual(start, -1, `missing start token: ${startToken}`);
  const end = source.indexOf(endToken, start);
  assert.notEqual(end, -1, `missing end token after: ${startToken}`);
  return source.slice(start, end + endToken.length);
}

function rpc(source, name) {
  return block(source, `create or replace function public.${name}(`, "\n$function$;");
}

function publicationBlock(source) {
  const alteration = source.indexOf("alter publication supabase_realtime");
  assert.notEqual(alteration, -1, "missing Realtime publication alteration");
  const start = source.lastIndexOf("do $migration$", alteration);
  assert.notEqual(start, -1, "publication alteration is not guarded by a migration block");
  const endToken = "\n$migration$;";
  const end = source.indexOf(endToken, alteration);
  assert.notEqual(end, -1, "publication migration block is not terminated");
  return source.slice(start, end + endToken.length);
}

function assertPayloadValidation(definition, parameter) {
  assert.match(definition, new RegExp(`${parameter} is null`, "i"));
  assert.match(definition, new RegExp(`jsonb_typeof\\(${parameter}\\) <> 'object'`, "i"));
  assert.match(definition, new RegExp(`octet_length\\(${parameter}::text\\) > 1048576`, "i"));

  const requiredKeys = block(definition, `${parameter} ?& array[`, "]::text[]");
  for (const key of payloadKeys) {
    assert.match(requiredKeys, new RegExp(`'${key}'`));
  }
}

function assertRpcSecurity(definition) {
  assert.match(
    definition,
    /language plpgsql\s+security definer\s+set search_path = ''\s+as \$function\$/i,
  );
  assert.match(definition, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(
    definition,
    /if v_user_id is null then\s+raise exception 'AUTHENTICATION_REQUIRED'/i,
  );
}

function assertMigrationContract(source) {
  const families = block(source, "create table public.families (", "\n      )\n    $ddl$;");
  assert.match(families, /code text not null unique check \(code ~ '\^\[0-9\]\{6\}\$'\)/i);
  assert.match(
    families,
    /created_by uuid not null references auth\.users\(id\) on delete cascade/i,
  );

  const members = block(source, "create table public.family_members (", "\n      )\n    $ddl$;");
  assert.match(members, /role text not null check \(role in \('family', 'elder'\)\)/i);
  assert.match(members, /primary key \(family_id, user_id\)/i);

  const states = block(source, "create table public.family_states (", "\n      )\n    $ddl$;");
  assert.match(states, /payload jsonb not null check \(jsonb_typeof\(payload\) = 'object'\)/i);
  assert.match(states, /revision bigint not null default 0 check \(revision >= 0\)/i);
  assert.match(states, /check \(octet_length\(payload::text\) <= 1048576\)/i);

  for (const table of ["families", "family_members", "family_states"]) {
    assert.match(
      source,
      new RegExp(`alter table public\\.${table} enable row level security`, "i"),
    );
  }

  const familiesPolicy = block(
    source,
    "create policy families_select_members",
    "drop policy if exists family_members_select_self",
  );
  assert.match(familiesPolicy, /from public\.family_members/i);
  assert.match(
    familiesPolicy,
    /family_members\.family_id = public\.families\.id[\s\S]*family_members\.user_id = \(select auth\.uid\(\)\)/i,
  );

  const membersPolicy = block(
    source,
    "create policy family_members_select_self",
    "drop policy if exists family_states_select_members",
  );
  assert.match(membersPolicy, /using \(user_id = \(select auth\.uid\(\)\)\)/i);

  const statesPolicy = block(
    source,
    "create policy family_states_select_members",
    "revoke all on table public.families",
  );
  assert.match(statesPolicy, /from public\.family_members/i);
  assert.match(
    statesPolicy,
    /family_members\.family_id = public\.family_states\.family_id[\s\S]*family_members\.user_id = \(select auth\.uid\(\)\)/i,
  );

  assert.match(
    source,
    /revoke insert, update, delete, truncate, references, trigger\s+on table public\.families, public\.family_members, public\.family_states\s+from authenticated;/i,
  );
  assert.match(
    source,
    /grant select on table public\.families, public\.family_members, public\.family_states\s+to authenticated;/i,
  );

  const createFamily = rpc(source, "create_family");
  assert.match(
    createFamily,
    /^create or replace function public\.create_family\(\s*initial_payload jsonb,\s*requested_role text\s*\)/i,
  );
  assertRpcSecurity(createFamily);
  assertPayloadValidation(createFamily, "initial_payload");
  assert.match(createFamily, /requested_role is distinct from 'family'/i);
  assert.match(createFamily, /for v_attempt in 1\.\.100 loop/i);
  assert.match(
    createFamily,
    /lpad\([\s\S]*floor\([\s\S]*random\(\) \* 1000000[\s\S]*6,[\s\S]*'0'/i,
  );
  assert.match(createFamily, /insert into public\.families \(code, created_by\)/i);
  assert.match(createFamily, /insert into public\.family_members \(family_id, user_id, role\)/i);
  assert.match(
    createFamily,
    /insert into public\.family_states \(family_id, payload, revision, updated_by\)/i,
  );
  assert.match(
    createFamily,
    /jsonb_set\(initial_payload, '\{code\}', pg_catalog\.to_jsonb\(v_family_code\), true\)/i,
  );

  const joinFamily = rpc(source, "join_family");
  assert.match(
    joinFamily,
    /^create or replace function public\.join_family\(\s*family_code text,\s*requested_role text\s*\)/i,
  );
  assertRpcSecurity(joinFamily);
  assert.match(joinFamily, /requested_role not in \('family', 'elder'\)/i);
  assert.match(joinFamily, /family_code !~ '\^\[0-9\]\{6\}\$'/i);
  assert.match(
    joinFamily,
    /from public\.families as families\s+where families\.code = family_code/i,
  );
  assert.match(
    joinFamily,
    /insert into public\.family_members \(family_id, user_id, role\)[\s\S]*values \(v_family_id, v_user_id, requested_role\)[\s\S]*on conflict \(family_id, user_id\) do nothing/i,
  );
  assert.match(
    joinFamily,
    /if requested_role = 'elder' and v_membership_inserted = 1 then[\s\S]*update public\.family_states[\s\S]*'\{paired\}', 'true'::jsonb[\s\S]*revision = revision \+ 1[\s\S]*where public\.family_states\.family_id = v_family_id/i,
  );

  const replaceState = rpc(source, "replace_family_state");
  assert.match(
    replaceState,
    /^create or replace function public\.replace_family_state\(\s*target_family_id uuid,\s*expected_revision bigint,\s*next_payload jsonb\s*\)/i,
  );
  assertRpcSecurity(replaceState);
  assert.match(
    replaceState,
    /if not exists \(\s*select 1\s*from public\.family_members\s*where public\.family_members\.family_id = target_family_id\s+and public\.family_members\.user_id = v_user_id\s*\) then/i,
  );
  assert.match(
    replaceState,
    /from public\.families as families\s+where families\.id = target_family_id/i,
  );
  assertPayloadValidation(replaceState, "next_payload");
  assert.match(replaceState, /next_payload ->> 'code' is distinct from v_family_code/i);

  const atomicUpdate = block(
    replaceState,
    "update public.family_states",
    "into v_revision, v_payload;",
  );
  assert.match(atomicUpdate, /set payload = v_payload/i);
  assert.match(atomicUpdate, /revision = revision \+ 1/i);
  assert.match(atomicUpdate, /updated_by = v_user_id/i);
  assert.match(
    atomicUpdate,
    /where public\.family_states\.family_id = target_family_id\s+and revision = expected_revision/i,
  );
  assert.match(
    atomicUpdate,
    /returning public\.family_states\.revision, public\.family_states\.payload/i,
  );
  assert.match(replaceState, /if not found then\s+raise exception 'REVISION_CONFLICT'/i);

  const overloads = [
    ["create_family", "jsonb, text"],
    ["join_family", "text, text"],
    ["replace_family_state", "uuid, bigint, jsonb"],
  ];
  for (const [name, parameters] of overloads) {
    const signature = `public\\.${name}\\(${parameters}\\)`;
    assert.match(source, new RegExp(`revoke all on function ${signature} from public, anon;`, "i"));
    assert.match(
      source,
      new RegExp(`grant execute on function ${signature} to authenticated;`, "i"),
    );
    assert.doesNotMatch(
      source,
      new RegExp(`grant execute on function ${signature} to (?:public|anon);`, "i"),
    );
  }

  const realtime = publicationBlock(source);
  assert.match(
    realtime,
    /if not exists \(\s*select 1\s*from pg_catalog\.pg_publication_tables\s*where pubname = 'supabase_realtime'\s+and schemaname = 'public'\s+and tablename = 'family_states'\s*\) then\s*alter publication supabase_realtime add table public\.family_states;/i,
  );
}

function replaceInRpc(source, name, search, replacement) {
  const definition = rpc(source, name);
  const weakened = definition.replace(search, replacement);
  assert.notEqual(weakened, definition, `mutation did not match ${name}`);
  return source.replace(definition, weakened);
}

test("migration defines the scoped backend schema and security contract", () => {
  assertMigrationContract(sql);
});

test("contract rejects weakened RPC and publication security", () => {
  const publication = publicationBlock(sql);
  const weakenedPublication = publication.replace("if not exists (", "if exists (");
  assert.notEqual(weakenedPublication, publication);

  const mutations = [
    [
      "create_family must remain SECURITY DEFINER",
      replaceInRpc(sql, "create_family", "security definer", "security invoker"),
    ],
    [
      "join_family must use auth.uid()",
      replaceInRpc(sql, "join_family", "auth.uid()", "null::uuid"),
    ],
    [
      "replace_family_state must isolate writes by membership",
      replaceInRpc(
        sql,
        "replace_family_state",
        "and public.family_members.user_id = v_user_id",
        "and true",
      ),
    ],
    [
      "replace_family_state must match the expected revision",
      replaceInRpc(sql, "replace_family_state", "and revision = expected_revision", "and true"),
    ],
    [
      "replace_family_state must enforce the payload size",
      replaceInRpc(sql, "replace_family_state", "> 1048576", "> 2048576"),
    ],
    [
      "join_family execution must be authenticated-only",
      sql.replace(
        "grant execute on function public.join_family(text, text) to authenticated;",
        "grant execute on function public.join_family(text, text) to anon;",
      ),
    ],
    [
      "Realtime publication setup must be idempotent",
      sql.replace(publication, weakenedPublication),
    ],
  ];

  for (const [label, mutation] of mutations) {
    assert.throws(() => assertMigrationContract(mutation), assert.AssertionError, label);
  }
});
