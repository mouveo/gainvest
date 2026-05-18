-- Multi-user memberships + invitations + per-user preferences.
--
-- Until now, every row had a `user_id` column and RLS policies that simply
-- compared `auth.uid() = user_id`. That model assumes a single owner per
-- account and cannot express sharing. This migration:
--   * introduces `account_memberships` as the source of truth for who can
--     access an account and with what role (owner / editor / viewer),
--   * introduces `pending_memberships` for invitations that survive until
--     the invitee actually signs up,
--   * introduces `user_preferences` for per-user UI state (column visibility,
--     sort order, etc.) scoped to a feature area,
--   * demotes `accounts.user_id` / `transactions.user_id` to an audit-only
--     `created_by` field (nullable, ON DELETE SET NULL) — permissions live
--     in `account_memberships` from now on,
--   * rewires RLS via SECURITY DEFINER helpers (`is_account_member`,
--     `account_role`, `is_account_owner`, `can_write_account`) to avoid
--     self-referential policy recursion on `account_memberships`,
--   * exposes `consume_pending_memberships(uuid, text)` as the single
--     entry point used by the auth callback to redeem invitations.
--
-- Single-user mode is preserved: every existing account is backfilled with
-- an owner membership for its current `user_id`, and the
-- `accounts_after_insert_create_owner` trigger keeps that invariant for
-- any new account inserted with a non-null `user_id`.

-- =========================================================================
-- 1. account_memberships
-- =========================================================================
create table if not exists public.account_memberships (
  account_id uuid        not null references public.accounts (id) on delete cascade,
  user_id    uuid        not null references auth.users (id)      on delete cascade,
  role       text        not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, user_id)
);

create index if not exists account_memberships_user_idx
  on public.account_memberships (user_id);

alter table public.account_memberships enable row level security;

drop trigger if exists set_updated_at on public.account_memberships;
create trigger set_updated_at before update on public.account_memberships
  for each row execute function public.tg_set_updated_at();

-- =========================================================================
-- 2. pending_memberships
-- =========================================================================
create table if not exists public.pending_memberships (
  id          uuid        primary key default gen_random_uuid(),
  email       text        not null,
  account_id  uuid        not null references public.accounts (id) on delete cascade,
  role        text        not null check (role in ('owner', 'editor', 'viewer')),
  invited_by  uuid        not null references auth.users (id)      on delete cascade,
  invited_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '30 days'),
  consumed_at timestamptz
);

create index if not exists pending_memberships_email_idx
  on public.pending_memberships (lower(email))
  where consumed_at is null;

create index if not exists pending_memberships_account_idx
  on public.pending_memberships (account_id);

create unique index if not exists pending_memberships_open_unique_idx
  on public.pending_memberships (lower(email), account_id)
  where consumed_at is null;

alter table public.pending_memberships enable row level security;

-- =========================================================================
-- 3. user_preferences
-- =========================================================================
create table if not exists public.user_preferences (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  scope      text        not null check (scope in ('positions', 'realizations', 'movements', 'global')),
  payload    jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, scope)
);

alter table public.user_preferences enable row level security;

drop trigger if exists set_updated_at on public.user_preferences;
create trigger set_updated_at before update on public.user_preferences
  for each row execute function public.tg_set_updated_at();

-- =========================================================================
-- 4. Backfill memberships from existing accounts (before we relax user_id).
-- =========================================================================
insert into public.account_memberships (account_id, user_id, role)
select id, user_id, 'owner'
from public.accounts
where user_id is not null
on conflict do nothing;

-- =========================================================================
-- 5. accounts.user_id becomes audit-only (legacy "created_by"). The same
--    treatment is applied to transactions.user_id since it must not gate
--    permissions on a shared account.
-- =========================================================================
alter table public.accounts
  drop constraint if exists accounts_user_id_fkey;

alter table public.accounts
  alter column user_id drop not null;

alter table public.accounts
  add constraint accounts_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;

