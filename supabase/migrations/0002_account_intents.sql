-- 0002_account_intents
--
-- What a user says they came here to do, captured once at signup.
--
-- This is deliberately NOT a role column on `profiles`. A role in this product
-- is a relationship to a specific property: the same person is a landlord at
-- one address and a tenant at another. Authorisation therefore lives in the
-- per-property membership tables plus their RLS policies.
--
-- `intents` is signal only. It decides which onboarding path, dashboard
-- modules, and emails a user sees. It grants access to exactly nothing.

create table if not exists public.account_intents (
  -- Shares the primary key with profiles: exactly one intents row per person,
  -- and it disappears with the profile.
  id           uuid        primary key
                           references public.profiles (id) on delete cascade,

  intents      text[]      not null default '{}'::text[],

  -- Null until the user finishes onboarding. This is the single source of
  -- truth for "has this account been set up", used by /auth/callback to route
  -- between /onboarding and /dashboard.
  onboarded_at timestamptz,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- `<@` is array containment: every element of `intents` must appear in the
  -- allowed set. An empty array passes, which is what we want before
  -- onboarding completes. Duplicates are permitted by the check but are
  -- de-duplicated by the application before writing.
  constraint account_intents_allowed_values check (
    intents <@ array['buyer', 'seller', 'tenant', 'landlord', 'agent']::text[]
  )
);

comment on table public.account_intents is
  'Self-declared signup intent (multi-select). Signal for UI shaping only — never a permission. Real authorisation comes from per-property membership rows + RLS.';

comment on column public.account_intents.intents is
  'Subset of buyer|seller|tenant|landlord|agent. Grants no access to any property.';

comment on column public.account_intents.onboarded_at is
  'Set when the user completes onboarding. Null means setup is unfinished.';

alter table public.account_intents enable row level security;

-- Owner-only access. `auth.uid()` is wrapped in a scalar subquery so Postgres
-- evaluates it once per statement (an initplan) instead of once per row — the
-- standard Supabase RLS performance convention, and the difference between an
-- index scan and a sequential scan on large tables.

drop policy if exists "account_intents_select_own" on public.account_intents;
create policy "account_intents_select_own"
  on public.account_intents
  for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "account_intents_insert_own" on public.account_intents;
create policy "account_intents_insert_own"
  on public.account_intents
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "account_intents_update_own" on public.account_intents;
create policy "account_intents_update_own"
  on public.account_intents
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No delete policy: rows are removed only by the profiles cascade. There is no
-- legitimate reason for a client to delete its own intents row directly.
