-- =============================================================================
-- 0007 — Let a user create their own profile row.
--
-- WHY THIS EXISTS
--   0001 deliberately shipped `profiles` with select+update policies and NO
--   insert policy, on the reasoning that the `handle_new_user` trigger is the
--   only thing that should ever create a profile.
--
--   That reasoning is sound but it broke onboarding completely. The onboarding
--   form upserts, and PostgREST implements upsert as INSERT .. ON CONFLICT,
--   which Postgres checks against the INSERT policy even when the row already
--   exists and the statement resolves to an UPDATE. Every user hit:
--
--     42501  new row violates row-level security policy for table "profiles"
--
--   The form then returned early, `account_intents` was never written,
--   `onboarded_at` stayed null, and /auth/callback bounced the user back to
--   /onboarding forever. Verified against the live database with a real user
--   JWT, and confirmed in production: the owner's own account has a profiles
--   row and an empty account_intents.
--
-- WHY A POLICY RATHER THAN CHANGING THE FORM TO .update()
--   `.update()` would also work, but it silently no-ops if the trigger ever
--   fails to fire, leaving a signed-in user with no profile and no error. An
--   insert policy scoped to the user's own id is the more forgiving of the two
--   and costs nothing: the WITH CHECK makes it impossible to create a row for
--   anybody else.
--
-- The policy is intentionally narrow. `id` must equal the caller's uid, so this
-- grants exactly "create my own row" and nothing more.
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename  = 'profiles'
       and policyname = 'profiles_insert_self'
  ) then
    -- `(select auth.uid())` rather than a bare call: the scalar subquery is
    -- evaluated once per statement instead of once per row. House convention,
    -- and it matters on any policy that touches more than a handful of rows.
    create policy profiles_insert_self
      on public.profiles
      for insert
      to authenticated
      with check ((select auth.uid()) = id);
  end if;
end $$;

comment on table public.profiles is
  'Application-side user record. Deliberately contains NO protected-class '
  'attributes (race, color, religion, sex, familial status, national origin, '
  'disability). Adding such a column would create direct Fair Housing Act '
  'exposure. Rows are normally created by the private.handle_new_user trigger; '
  'policy profiles_insert_self additionally lets a user create their own row so '
  'that a PostgREST upsert during onboarding is not rejected.';
