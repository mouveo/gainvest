-- pgTAP tests for the multi-user memberships migration.
-- Run with: supabase test db
--
-- These tests cover the scenarios listed in the LOT 1 acceptance criteria:
--   * Users see only accounts where they have a membership.
--   * Owner can invite viewer / editor.
--   * Viewer reads but cannot write.
--   * Editor writes.
--   * No recursion on account_memberships policies.
--   * consume_pending_memberships still creates rows despite owner-only RLS.
--   * Deleting the historical creator does not delete shared accounts.
--   * The last owner of an account cannot be removed or demoted.

begin;

select plan(24);

-- ------------------------------------------------------------------------
-- Fixtures: two users, one shared account.
-- ------------------------------------------------------------------------
create extension if not exists pgtap;
create schema if not exists tests;

-- Bypass RLS while we set up fixtures.
set local role postgres;

-- Wipe anything left behind by other test files / db:reset seed.
-- Order matters: delete accounts first so the FK cascades clean memberships
-- without tripping the last-owner guard.
delete from public.transactions;
delete from public.pending_memberships;
delete from public.accounts;
delete from public.user_preferences;
delete from auth.users where email like 'rls-test-%@example.com';

insert into auth.users (id, email, raw_user_meta_data, instance_id, aud, role)
values
  ('11111111-1111-1111-1111-111111111111', 'rls-test-alice@example.com', '{}'::jsonb,
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'rls-test-bob@example.com',   '{}'::jsonb,
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('33333333-3333-3333-3333-333333333333', 'rls-test-carol@example.com', '{}'::jsonb,
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

-- handle_new_user has auto-created a "Perso" account for each test user.
-- Drop them so we start from a clean fixture state.
delete from public.accounts
where user_id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333'
);

-- Alice creates her account (the after-insert trigger materialises the owner
-- membership automatically).
insert into public.accounts (id, user_id, name, type, currency)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '11111111-1111-1111-1111-111111111111',
        'Alice CTO', 'cto', 'EUR');

-- Bob owns a separate account that Alice has no business seeing.
insert into public.accounts (id, user_id, name, type, currency)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        '22222222-2222-2222-2222-222222222222',
        'Bob CTO', 'cto', 'EUR');

-- One transaction on Alice's account, owned-by-creator audit trail.
insert into public.transactions (id, user_id, account_id, kind, trade_date, gross_amount, currency)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc',
        '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'deposit', current_date, 1000, 'EUR');

-- Trigger should have stamped Alice as the owner of her account.
select is(
  (select role from public.account_memberships
    where account_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and user_id    = '11111111-1111-1111-1111-111111111111'),
  'owner',
  'after-insert trigger creates owner membership for the account creator'
);

-- ------------------------------------------------------------------------
-- Helper: switch to a specific authenticated user.
-- ------------------------------------------------------------------------
create or replace function tests.set_auth(target uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', target::text, 'role', 'authenticated')::text,
    true);
  perform set_config('role', 'authenticated', true);
end;
$$;

grant usage on schema tests to authenticated;
grant execute on function tests.set_auth(uuid) to authenticated;

-- ------------------------------------------------------------------------
-- 1. User isolation: Bob does not see Alice's account, and vice versa.
-- ------------------------------------------------------------------------
select tests.set_auth('22222222-2222-2222-2222-222222222222'::uuid);

