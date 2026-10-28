-- Изолированное тестовое хранилище VSL Stats Lab.
-- Рабочие таблицы VSL не изменяются и не используются для записи статистики.

create table if not exists public.stats_lab_matches (
  id uuid primary key,
  access_key text not null,
  title text not null,
  status text not null,
  revision integer not null check (revision >= 1),
  bundle jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stats_lab_matches_access_updated_idx
  on public.stats_lab_matches (access_key, updated_at desc);

alter table public.stats_lab_matches enable row level security;
revoke all on public.stats_lab_matches from anon, authenticated;

create or replace function public.stats_lab_list_matches(p_access_key text)
returns table (id uuid, title text, status text, revision integer, created_at timestamptz, updated_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select m.id, m.title, m.status, m.revision, m.created_at, m.updated_at
  from public.stats_lab_matches m
  where m.access_key = p_access_key
  order by m.updated_at desc;
$$;

create or replace function public.stats_lab_get_match(p_access_key text, p_match_id uuid)
returns table (bundle jsonb)
language sql
security definer
set search_path = public
as $$
  select m.bundle
  from public.stats_lab_matches m
  where m.access_key = p_access_key and m.id = p_match_id;
$$;

create or replace function public.stats_lab_upsert_match(
  p_access_key text,
  p_match_id uuid,
  p_title text,
  p_status text,
  p_revision integer,
  p_bundle jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  insert into public.stats_lab_matches (id, access_key, title, status, revision, bundle)
  values (p_match_id, p_access_key, p_title, p_status, p_revision, p_bundle)
  on conflict (id) do update
    set title = excluded.title,
        status = excluded.status,
        revision = excluded.revision,
        bundle = excluded.bundle,
        updated_at = now()
  where stats_lab_matches.access_key = excluded.access_key
    and stats_lab_matches.revision <= excluded.revision;

  get diagnostics affected = row_count;
  if affected = 0 then
    raise exception 'Матч уже изменён на другом устройстве';
  end if;
end;
$$;

create or replace function public.stats_lab_delete_match(p_access_key text, p_match_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.stats_lab_matches
  where access_key = p_access_key and id = p_match_id;
$$;

revoke all on function public.stats_lab_list_matches(text) from public;
revoke all on function public.stats_lab_get_match(text, uuid) from public;
revoke all on function public.stats_lab_upsert_match(text, uuid, text, text, integer, jsonb) from public;
revoke all on function public.stats_lab_delete_match(text, uuid) from public;
grant execute on function public.stats_lab_list_matches(text) to anon, authenticated;
grant execute on function public.stats_lab_get_match(text, uuid) to anon, authenticated;
grant execute on function public.stats_lab_upsert_match(text, uuid, text, text, integer, jsonb) to anon, authenticated;
grant execute on function public.stats_lab_delete_match(text, uuid) to anon, authenticated;