comment on column public.accounts.user_id is
  'Legacy audit column — the historical creator of the row. Do NOT use for permission checks. Access control lives in account_memberships.';

alter table public.transactions
  drop constraint if exists transactions_user_id_fkey;

alter table public.transactions
  alter column user_id drop not null;

alter table public.transactions
  add constraint transactions_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;

comment on column public.transactions.user_id is
  'Legacy audit column — the historical creator of the row. Do NOT use for permission checks. Access control lives in account_memberships via account_id.';

-- =========================================================================
-- 6. SECURITY DEFINER helpers — avoid self-referential RLS recursion when
--    policies on account_memberships need to read account_memberships.
-- =========================================================================
create or replace function public.is_account_member(target_account uuid, target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.account_memberships
    where account_id = target_account
      and user_id = target_user
  );
$$;

create or replace function public.account_role(target_account uuid, target_user uuid)
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select role
  from public.account_memberships
  where account_id = target_account
    and user_id = target_user
  limit 1;
$$;

create or replace function public.is_account_owner(target_account uuid, target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.account_role(target_account, target_user) = 'owner';
$$;

create or replace function public.can_write_account(target_account uuid, target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.account_role(target_account, target_user) in ('owner', 'editor');
$$;

grant execute on function public.is_account_member(uuid, uuid)  to authenticated;
grant execute on function public.account_role(uuid, uuid)        to authenticated;
grant execute on function public.is_account_owner(uuid, uuid)    to authenticated;
grant execute on function public.can_write_account(uuid, uuid)   to authenticated;

-- =========================================================================
-- 7. RPC to redeem invitations, called from the auth callback after sign-in.
-- =========================================================================
create or replace function public.consume_pending_memberships(invitee uuid, invitee_email text)
returns table(account_id uuid)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  pending_row public.pending_memberships%rowtype;
  normalized_email text := lower(invitee_email);
begin
  for pending_row in
    select *
    from public.pending_memberships
    where lower(email) = normalized_email
      and consumed_at is null
      and expires_at > now()
    order by invited_at asc
  loop
    insert into public.account_memberships (account_id, user_id, role)
    values (pending_row.account_id, invitee, pending_row.role)
    on conflict do nothing;

    update public.pending_memberships
    set consumed_at = now()
    where id = pending_row.id;

    account_id := pending_row.account_id;
    return next;
  end loop;
end;
$$;

grant execute on function public.consume_pending_memberships(uuid, text) to authenticated;

-- =========================================================================
-- 8. Trigger: every new account with a non-null creator becomes an owner
--    membership for that creator. Kept SECURITY DEFINER so the insert is
--    not blocked by the (yet-to-exist) RLS policies on account_memberships.
-- =========================================================================
create or replace function public.accounts_create_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.user_id is not null then
    insert into public.account_memberships (account_id, user_id, role)
    values (new.id, new.user_id, 'owner')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists accounts_after_insert_create_owner on public.accounts;
create trigger accounts_after_insert_create_owner
  after insert on public.accounts
  for each row execute function public.accounts_create_owner_membership();

-- =========================================================================
-- 9. Last-owner protection — refuse to delete or demote the last owner of
--    an account. Implemented as a BEFORE trigger so the offending statement
--    is rejected before any policy evaluation.
-- =========================================================================
create or replace function public.guard_last_owner_membership()
returns trigger
language plpgsql
as $$
declare
  remaining_owners integer;
  affected_account uuid;
  account_still_exists boolean;
begin
  if tg_op = 'DELETE' then
    if old.role <> 'owner' then
      return old;
    end if;
    affected_account := old.account_id;
  elsif tg_op = 'UPDATE' then
    if old.role <> 'owner' or new.role = 'owner' then
      return new;
    end if;
    affected_account := old.account_id;
  else
    return null;
  end if;

  -- When the account itself is being deleted, the cascade is wiping every
  -- membership including the owner — that's expected, don't block it.
  select exists (
    select 1 from public.accounts where id = affected_account
  ) into account_still_exists;

  if not account_still_exists then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  select count(*) into remaining_owners
  from public.account_memberships
  where account_id = affected_account
    and role = 'owner'
    and user_id <> old.user_id;

  if remaining_owners = 0 then
    raise exception 'cannot remove or demote the last owner of account %', affected_account
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_last_owner_delete on public.account_memberships;
create trigger guard_last_owner_delete
  before delete on public.account_memberships
  for each row execute function public.guard_last_owner_membership();

drop trigger if exists guard_last_owner_update on public.account_memberships;
create trigger guard_last_owner_update
  before update on public.account_memberships
  for each row execute function public.guard_last_owner_membership();

-- =========================================================================
-- 10. Rewrite RLS — drop the legacy auth.uid()=user_id policies and replace
--     them with membership-aware ones.
-- =========================================================================

-- accounts -----------------------------------------------------------------
drop policy if exists "accounts owner select" on public.accounts;
drop policy if exists "accounts owner insert" on public.accounts;
drop policy if exists "accounts owner update" on public.accounts;
drop policy if exists "accounts owner delete" on public.accounts;

create policy "accounts member select" on public.accounts
  for select using (public.is_account_member(id, auth.uid()));

-- Insert: the creator stamps their own auth.uid() on user_id. The
-- after-insert trigger then materialises the owner membership.
create policy "accounts creator insert" on public.accounts
  for insert with check (user_id = auth.uid());

create policy "accounts owner update" on public.accounts
  for update using (public.is_account_owner(id, auth.uid()));

create policy "accounts owner delete" on public.accounts
  for delete using (public.is_account_owner(id, auth.uid()));

-- transactions -------------------------------------------------------------
drop policy if exists "transactions owner select" on public.transactions;
drop policy if exists "transactions owner insert" on public.transactions;
drop policy if exists "transactions owner update" on public.transactions;
drop policy if exists "transactions owner delete" on public.transactions;

create policy "transactions member select" on public.transactions
  for select using (public.is_account_member(account_id, auth.uid()));

create policy "transactions writer insert" on public.transactions
  for insert with check (public.can_write_account(account_id, auth.uid()));

create policy "transactions writer update" on public.transactions
  for update using (public.can_write_account(account_id, auth.uid()));

create policy "transactions writer delete" on public.transactions
  for delete using (public.can_write_account(account_id, auth.uid()));

-- account_memberships ------------------------------------------------------
-- All checks route through the SECURITY DEFINER helpers above to avoid the
-- recursive "policy on account_memberships reads account_memberships" trap.
create policy "memberships member select" on public.account_memberships
  for select using (public.is_account_member(account_id, auth.uid()));

create policy "memberships owner insert" on public.account_memberships
  for insert with check (public.is_account_owner(account_id, auth.uid()));

create policy "memberships owner update" on public.account_memberships
  for update using (public.is_account_owner(account_id, auth.uid()));

create policy "memberships owner delete" on public.account_memberships
  for delete using (public.is_account_owner(account_id, auth.uid()));

-- pending_memberships ------------------------------------------------------
-- Owner-only CRUD. Consumption happens through the SECURITY DEFINER RPC,
-- which bypasses RLS by design.
create policy "pending owner select" on public.pending_memberships
  for select using (public.is_account_owner(account_id, auth.uid()));

create policy "pending owner insert" on public.pending_memberships
  for insert with check (public.is_account_owner(account_id, auth.uid()));

create policy "pending owner update" on public.pending_memberships
  for update using (public.is_account_owner(account_id, auth.uid()));

create policy "pending owner delete" on public.pending_memberships
  for delete using (public.is_account_owner(account_id, auth.uid()));

-- user_preferences ---------------------------------------------------------
create policy "prefs self select" on public.user_preferences
  for select using (user_id = auth.uid());

create policy "prefs self insert" on public.user_preferences
  for insert with check (user_id = auth.uid());

create policy "prefs self update" on public.user_preferences
  for update using (user_id = auth.uid());

create policy "prefs self delete" on public.user_preferences
  for delete using (user_id = auth.uid());