select is(
  (select count(*) from public.accounts
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0::bigint,
  'Bob cannot see Alice''s account without a membership'
);

select is(
  (select count(*) from public.transactions
    where account_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0::bigint,
  'Bob cannot see transactions on Alice''s account'
);

-- ------------------------------------------------------------------------
-- 2. Alice (owner) invites Bob as viewer.
-- ------------------------------------------------------------------------
select tests.set_auth('11111111-1111-1111-1111-111111111111'::uuid);

select lives_ok($$
  insert into public.account_memberships (account_id, user_id, role)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          '22222222-2222-2222-2222-222222222222',
          'viewer')
$$, 'Owner can add a viewer membership');

-- Bob now sees the account and its transactions.
select tests.set_auth('22222222-2222-2222-2222-222222222222'::uuid);

select is(
  (select count(*) from public.accounts
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1::bigint,
  'Viewer Bob sees the shared account'
);

select is(
  (select count(*) from public.transactions
    where account_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1::bigint,
  'Viewer Bob sees transactions on the shared account'
);

-- ------------------------------------------------------------------------
-- 3. Viewer cannot write.
-- ------------------------------------------------------------------------
select throws_ok($$
  insert into public.transactions (user_id, account_id, kind, trade_date, gross_amount, currency)
  values ('22222222-2222-2222-2222-222222222222',
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          'deposit', current_date, 50, 'EUR')
$$, '42501', NULL, 'Viewer cannot insert transactions');

-- ------------------------------------------------------------------------
-- 4. Promote Bob to editor → Bob can write.
-- ------------------------------------------------------------------------
select tests.set_auth('11111111-1111-1111-1111-111111111111'::uuid);

update public.account_memberships
set role = 'editor'
where account_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and user_id    = '22222222-2222-2222-2222-222222222222';

select tests.set_auth('22222222-2222-2222-2222-222222222222'::uuid);

select lives_ok($$
  insert into public.transactions (user_id, account_id, kind, trade_date, gross_amount, currency)
  values ('22222222-2222-2222-2222-222222222222',
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          'deposit', current_date, 200, 'EUR')
$$, 'Editor Bob can insert transactions');

-- Editor cannot delete the account (only owner can). RLS silently filters
-- non-matching rows, so we assert the account survived rather than expecting
-- a raised exception.
delete from public.accounts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select is(
  (select count(*) from public.accounts
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1::bigint,
  'Editor cannot delete the account (RLS filters the delete)'
);

-- ------------------------------------------------------------------------
-- 5. Membership policies do not recurse: SELECT on account_memberships
--    from a member must succeed without infinite recursion.
-- ------------------------------------------------------------------------
select lives_ok($$
  select count(*) from public.account_memberships
  where account_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
$$, 'Member can read account_memberships without policy recursion');

-- ------------------------------------------------------------------------
-- 6. pending_memberships + consume_pending_memberships.
-- ------------------------------------------------------------------------
select tests.set_auth('11111111-1111-1111-1111-111111111111'::uuid);

select lives_ok($$
  insert into public.pending_memberships (email, account_id, role, invited_by)
  values ('rls-test-carol@example.com',
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          'viewer',
          '11111111-1111-1111-1111-111111111111')
$$, 'Owner can create a pending invitation');

-- Carol cannot read the pending row directly (owner-only).
select tests.set_auth('33333333-3333-3333-3333-333333333333'::uuid);

select is(
  (select count(*) from public.pending_memberships
    where lower(email) = 'rls-test-carol@example.com'),
  0::bigint,
  'Invitee cannot see pending_memberships (owner-only RLS)'
);

-- But the SECURITY DEFINER RPC still redeems the invitation.
select isnt_empty($$
  select * from public.consume_pending_memberships(
    '33333333-3333-3333-3333-333333333333'::uuid,
    'rls-test-carol@example.com'
  )
$$, 'consume_pending_memberships materialises the membership');

select is(
  (select count(*) from public.account_memberships
    where account_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and user_id    = '33333333-3333-3333-3333-333333333333'),
  1::bigint,
  'Carol now has a membership on Alice''s account'
);

-- Carol can now see the account.
select is(
  (select count(*) from public.accounts
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1::bigint,
  'Carol sees the account after redeeming the invitation'
);

-- Verify the invitation row was marked consumed (need owner privileges to read).
set local role postgres;
select is(
  (select consumed_at is not null from public.pending_memberships
    where lower(email) = 'rls-test-carol@example.com'),
  true,
  'Pending invitation is marked consumed'
);

-- ------------------------------------------------------------------------
-- 7. Last-owner protection.
-- ------------------------------------------------------------------------
set local role postgres;

select throws_ok($$
  delete from public.account_memberships
  where account_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    and user_id    = '11111111-1111-1111-1111-111111111111'
$$, '23514', NULL, 'Cannot delete the last owner of an account');

select throws_ok($$
  update public.account_memberships
  set role = 'viewer'
  where account_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    and user_id    = '11111111-1111-1111-1111-111111111111'
$$, '23514', NULL, 'Cannot demote the last owner of an account');

-- Add a second owner → demoting the first one now becomes legal.
insert into public.account_memberships (account_id, user_id, role)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '22222222-2222-2222-2222-222222222222',
        'owner')
on conflict (account_id, user_id) do update set role = 'owner';

select lives_ok($$
  update public.account_memberships
  set role = 'viewer'
  where account_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    and user_id    = '11111111-1111-1111-1111-111111111111'
$$, 'Demoting a non-last owner is allowed');

-- ------------------------------------------------------------------------
-- 8. Deleting the historical creator must NOT cascade-delete the account.
-- ------------------------------------------------------------------------
delete from auth.users where id = '11111111-1111-1111-1111-111111111111';

select is(
  (select count(*) from public.accounts
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1::bigint,
  'Deleting the creator does not delete the shared account'
);

select is(
  (select user_id from public.accounts
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  NULL,
  'accounts.user_id is set to NULL after the creator is deleted'
);

select is(
  (select user_id from public.transactions
    where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  NULL,
  'transactions.user_id is set to NULL after the creator is deleted'
);

-- ------------------------------------------------------------------------
-- 9. user_preferences scoping.
-- ------------------------------------------------------------------------
select tests.set_auth('22222222-2222-2222-2222-222222222222'::uuid);

select lives_ok($$
  insert into public.user_preferences (user_id, scope, payload)
  values ('22222222-2222-2222-2222-222222222222', 'positions', '{"sort":"name"}'::jsonb)
$$, 'User can write their own preferences');

select throws_ok($$
  insert into public.user_preferences (user_id, scope, payload)
  values ('33333333-3333-3333-3333-333333333333', 'positions', '{}'::jsonb)
$$, '42501', NULL, 'User cannot write preferences for another user');

select * from finish();

rollback;
