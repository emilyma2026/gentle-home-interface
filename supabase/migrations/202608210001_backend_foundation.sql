do $migration$
begin
  if to_regclass('public.families') is null then
    execute $ddl$
      create table public.families (
        id uuid primary key default gen_random_uuid(),
        code text not null unique check (code ~ '^[0-9]{6}$'),
        created_by uuid not null references auth.users(id) on delete cascade,
        created_at timestamptz not null default now()
      )
    $ddl$;
  end if;
end
$migration$;

do $migration$
begin
  if to_regclass('public.family_members') is null then
    execute $ddl$
      create table public.family_members (
        family_id uuid not null references public.families(id) on delete cascade,
        user_id uuid not null references auth.users(id) on delete cascade,
        role text not null check (role in ('family', 'elder')),
        joined_at timestamptz not null default now(),
        primary key (family_id, user_id)
      )
    $ddl$;
  end if;
end
$migration$;

do $migration$
begin
  if to_regclass('public.family_states') is null then
    execute $ddl$
      create table public.family_states (
        family_id uuid primary key references public.families(id) on delete cascade,
        payload jsonb not null check (jsonb_typeof(payload) = 'object'),
        revision bigint not null default 0 check (revision >= 0),
        updated_by uuid not null references auth.users(id),
        updated_at timestamptz not null default now(),
        check (octet_length(payload::text) <= 1048576)
      )
    $ddl$;
  end if;
end
$migration$;

create index if not exists family_members_user_id_idx
  on public.family_members(user_id);

alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.family_states enable row level security;

drop policy if exists families_select_members on public.families;
create policy families_select_members
  on public.families
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.family_members
      where public.family_members.family_id = public.families.id
        and public.family_members.user_id = (select auth.uid())
    )
  );

drop policy if exists family_members_select_self on public.family_members;
create policy family_members_select_self
  on public.family_members
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists family_states_select_members on public.family_states;
create policy family_states_select_members
  on public.family_states
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.family_members
      where public.family_members.family_id = public.family_states.family_id
        and public.family_members.user_id = (select auth.uid())
    )
  );

revoke all on table public.families from public, anon;
revoke all on table public.family_members from public, anon;
revoke all on table public.family_states from public, anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.families, public.family_members, public.family_states
  from authenticated;
grant select on table public.families, public.family_members, public.family_states
  to authenticated;

do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_type as type
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = type.typnamespace
    where namespace.nspname = 'public'
      and type.typname = 'family_rpc_result'
  ) then
    create type public.family_rpc_result as (
      family_id uuid,
      family_code text,
      revision bigint,
      payload jsonb
    );
  end if;
end
$migration$;

create or replace function public.create_family(
  initial_payload jsonb,
  requested_role text
)
returns setof public.family_rpc_result
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_family_id uuid;
  v_family_code text;
  v_payload jsonb;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  if requested_role is distinct from 'family' then
    raise exception 'INVALID_FAMILY_ROLE' using errcode = '22023';
  end if;

  if initial_payload is null
    or pg_catalog.jsonb_typeof(initial_payload) <> 'object'
    or not initial_payload ?& array[
      'code', 'lang', 'rev', 'setup', 'paired', 'elder', 'people', 'facts',
      'pending', 'timeline', 'call', 'lastCaller', 'thread', 'askCounts',
      'loc', 'guide'
    ]::text[]
    or pg_catalog.octet_length(initial_payload::text) > 1048576
  then
    raise exception 'INVALID_FAMILY_STATE' using errcode = '22023';
  end if;

  for v_attempt in 1..100 loop
    v_family_code := pg_catalog.lpad(
      pg_catalog.floor(pg_catalog.random() * 1000000)::bigint::text,
      6,
      '0'
    );

    begin
      insert into public.families (code, created_by)
      values (v_family_code, v_user_id)
      returning id into v_family_id;
      exit;
    exception
      when unique_violation then
        v_family_id := null;
    end;
  end loop;

  if v_family_id is null then
    raise exception 'FAMILY_CODE_UNAVAILABLE' using errcode = '23505';
  end if;

  v_payload := pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(initial_payload, '{code}', pg_catalog.to_jsonb(v_family_code), true),
    '{rev}',
    '0'::jsonb,
    true
  );

  if pg_catalog.octet_length(v_payload::text) > 1048576 then
    raise exception 'FAMILY_STATE_TOO_LARGE' using errcode = '22023';
  end if;

  insert into public.family_members (family_id, user_id, role)
  values (v_family_id, v_user_id, 'family');

  insert into public.family_states (family_id, payload, revision, updated_by)
  values (v_family_id, v_payload, 0, v_user_id);

  return next row(v_family_id, v_family_code, 0::bigint, v_payload)
    ::public.family_rpc_result;
  return;
