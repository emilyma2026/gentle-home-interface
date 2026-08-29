-- 待办事项：和 family_facts 分开，因为生命周期不一样（pending/done，不需要语义检索）

do $migration$
begin
  if to_regclass('public.family_todos') is null then
    execute $ddl$
      create table public.family_todos (
        id uuid primary key default gen_random_uuid(),
        family_id uuid not null references public.families(id) on delete cascade,
        text text not null check (char_length(text) between 1 and 200),
        status text not null default 'pending' check (status in ('pending', 'active', 'done', 'rejected')),
        due_hint text not null default 'unspecified' check (due_hint in ('today', 'tomorrow', 'this_week', 'unspecified')),
        source text not null default 'manual' check (source in ('manual', 'extracted')),
        source_note text,
        created_by uuid not null references auth.users(id),
        completed_by uuid references auth.users(id),
        completed_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    $ddl$;
  end if;
end
$migration$;

create index if not exists family_todos_family_status_idx
  on public.family_todos(family_id, status);

alter table public.family_todos enable row level security;

drop policy if exists family_todos_select_family_role on public.family_todos;
create policy family_todos_select_family_role
  on public.family_todos
  for select
  to authenticated
  using (
    exists (
      select 1 from public.family_members
      where public.family_members.family_id = public.family_todos.family_id
        and public.family_members.user_id = (select auth.uid())
        and public.family_members.role = 'family'
    )
  );

drop policy if exists family_todos_select_elder_role on public.family_todos;
create policy family_todos_select_elder_role
  on public.family_todos
  for select
  to authenticated
  using (
    status = 'active'
    and exists (
      select 1 from public.family_members
      where public.family_members.family_id = public.family_todos.family_id
        and public.family_members.user_id = (select auth.uid())
        and public.family_members.role = 'elder'
    )
  );

drop policy if exists family_todos_write_family_role on public.family_todos;
create policy family_todos_write_family_role
  on public.family_todos
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.family_members
      where public.family_members.family_id = public.family_todos.family_id
        and public.family_members.user_id = (select auth.uid())
        and public.family_members.role = 'family'
    )
  );

drop policy if exists family_todos_update_family_role on public.family_todos;
create policy family_todos_update_family_role
  on public.family_todos
  for update
  to authenticated
  using (
    exists (
      select 1 from public.family_members
      where public.family_members.family_id = public.family_todos.family_id
        and public.family_members.user_id = (select auth.uid())
        and public.family_members.role = 'family'
    )
  )
  with check (
    exists (
      select 1 from public.family_members
      where public.family_members.family_id = public.family_todos.family_id
        and public.family_members.user_id = (select auth.uid())
        and public.family_members.role = 'family'
    )
  );

revoke all on table public.family_todos from public, anon;
grant select, insert, update on table public.family_todos to authenticated;
