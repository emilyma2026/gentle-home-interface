-- 区分抽取来源：家人记录 vs 老人和 chatbot 聊天时说的话

do $migration$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'family_facts' and column_name = 'origin'
  ) then
    alter table public.family_facts
      add column origin text not null default 'family_note'
        check (origin in ('family_note', 'elder_chat'));
  end if;
end
$migration$;

do $migration$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'family_todos' and column_name = 'origin'
  ) then
    alter table public.family_todos
      add column origin text not null default 'family_note'
        check (origin in ('family_note', 'elder_chat'));
  end if;
end
$migration$;
