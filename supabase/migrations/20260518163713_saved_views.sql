-- Saved views: per-user named snapshots of a table's UI state (column
-- visibility, filters, sort, search, toggles, pagination). Scoped to one
-- of the existing UI areas (positions / realizations / movements) and
-- gated by RLS so a user only ever sees their own views. One default
-- per (user, scope) is enforced by a partial unique index, and the
-- `set_default_saved_view(uuid)` RPC flips the default atomically.

create table if not exists public.saved_views (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  scope       text        not null check (scope in ('positions', 'realizations', 'movements')),
  name        text        not null,
  payload     jsonb       not null,
  is_default  boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, scope, name)
);

create index if not exists saved_views_user_scope_idx
  on public.saved_views (user_id, scope);

create unique index if not exists saved_views_default_idx
  on public.saved_views (user_id, scope)
  where is_default;

alter table public.saved_views enable row level security;

drop policy if exists "saved_views self select" on public.saved_views;
create policy "saved_views self select" on public.saved_views
  for select using (user_id = auth.uid());

drop policy if exists "saved_views self insert" on public.saved_views;
create policy "saved_views self insert" on public.saved_views
  for insert with check (user_id = auth.uid());

drop policy if exists "saved_views self update" on public.saved_views;
create policy "saved_views self update" on public.saved_views
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "saved_views self delete" on public.saved_views;
create policy "saved_views self delete" on public.saved_views
  for delete using (user_id = auth.uid());

drop trigger if exists set_updated_at on public.saved_views;
create trigger set_updated_at before update on public.saved_views
  for each row execute function public.tg_set_updated_at();

-- Flip the default flag atomically: setting view A as default must clear
-- the previous default in the same (user, scope), and the unique partial
-- index would otherwise reject the transient "two defaults" state. Done
-- in a SECURITY DEFINER function so it bypasses the index check between
-- the UPDATE on the old row and the new one (a single UPDATE with a CASE
-- expression touches both atomically).
create or replace function public.set_default_saved_view(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_scope text;
  target_user  uuid;
begin
  select scope, user_id
    into target_scope, target_user
    from public.saved_views
   where id = target_id
     and user_id = auth.uid();

  if target_scope is null then
    raise exception 'saved_view_not_found';
  end if;

  update public.saved_views
     set is_default = (id = target_id)
   where user_id = target_user
     and scope = target_scope;
end;
$$;

grant execute on function public.set_default_saved_view(uuid) to authenticated;