end
$function$;

create or replace function public.join_family(
  family_code text,
  requested_role text
)
returns setof public.family_rpc_result
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_family_id uuid;
  v_membership_inserted integer := 0;
  v_revision bigint;
  v_payload jsonb;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  if requested_role is null or requested_role not in ('family', 'elder') then
    raise exception 'INVALID_FAMILY_ROLE' using errcode = '22023';
  end if;

  if family_code is null or family_code !~ '^[0-9]{6}$' then
    return;
  end if;

  select families.id
  into v_family_id
  from public.families as families
  where families.code = family_code;

  if v_family_id is null then
    return;
  end if;

  insert into public.family_members (family_id, user_id, role)
  values (v_family_id, v_user_id, requested_role)
  on conflict (family_id, user_id) do nothing;

  get diagnostics v_membership_inserted = row_count;

  if requested_role = 'elder' and v_membership_inserted = 1 then
    update public.family_states
    set payload = pg_catalog.jsonb_set(
          pg_catalog.jsonb_set(payload, '{paired}', 'true'::jsonb, true),
          '{rev}',
          pg_catalog.to_jsonb(revision + 1),
          true
        ),
        revision = revision + 1,
        updated_by = v_user_id,
        updated_at = pg_catalog.now()
    where public.family_states.family_id = v_family_id
    returning public.family_states.revision, public.family_states.payload
      into v_revision, v_payload;
  else
    select family_states.revision, family_states.payload
    into v_revision, v_payload
    from public.family_states as family_states
    where family_states.family_id = v_family_id;
  end if;

  return next row(v_family_id, family_code, v_revision, v_payload)
    ::public.family_rpc_result;
  return;
end
$function$;

create or replace function public.replace_family_state(
  target_family_id uuid,
  expected_revision bigint,
  next_payload jsonb
)
returns setof public.family_rpc_result
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_family_code text;
  v_revision bigint;
  v_payload jsonb;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.family_members
    where public.family_members.family_id = target_family_id
      and public.family_members.user_id = v_user_id
  ) then
    raise exception 'FAMILY_MEMBERSHIP_REQUIRED' using errcode = '42501';
  end if;

  select families.code
  into v_family_code
  from public.families as families
  where families.id = target_family_id;

  if next_payload is null
    or pg_catalog.jsonb_typeof(next_payload) <> 'object'
    or not next_payload ?& array[
      'code', 'lang', 'rev', 'setup', 'paired', 'elder', 'people', 'facts',
      'pending', 'timeline', 'call', 'lastCaller', 'thread', 'askCounts',
      'loc', 'guide'
    ]::text[]
    or next_payload ->> 'code' is distinct from v_family_code
    or pg_catalog.octet_length(next_payload::text) > 1048576
  then
    raise exception 'INVALID_FAMILY_STATE' using errcode = '22023';
  end if;

  v_payload := pg_catalog.jsonb_set(
    next_payload,
    '{rev}',
    pg_catalog.to_jsonb(expected_revision + 1),
    true
  );

  update public.family_states
  set payload = v_payload,
      revision = revision + 1,
      updated_by = v_user_id,
      updated_at = pg_catalog.now()
  where public.family_states.family_id = target_family_id
    and revision = expected_revision
  returning public.family_states.revision, public.family_states.payload
    into v_revision, v_payload;

  if not found then
    raise exception 'REVISION_CONFLICT' using errcode = '40001';
  end if;

  return next row(target_family_id, v_family_code, v_revision, v_payload)
    ::public.family_rpc_result;
  return;
end
$function$;

revoke all on function public.create_family(jsonb, text) from public, anon;
revoke all on function public.join_family(text, text) from public, anon;
revoke all on function public.replace_family_state(uuid, bigint, jsonb) from public, anon;

grant execute on function public.create_family(jsonb, text) to authenticated;
grant execute on function public.join_family(text, text) to authenticated;
grant execute on function public.replace_family_state(uuid, bigint, jsonb) to authenticated;

do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'family_states'
  ) then
    alter publication supabase_realtime add table public.family_states;
  end if;
end
$migration$;
