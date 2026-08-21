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
