-- 老人记忆系统：家庭事实表 + 语义检索
-- 依赖 202608210001_backend_foundation.sql 里的 families / family_members

create extension if not exists vector;

do $migration$
begin
  if to_regclass('public.family_facts') is null then
    execute $ddl$
      create table public.family_facts (
        id uuid primary key default gen_random_uuid(),
        family_id uuid not null references public.families(id) on delete cascade,
        category text not null check (category in ('person', 'preference', 'routine', 'event', 'other')),
        text text not null check (char_length(text) between 1 and 500),
        status text not null default 'pending' check (status in ('pending', 'active', 'stale', 'rejected')),
        confidence numeric not null default 1.0 check (confidence >= 0 and confidence <= 1),
        is_core boolean not null default false,
        source text not null default 'manual' check (source in ('manual', 'extracted')),
        source_note text,
        expires_at timestamptz,
        created_by uuid not null references auth.users(id),
        reviewed_by uuid references auth.users(id),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    $ddl$;
  end if;
end
$migration$;

do $migration$
begin
  if to_regclass('public.family_fact_embeddings') is null then
    execute $ddl$
      create table public.family_fact_embeddings (
        fact_id uuid primary key references public.family_facts(id) on delete cascade,
        family_id uuid not null references public.families(id) on delete cascade,
        text_hash text not null,
        embedding vector(1536) not null,
        created_at timestamptz not null default now()
      )
    $ddl$;
  end if;
end
$migration$;

create index if not exists family_facts_family_id_idx
  on public.family_facts(family_id);
create index if not exists family_facts_family_status_idx
  on public.family_facts(family_id, status);

create index if not exists family_fact_embeddings_family_id_idx
  on public.family_fact_embeddings(family_id);

do $migration$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'family_fact_embeddings_vector_idx'
  ) then
    execute 'create index family_fact_embeddings_vector_idx '
      || 'on public.family_fact_embeddings using hnsw (embedding vector_cosine_ops)';
  end if;
end
$migration$;

alter table public.family_facts enable row level security;
alter table public.family_fact_embeddings enable row level security;

-- family 角色：看得到本家庭全部状态的事实（待确认/已生效/已过期/已拒绝）
drop policy if exists family_facts_select_family_role on public.family_facts;
create policy family_facts_select_family_role
  on public.family_facts
  for select
  to authenticated
  using (
    exists (
      select 1 from public.family_members
      where public.family_members.family_id = public.family_facts.family_id
        and public.family_members.user_id = (select auth.uid())
        and public.family_members.role = 'family'
    )
  );

-- elder 角色：只看得到已生效的事实（问答检索用）
drop policy if exists family_facts_select_elder_role on public.family_facts;
create policy family_facts_select_elder_role
  on public.family_facts
  for select
  to authenticated
  using (
    status = 'active'
    and exists (
      select 1 from public.family_members
      where public.family_members.family_id = public.family_facts.family_id
        and public.family_members.user_id = (select auth.uid())
        and public.family_members.role = 'elder'
    )
  );

-- 只有 family 角色能新增/编辑事实（手动录入或确认/编辑/拒绝抽取结果）
drop policy if exists family_facts_write_family_role on public.family_facts;
create policy family_facts_write_family_role
  on public.family_facts
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.family_members
      where public.family_members.family_id = public.family_facts.family_id
        and public.family_members.user_id = (select auth.uid())
        and public.family_members.role = 'family'
    )
  );

drop policy if exists family_facts_update_family_role on public.family_facts;
create policy family_facts_update_family_role
  on public.family_facts
  for update
  to authenticated
  using (
    exists (
      select 1 from public.family_members
      where public.family_members.family_id = public.family_facts.family_id
        and public.family_members.user_id = (select auth.uid())
        and public.family_members.role = 'family'
    )
  )
  with check (
    exists (
      select 1 from public.family_members
      where public.family_members.family_id = public.family_facts.family_id
        and public.family_members.user_id = (select auth.uid())
        and public.family_members.role = 'family'
    )
  );

revoke all on table public.family_facts from public, anon;
grant select, insert, update on table public.family_facts to authenticated;

-- embedding 表不直接开放给客户端，只通过下面的 security definer 函数读写
revoke all on table public.family_fact_embeddings from public, anon, authenticated;

create or replace function public.upsert_family_fact_embedding(
  target_fact_id uuid,
  fact_text_hash text,
  fact_embedding vector(1536)
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_family_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  select family_id into v_family_id
  from public.family_facts
  where id = target_fact_id;

  if v_family_id is null then
    raise exception 'FACT_NOT_FOUND' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.family_members
    where public.family_members.family_id = v_family_id
      and public.family_members.user_id = v_user_id
      and public.family_members.role = 'family'
  ) then
    raise exception 'FAMILY_MEMBERSHIP_REQUIRED' using errcode = '42501';
  end if;

  insert into public.family_fact_embeddings (fact_id, family_id, text_hash, embedding)
  values (target_fact_id, v_family_id, fact_text_hash, fact_embedding)
  on conflict (fact_id) do update
    set text_hash = excluded.text_hash,
        embedding = excluded.embedding,
        created_at = now()
    where public.family_fact_embeddings.text_hash is distinct from excluded.text_hash;
end
$function$;

create or replace function public.match_family_facts(
  target_family_id uuid,
  query_embedding vector(1536),
  match_count int default 8,
  match_threshold float default 0.65
)
returns table (
  id uuid,
  text text,
  category text,
  confidence numeric,
  is_core boolean,
  similarity float
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  select public.family_members.role into v_role
  from public.family_members
  where public.family_members.family_id = target_family_id
    and public.family_members.user_id = v_user_id;

  if v_role is null then
    raise exception 'FAMILY_MEMBERSHIP_REQUIRED' using errcode = '42501';
  end if;

  return query
    -- 核心事实：不受相似度阈值影响，始终返回（比如老人姓名、子女名字）
    select f.id, f.text, f.category, f.confidence, f.is_core, 1.0::float as similarity
    from public.family_facts f
    where f.family_id = target_family_id
      and f.status = 'active'
      and f.is_core = true
      and (f.expires_at is null or f.expires_at > now())
    union all
    select f.id, f.text, f.category, f.confidence, f.is_core,
      (1 - (e.embedding OPERATOR(public.<=>) query_embedding))::float as similarity
    from public.family_fact_embeddings e
    join public.family_facts f on f.id = e.fact_id
    where e.family_id = target_family_id
      and f.status = 'active'
      and f.is_core = false
      and (f.expires_at is null or f.expires_at > now())
      and (1 - (e.embedding OPERATOR(public.<=>) query_embedding)) >= match_threshold
    order by similarity desc
    limit match_count;
end
$function$;

revoke all on function public.upsert_family_fact_embedding(uuid, text, vector) from public, anon;
revoke all on function public.match_family_facts(uuid, vector, int, float) from public, anon;

grant execute on function public.upsert_family_fact_embedding(uuid, text, vector) to authenticated;
grant execute on function public.match_family_facts(uuid, vector, int, float) to authenticated;
