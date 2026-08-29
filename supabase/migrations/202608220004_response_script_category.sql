-- 应答脚本（老人重复提问时家人的固定回应）本质是稳定事实，不是一次性待办，
-- 归到 family_facts 的新分类里，复用抽取/确认/向量检索管线。

alter table public.family_facts
  drop constraint if exists family_facts_category_check;

alter table public.family_facts
  add constraint family_facts_category_check
  check (category in ('person', 'preference', 'routine', 'event', 'response_script', 'other'));
