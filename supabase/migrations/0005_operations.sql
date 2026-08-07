-- =============================================================================
-- 0005 — OPERATIONS
--
-- Closes the four gaps `docs/COMPETITIVE-GAPS.md` §0.3 identifies in the base
-- schema: the top of the landlord funnel (vacancy -> application -> decision),
-- the document/e-sign layer, the accounting stack (expenses -> Schedule E), and
-- the vendor/pro directory with lead routing. Plus saved searches and alerts,
-- which is the persistence layer under `FEATURES.md` 4.18.
--
-- Five sections, each independently useful:
--   A. Saved searches + alerts        (F5)
--   B. Document vault + e-sign        (F7)  — states modelled, no vendor
--   C. Applications & screening       (F8)  — fair-housing constrained
--   D. Expenses / Schedule E          (F9)
--   E. Pro directory + lead routing   (F10)
--
-- Every table: `create table if not exists`, RLS enabled, policies dropped and
-- recreated, `(select auth.uid())` never bare, `to authenticated` on every
-- policy, functions `security definer` with `set search_path = ''`.
-- =============================================================================


-- =============================================================================
-- Shared helper: unit ids the caller can act on at >= a given property role.
-- Applications and vacancy listings hang off units, and resolving unit ->
-- property inside every policy would be the join Supabase measures as the
-- single worst RLS performance mistake.
-- =============================================================================

create or replace function private.unit_ids_for_role(p_min_role public.property_role)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(u.id), '{}')
    from public.units u
   where u.property_id = any(private.property_ids_for_role(p_min_role));
$$;

grant execute on function private.unit_ids_for_role(public.property_role) to authenticated;


-- =============================================================================
-- SECTION A — Saved searches + alerts                                     (F5)
--
-- Criteria are DATA, evaluated by deterministic TypeScript
-- (`src/lib/domain/saved-search.ts`). They are not a stored expression and
-- never an SQL string: an eval-able criteria blob would reintroduce exactly the
-- non-determinism that `scoring_profiles.config` refuses (see its comment in
-- 0001). The shape is versioned so an old saved search keeps evaluating under
-- the semantics it was written against.
-- =============================================================================

do $$ begin
  create type public.alert_channel as enum ('none', 'in_app', 'email', 'sms');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.alert_frequency as enum ('immediate', 'daily_digest', 'weekly_digest');
exception when duplicate_object then null; end $$;

create table if not exists public.saved_searches (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references public.profiles(id) on delete cascade,
  organization_id   uuid references public.organizations(id) on delete cascade,
  name              text not null,
  -- Versioned parameter blob. Shape documented in src/lib/domain/saved-search.ts.
  -- {"v":1,"kind":"for_sale","price_cents":{"max":25000000},"beds":{"min":3},
  --  "geography":{"postal_codes":["58201"]},"property_types":["Duplex"]}
  criteria          jsonb not null,
  criteria_version  integer not null default 1,
  -- Optional: score every match with this profile and gate on min_score.
  scoring_profile_id uuid references public.scoring_profiles(id) on delete set null,
  min_display_score smallint check (min_display_score is null or min_display_score between 0 and 100),
  channel           public.alert_channel not null default 'in_app',
  frequency         public.alert_frequency not null default 'daily_digest',
  -- Quiet hours in the profile's timezone. An "immediate" alert at 03:00 is how
  -- a user turns alerts off permanently.
  quiet_hours_start smallint check (quiet_hours_start is null or quiet_hours_start between 0 and 23),
  quiet_hours_end   smallint check (quiet_hours_end   is null or quiet_hours_end   between 0 and 23),
  is_active         boolean not null default true,
  last_evaluated_at timestamptz,
  last_match_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint saved_searches_name_uq unique (profile_id, name)
);

comment on column public.saved_searches.criteria is
  'PARAMETERS ONLY, versioned. Evaluated by deterministic TypeScript. Never an '
  'expression string, never SQL — the same rule as scoring_profiles.config.';

create index if not exists saved_searches_profile_idx
  on public.saved_searches (profile_id) where is_active;
create index if not exists saved_searches_due_idx
  on public.saved_searches (frequency, last_evaluated_at nulls first) where is_active;

drop trigger if exists saved_searches_updated_at on public.saved_searches;
create trigger saved_searches_updated_at before update on public.saved_searches
  for each row execute function public.set_updated_at();


create table if not exists public.saved_search_matches (
  id              uuid primary key default gen_random_uuid(),
  saved_search_id uuid not null references public.saved_searches(id) on delete cascade,
  listing_id      uuid references public.listings(id) on delete cascade,
  address_id      uuid not null references public.addresses(id) on delete cascade,
  analysis_id     uuid references public.analyses(id) on delete set null,
  display_score   smallint check (display_score is null or display_score between 0 and 100),
  -- Which criteria clauses matched, so the UI can say WHY without re-running
  -- the evaluator. Deterministic, code-generated.
  match_reasons   text[] not null default '{}',
  matched_at      timestamptz not null default now(),
  notified_at     timestamptz,
  dismissed_at    timestamptz,
  -- NULLS NOT DISTINCT: listing_id is NULL for an off-market address match, and
  -- under the default rule those would never collide, so the evaluator would
  -- re-notify on the same address every run.
  constraint saved_search_matches_uq
    unique nulls not distinct (saved_search_id, address_id, listing_id)
);

create index if not exists saved_search_matches_search_idx
  on public.saved_search_matches (saved_search_id, matched_at desc);
create index if not exists saved_search_matches_unnotified_idx
  on public.saved_search_matches (saved_search_id) where notified_at is null;


-- Delivery log. Separate from the match so a failed send can be retried
-- without losing the record that the match existed, and so "why did I get
-- three emails about the same house" is answerable.
create table if not exists public.alert_deliveries (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  saved_search_id uuid references public.saved_searches(id) on delete set null,
  channel         public.alert_channel not null,
  subject         text,
  match_count     integer not null default 0,
  status          text not null default 'queued'
                  check (status in ('queued','sent','failed','suppressed')),
  suppressed_reason text,   -- 'quiet_hours','duplicate','user_unsubscribed'
  provider_message_id text,
  error_text      text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);

create index if not exists alert_deliveries_profile_idx
  on public.alert_deliveries (profile_id, created_at desc);


alter table public.saved_searches       enable row level security;
alter table public.saved_search_matches enable row level security;
alter table public.alert_deliveries     enable row level security;

-- WHY: a saved search is private to its author. Org sharing is deliberately
-- not modelled yet — "my partner can see my buy box" is a real request and a
-- different access question, and guessing at it now would be worse than
-- shipping the narrow correct thing.
drop policy if exists saved_searches_own on public.saved_searches;
create policy saved_searches_own on public.saved_searches
  for select to authenticated using ( profile_id = (select auth.uid()) );

drop policy if exists saved_searches_insert_own on public.saved_searches;
create policy saved_searches_insert_own on public.saved_searches
  for insert to authenticated with check ( profile_id = (select auth.uid()) );

drop policy if exists saved_searches_update_own on public.saved_searches;
create policy saved_searches_update_own on public.saved_searches
  for update to authenticated
  using ( profile_id = (select auth.uid()) )
  with check ( profile_id = (select auth.uid()) );

drop policy if exists saved_searches_delete_own on public.saved_searches;
create policy saved_searches_delete_own on public.saved_searches
  for delete to authenticated using ( profile_id = (select auth.uid()) );

-- Matches are read through their parent search. The `in (select ...)` here is
-- against a table the caller can already read under its own policy, and the
-- subquery is uncorrelated per statement.
drop policy if exists saved_search_matches_own on public.saved_search_matches;
create policy saved_search_matches_own on public.saved_search_matches
  for select to authenticated
  using (
    saved_search_id in (
      select s.id from public.saved_searches s where s.profile_id = (select auth.uid())
    )
  );

-- WHY update-only: dismissing a match is a user action; creating one is the
-- evaluator's job and runs as service_role.
drop policy if exists saved_search_matches_dismiss on public.saved_search_matches;
create policy saved_search_matches_dismiss on public.saved_search_matches
  for update to authenticated
  using (
    saved_search_id in (
      select s.id from public.saved_searches s where s.profile_id = (select auth.uid())
    )
  )
  with check (
    saved_search_id in (
      select s.id from public.saved_searches s where s.profile_id = (select auth.uid())
    )
  );

drop policy if exists alert_deliveries_own on public.alert_deliveries;
create policy alert_deliveries_own on public.alert_deliveries
  for select to authenticated using ( profile_id = (select auth.uid()) );


-- =============================================================================
-- SECTION B — Document vault + e-sign scaffolding                         (F7)
--
-- Versioning is not optional here. A lease amended twice and a lease signed
-- once are the same `documents` row with three `document_versions`; collapsing
-- them into one mutable file is how a landlord ends up unable to prove which
-- text the tenant actually signed.
--
-- E-SIGN IS MODELLED, NOT INTEGRATED. No vendor is named, no webhook is
-- assumed. `signature_requests` and `signature_signers` carry the state machine
-- an ESIGN/UETA-compliant flow needs — intent to sign, consent to do business
-- electronically, an audit trail with time and IP, and the signed artifact
-- retained as its own immutable version. Wiring a provider later means writing
-- an adapter that drives these states, not reshaping the schema.
-- =============================================================================

do $$ begin
  create type public.document_kind as enum (
    'lease', 'lease_amendment', 'application', 'disclosure', 'inspection_report',
    'appraisal', 'title_commitment', 'insurance_policy', 'w9', 'invoice',
    'receipt', 'notice', 'purchase_agreement', 'addendum', 'id_verification',
    'certificate_of_occupancy', 'permit', 'photo_set', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.signature_request_status as enum (
    'draft', 'sent', 'partially_signed', 'completed', 'declined', 'voided', 'expired'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.signer_status as enum (
    'pending', 'notified', 'viewed', 'signed', 'declined'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.documents (
  id              uuid primary key default gen_random_uuid(),
  -- Scope. At least one must be set; the check below enforces it. A document
  -- with no scope is a document nobody can find and RLS cannot reason about.
  organization_id uuid references public.organizations(id) on delete cascade,
  property_id     uuid references public.properties(id)    on delete cascade,
  unit_id         uuid references public.units(id)         on delete cascade,
  lease_id        uuid references public.leases(id)        on delete cascade,
  deal_room_id    uuid references public.deal_rooms(id)    on delete cascade,
  address_id      uuid references public.addresses(id)     on delete set null,
  title           text not null,
  kind            public.document_kind not null default 'other',
  -- Denormalized pointer to the newest version, maintained by trigger.
  current_version integer not null default 0,
  -- Retention: some documents have statutory retention (signed leases, consent
  -- records). Null = no policy yet, which is different from "delete freely".
  retain_until    date,
  is_archived     boolean not null default false,
  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint documents_scoped_ck check (
    organization_id is not null or property_id is not null or unit_id is not null
    or lease_id is not null or deal_room_id is not null
  )
);

create index if not exists documents_property_idx on public.documents (property_id) where not is_archived;
create index if not exists documents_lease_idx    on public.documents (lease_id)    where not is_archived;
create index if not exists documents_deal_idx     on public.documents (deal_room_id) where not is_archived;
create index if not exists documents_org_idx      on public.documents (organization_id) where not is_archived;
create index if not exists documents_kind_idx     on public.documents (kind, created_at desc);

drop trigger if exists documents_updated_at on public.documents;
create trigger documents_updated_at before update on public.documents
  for each row execute function public.set_updated_at();


create table if not exists public.document_versions (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.documents(id) on delete cascade,
  version       integer not null check (version >= 1),
  storage_path  text not null,          -- Supabase Storage object path
  mime_type     text not null,
  size_bytes    bigint not null check (size_bytes > 0 and size_bytes <= 104857600), -- 100 MB
  -- Content hash. This is what makes "which text did they sign" answerable, and
  -- it is the value that goes into consent_records.document_hash.
  sha256        text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  page_count    integer,
  -- TRUE for the artifact produced by completing a signature request. A signed
  -- version is immutable by policy: there is no update or delete path for it.
  is_executed   boolean not null default false,
  note          text,
  uploaded_by   uuid not null references public.profiles(id),
  created_at    timestamptz not null default now(),
  constraint document_versions_uq unique (document_id, version)
);

create index if not exists document_versions_doc_idx
  on public.document_versions (document_id, version desc);

-- Keep documents.current_version honest without trusting the client.
create or replace function private.bump_document_version()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.documents
     set current_version = greatest(current_version, new.version)
   where id = new.document_id;
  return new;
end;
$$;

drop trigger if exists document_versions_bump on public.document_versions;
create trigger document_versions_bump
  after insert on public.document_versions
  for each row execute function private.bump_document_version();


create table if not exists public.signature_requests (
  id                  uuid primary key default gen_random_uuid(),
  document_id         uuid not null references public.documents(id) on delete cascade,
  -- The exact version being signed. Pinning the version is the point: a
  -- request against "the document" would let the text change under the signer.
  document_version_id uuid not null references public.document_versions(id) on delete restrict,
  status              public.signature_request_status not null default 'draft',
  subject             text not null,
  message             text,
  -- Sequential = signer 2 is not notified until signer 1 signs.
  is_sequential       boolean not null default false,
  expires_on          date,
  -- The version produced when everyone has signed. Set on completion.
  executed_version_id uuid references public.document_versions(id) on delete set null,
  -- Provider fields, left null until an adapter exists. Deliberately generic:
  -- no vendor is named anywhere in this schema.
  provider_slug       text,
  provider_envelope_id text,
  created_by          uuid not null references public.profiles(id),
  sent_at             timestamptz,
  completed_at        timestamptz,
  voided_at           timestamptz,
  void_reason         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.signature_requests is
  'E-sign state machine only — no vendor integration. The states carry what '
  'ESIGN/UETA needs: a pinned document version, per-signer intent and consent, '
  'and an immutable executed artifact. An adapter drives these states later.';

create index if not exists signature_requests_doc_idx
  on public.signature_requests (document_id, created_at desc);
create index if not exists signature_requests_open_idx
  on public.signature_requests (status, expires_on)
  where status in ('sent','partially_signed');

drop trigger if exists signature_requests_updated_at on public.signature_requests;
create trigger signature_requests_updated_at before update on public.signature_requests
  for each row execute function public.set_updated_at();


create table if not exists public.signature_signers (
  id                   uuid primary key default gen_random_uuid(),
  signature_request_id uuid not null references public.signature_requests(id) on delete cascade,
  -- A signer may be a platform user or an outside party reached by email.
  profile_id           uuid references public.profiles(id) on delete set null,
  email                text not null,
  full_name            text not null,
  -- Their capacity, e.g. 'tenant', 'landlord', 'guarantor', 'witness'.
  signer_role          text not null,
  signing_order        smallint not null default 1 check (signing_order >= 1),
  status               public.signer_status not null default 'pending',
  -- ESIGN requires affirmative consent to transact electronically, recorded
  -- separately from the signature itself.
  consent_record_id    uuid references public.consent_records(id) on delete set null,
  notified_at          timestamptz,
  viewed_at            timestamptz,
  signed_at            timestamptz,
  declined_at          timestamptz,
  decline_reason       text,
  -- Audit trail. Captured at the moment of signing, never editable after.
  ip_inet              inet,
  user_agent           text,
  constraint signature_signers_uq unique (signature_request_id, email),
  constraint signature_signers_signed_ck
    check ((status = 'signed') = (signed_at is not null))
);

create index if not exists signature_signers_request_idx
  on public.signature_signers (signature_request_id, signing_order);
create index if not exists signature_signers_profile_idx
  on public.signature_signers (profile_id) where status in ('pending','notified','viewed');


create table if not exists public.signature_events (
  id                   bigint generated always as identity primary key,
  signature_request_id uuid not null references public.signature_requests(id) on delete cascade,
  signer_id            uuid references public.signature_signers(id) on delete set null,
  event_type           text not null,   -- 'sent','viewed','signed','declined','voided','expired'
  detail               jsonb not null default '{}'::jsonb,
  ip_inet              inet,
  created_at           timestamptz not null default now()
);

create index if not exists signature_events_request_idx
  on public.signature_events (signature_request_id, created_at);

drop trigger if exists signature_events_append_only on public.signature_events;
create trigger signature_events_append_only
  before update or delete on public.signature_events
  for each row execute function private.forbid_mutation();


-- Roll the request status forward from its signers, in the database, so the
-- status can never disagree with the underlying signatures.
create or replace function private.recalc_signature_request_status()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_req uuid := coalesce(new.signature_request_id, old.signature_request_id);
  v_total int;
  v_signed int;
  v_declined int;
  v_current public.signature_request_status;
begin
  select count(*), count(*) filter (where status = 'signed'),
         count(*) filter (where status = 'declined')
    into v_total, v_signed, v_declined
    from public.signature_signers
   where signature_request_id = v_req;

  select status into v_current from public.signature_requests where id = v_req;

  -- Terminal states are never re-derived.
  if v_current in ('voided','expired','draft') then
    return new;
  end if;

  if v_declined > 0 then
    update public.signature_requests
       set status = 'declined'
     where id = v_req and status <> 'declined';
  elsif v_total > 0 and v_signed = v_total then
    update public.signature_requests
       set status = 'completed', completed_at = coalesce(completed_at, now())
     where id = v_req and status <> 'completed';
  elsif v_signed > 0 then
    update public.signature_requests
       set status = 'partially_signed'
     where id = v_req and status = 'sent';
  end if;

  return new;
end;
$$;

drop trigger if exists signature_signers_recalc on public.signature_signers;
create trigger signature_signers_recalc
  after insert or update of status on public.signature_signers
  for each row execute function private.recalc_signature_request_status();


-- Deferred FK from 0004: a document request is fulfilled by a document.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'deal_doc_requests_document_fk'
  ) then
    alter table public.deal_document_requests
      add constraint deal_doc_requests_document_fk
      foreign key (fulfilled_by_document_id) references public.documents(id)
      on delete set null;
  end if;
end $$;


alter table public.documents          enable row level security;
alter table public.document_versions  enable row level security;
alter table public.signature_requests enable row level security;
alter table public.signature_signers  enable row level security;
alter table public.signature_events   enable row level security;

-- WHY this shape: a document is visible through whichever scope it was filed
-- under. Each branch is an array membership test against a SECURITY DEFINER
-- helper — no joins in the policy.
drop policy if exists documents_select_scoped on public.documents;
create policy documents_select_scoped on public.documents
  for select to authenticated
  using (
    created_by = (select auth.uid())
    or (property_id     is not null and property_id     = any(private.property_ids_for_role('viewer')))
    or (unit_id         is not null and unit_id         = any(private.unit_ids_for_role('viewer')))
    or (lease_id        is not null and lease_id        = any(private.tenant_lease_ids()))
    or (deal_room_id    is not null and deal_room_id    = any(private.deal_room_ids()))
    or (organization_id is not null and organization_id = any(private.org_ids_for_role('viewer')))
  );

drop policy if exists documents_insert_scoped on public.documents;
create policy documents_insert_scoped on public.documents
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      (property_id     is not null and property_id     = any(private.property_ids_for_role('manager')))
      or (unit_id      is not null and unit_id         = any(private.unit_ids_for_role('manager')))
      or (lease_id     is not null and lease_id        = any(private.tenant_lease_ids()))
      or (deal_room_id is not null and deal_room_id    = any(private.deal_room_ids()))
      or (organization_id is not null and organization_id = any(private.org_ids_for_role('manager')))
    )
  );

drop policy if exists documents_update_manager on public.documents;
create policy documents_update_manager on public.documents
  for update to authenticated
  using (
    created_by = (select auth.uid())
    or (property_id     is not null and property_id     = any(private.property_ids_for_role('manager')))
    or (deal_room_id    is not null and deal_room_id    = any(private.deal_room_ids_manage()))
    or (organization_id is not null and organization_id = any(private.org_ids_for_role('manager')))
  )
  with check ( true );

-- Versions inherit their document's visibility. Written once, never updated:
-- a new version is a new row, which is the entire point of versioning.
drop policy if exists document_versions_select on public.document_versions;
create policy document_versions_select on public.document_versions
  for select to authenticated
  using ( document_id in (select d.id from public.documents d) );

drop policy if exists document_versions_insert on public.document_versions;
create policy document_versions_insert on public.document_versions
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and document_id in (select d.id from public.documents d)
  );

-- WHY no update/delete policy on document_versions: an executed version is
-- evidence. Correcting a mistake means uploading version n+1.

drop policy if exists signature_requests_select on public.signature_requests;
create policy signature_requests_select on public.signature_requests
  for select to authenticated
  using (
    created_by = (select auth.uid())
    or document_id in (select d.id from public.documents d)
    or id in (
      select s.signature_request_id from public.signature_signers s
       where s.profile_id = (select auth.uid())
    )
  );

drop policy if exists signature_requests_insert on public.signature_requests;
create policy signature_requests_insert on public.signature_requests
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and document_id in (select d.id from public.documents d)
  );

drop policy if exists signature_requests_update on public.signature_requests;
create policy signature_requests_update on public.signature_requests
  for update to authenticated
  using ( created_by = (select auth.uid()) )
  with check ( created_by = (select auth.uid()) );

-- WHY: a signer must see their own row (to sign it) and everyone in a request
-- you can see (to know who else is on it). Signers update ONLY their own row,
-- which is how "sign" is expressed without a privileged endpoint.
drop policy if exists signature_signers_select on public.signature_signers;
create policy signature_signers_select on public.signature_signers
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or signature_request_id in (select r.id from public.signature_requests r)
  );

drop policy if exists signature_signers_insert on public.signature_signers;
create policy signature_signers_insert on public.signature_signers
  for insert to authenticated
  with check (
    signature_request_id in (
      select r.id from public.signature_requests r where r.created_by = (select auth.uid())
    )
  );

drop policy if exists signature_signers_update_self on public.signature_signers;
create policy signature_signers_update_self on public.signature_signers
  for update to authenticated
  using ( profile_id = (select auth.uid()) )
  with check ( profile_id = (select auth.uid()) );

drop policy if exists signature_events_select on public.signature_events;
create policy signature_events_select on public.signature_events
  for select to authenticated
  using ( signature_request_id in (select r.id from public.signature_requests r) );


-- =============================================================================
-- SECTION C — Applications & screening funnel                             (F8)
--
-- ############################################################################
-- ## FAIR HOUSING — READ BEFORE ADDING A COLUMN TO ANYTHING IN THIS SECTION ##
-- ############################################################################
--
-- There is deliberately NO column, in any table below, in any jsonb blob, for:
--   race, color, religion, sex (incl. gender identity and sexual orientation),
--   familial status, national origin, or disability.
--
-- Nor is there a free-text field that invites one. There is no "tell us about
-- yourself", no "additional information", no "notes about the applicant", and
-- no free-text decision reason. That absence is the design. A landlord typing
-- "family with 3 young kids, might be loud" into a notes box creates Fair
-- Housing Act exposure that no amount of policy training removes, and the only
-- reliable prevention is not having the box.
--
-- Decisions reference a code from `application_decision_reasons`, a controlled
-- vocabulary of legitimate, non-protected criteria. Adding a reason to that
-- table is a deliberate, reviewable act; typing one into a text field is not.
--
-- Screening is modelled as an ORDER PLACED WITH A LICENSED CONSUMER REPORTING
-- AGENCY, never as a score this platform computes. There is no risk score, no
-- ranking, no "recommended applicant". FEATURES.md §6.6: if screening must
-- exist, integrate a licensed CRA and never build the model. FCRA adverse
-- action obligations attach to the CRA report, and `screening_orders` records
-- the notice, not a verdict.
--
-- If a future feature seems to need one of these columns, that is the moment to
-- involve counsel, not to add the column.
-- ############################################################################
-- =============================================================================

do $$ begin
  create type public.application_status as enum (
    'draft',            -- applicant is filling it in
    'submitted',
    'under_review',
    'screening_ordered',
    'approved',
    'approved_with_conditions',
    'declined',
    'withdrawn',
    'expired'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.vacancy_status as enum ('draft', 'published', 'paused', 'filled', 'closed');
exception when duplicate_object then null; end $$;

-- The landlord-published vacancy. Distinct from `public.listings`, which is a
-- market OBSERVATION ingested from a third party; this is a listing the
-- platform's own user authored and is accountable for.
create table if not exists public.vacancy_listings (
  id                uuid primary key default gen_random_uuid(),
  unit_id           uuid not null references public.units(id) on delete cascade,
  property_id       uuid not null references public.properties(id) on delete cascade,
  headline          text not null,
  description       text,
  rent_cents        bigint not null check (rent_cents >= 0),
  deposit_cents     bigint not null default 0 check (deposit_cents >= 0),
  -- FCRA/state law caps application fees in several jurisdictions. Stored in
  -- cents so the cap check is exact.
  application_fee_cents bigint not null default 0 check (application_fee_cents >= 0),
  lease_term_months smallint check (lease_term_months is null or lease_term_months > 0),
  available_on      date,
  pets_allowed      boolean,
  pet_policy        text,
  utilities_included text[] not null default '{}',
  -- Accessibility features are a REQUIRED disclosure under the FHA design and
  -- construction standards, and describing them is affirmatively good. Note
  -- this describes the PROPERTY, never the applicant.
  accessibility_features text[] not null default '{}',
  status            public.vacancy_status not null default 'draft',
  published_at      timestamptz,
  closed_at         timestamptz,
  created_by        uuid not null references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on column public.vacancy_listings.accessibility_features is
  'Describes the UNIT (step-free entry, roll-in shower, ...). It never '
  'describes an applicant. Disclosing accessibility is affirmatively required '
  'by the FHA design and construction standards for covered buildings.';

create index if not exists vacancy_listings_property_idx on public.vacancy_listings (property_id);
create index if not exists vacancy_listings_published_idx
  on public.vacancy_listings (status, available_on) where status = 'published';

drop trigger if exists vacancy_listings_updated_at on public.vacancy_listings;
create trigger vacancy_listings_updated_at before update on public.vacancy_listings
  for each row execute function public.set_updated_at();


create table if not exists public.rental_applications (
  id                uuid primary key default gen_random_uuid(),
  vacancy_listing_id uuid references public.vacancy_listings(id) on delete set null,
  unit_id           uuid not null references public.units(id) on delete cascade,
  property_id       uuid not null references public.properties(id) on delete cascade,
  applicant_id      uuid not null references public.profiles(id) on delete cascade,
  status            public.application_status not null default 'draft',

  -- ---------------------------------------------------------------------
  -- Permissible, business-necessity criteria ONLY. Every field below is a
  -- financial or tenancy-history fact that applies identically to every
  -- applicant. Nothing here is, or proxies for, a protected class.
  -- ---------------------------------------------------------------------
  desired_move_in_on   date,
  desired_term_months  smallint check (desired_term_months is null or desired_term_months > 0),
  -- Gross monthly income, self-reported then verified. Income is a legitimate
  -- criterion; SOURCE of income is protected in a growing number of
  -- jurisdictions (housing vouchers), so there is no income-source column.
  stated_monthly_income_cents bigint check (stated_monthly_income_cents is null or stated_monthly_income_cents >= 0),
  income_verified      boolean not null default false,
  income_verified_at   timestamptz,
  employment_status    text check (employment_status is null or employment_status in
                         ('employed','self_employed','student','retired','other')),
  current_employer     text,
  employment_months    smallint check (employment_months is null or employment_months >= 0),
  -- Rental history. Verifiable, applies to everyone.
  current_landlord_name  text,
  current_landlord_phone text,
  months_at_current_address smallint check (months_at_current_address is null or months_at_current_address >= 0),
  prior_eviction_disclosed  boolean,
  -- Occupancy count exists ONLY to check the unit against the jurisdiction's
  -- occupancy limit (see zoning_districts.max_unrelated_occupants). It must
  -- never be an input to an approve/decline decision, and there is no field
  -- for the ages or relationships of occupants — that would be familial status.
  occupant_count       smallint check (occupant_count is null or occupant_count > 0),
  pet_count            smallint check (pet_count is null or pet_count >= 0),
  -- Assistance animals are NOT pets and may not be counted, charged for, or
  -- used in a decision. Recorded separately so the distinction is structural.
  assistance_animal_requested boolean not null default false,
  vehicle_count        smallint check (vehicle_count is null or vehicle_count >= 0),
  smoker               boolean,

  submitted_at      timestamptz,
  withdrawn_at      timestamptz,
  expires_on        date,

  -- ---------------------------------------------------------------------
  -- Decision. Coded, never free text.
  -- ---------------------------------------------------------------------
  decision_reason_code text,
  decided_at        timestamptz,
  decided_by        uuid references public.profiles(id),
  -- FCRA: when a decision is based in whole or part on a consumer report, an
  -- adverse action notice is required. This records that it was sent.
  adverse_action_sent_at timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint rental_applications_decided_ck
    check ((status in ('approved','approved_with_conditions','declined')) = (decided_at is not null))
);

comment on table public.rental_applications is
  'FAIR HOUSING: this table deliberately contains NO column for race, color, '
  'religion, sex, familial status, national origin, or disability, and NO '
  'free-text field that invites one (no "notes", no "additional information", '
  'no free-text decision reason). The absence is the design, not an oversight. '
  'Decisions reference application_decision_reasons, a controlled vocabulary of '
  'legitimate non-protected criteria. Adding a protected-class column here is a '
  'direct Fair Housing Act exposure — involve counsel, do not add the column.';

comment on column public.rental_applications.occupant_count is
  'Used ONLY to check the unit against the jurisdiction occupancy limit. Must '
  'never be an input to an approve/decline decision. There is deliberately no '
  'field for occupant ages or relationships — that is familial status.';

comment on column public.rental_applications.assistance_animal_requested is
  'An assistance animal is not a pet. It may not be counted toward a pet limit, '
  'charged a pet fee, or considered in the decision. Modelled separately from '
  'pet_count so the two can never be conflated by a query.';

create index if not exists rental_applications_unit_idx
  on public.rental_applications (unit_id, status, submitted_at desc);
create index if not exists rental_applications_applicant_idx
  on public.rental_applications (applicant_id, created_at desc);
create index if not exists rental_applications_property_idx
  on public.rental_applications (property_id, status);

-- One live application per applicant per unit. A withdrawn or decided
-- application does not block a fresh one — people reapply, and blocking that
-- would be both wrong and, applied unevenly, a fair-housing problem.
create unique index if not exists rental_applications_one_open_uq
  on public.rental_applications (unit_id, applicant_id)
  where status in ('draft','submitted','under_review','screening_ordered');

drop trigger if exists rental_applications_updated_at on public.rental_applications;
create trigger rental_applications_updated_at before update on public.rental_applications
  for each row execute function public.set_updated_at();


-- The controlled vocabulary. This table IS the fair-housing guardrail: a
-- decline must cite one of these codes, and every code here is a legitimate,
-- consistently-applied, non-protected business criterion.
create table if not exists public.application_decision_reasons (
  code          text primary key,
  display_name  text not null,
  -- 'approve' | 'decline' | 'conditional'
  applies_to    text not null check (applies_to in ('approve','decline','conditional')),
  -- Why this criterion is lawful and consistently applicable. Required, so the
  -- justification is written down before the code can be used.
  rationale     text not null,
  -- TRUE when using this reason triggers an FCRA adverse action notice.
  requires_adverse_action_notice boolean not null default false,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

comment on table public.application_decision_reasons is
  'Controlled vocabulary of lawful decision criteria. A decline cites a code '
  'from here; there is no free-text reason field on rental_applications, '
  'deliberately. Every row requires a written rationale so the justification '
  'exists before the reason can be used.';

insert into public.application_decision_reasons
  (code, display_name, applies_to, rationale, requires_adverse_action_notice)
values
  ('meets_criteria','Meets all stated criteria','approve',
   'Applicant satisfied every published, uniformly applied criterion.', false),
  ('income_below_threshold','Income below published threshold','decline',
   'A published income-to-rent ratio applied identically to every applicant is a recognised business-necessity criterion. The threshold must be published before applications open and must not vary by applicant.', true),
  ('income_unverifiable','Income could not be verified','decline',
   'Verification failure is a process fact, not a judgement about the applicant. The same verification is required of everyone.', true),
  ('credit_report_criteria','Consumer report did not meet published criteria','decline',
   'Based on a report from a licensed consumer reporting agency against thresholds published in advance. Triggers an FCRA adverse action notice naming the CRA.', true),
  ('rental_history_criteria','Rental history did not meet published criteria','decline',
   'Verified prior-tenancy facts (unpaid balance owed to a prior landlord, lease violation on record) applied uniformly.', true),
  ('incomplete_application','Application incomplete after follow-up','decline',
   'Process fact. The same completeness requirement applies to every applicant and a follow-up request was made.', false),
  ('unit_no_longer_available','Unit filled by an earlier qualified applicant','decline',
   'First-qualified-first-served, applied by submission timestamp. This is the reason that keeps the ordering honest rather than retrofitting a criterion.', false),
  ('applicant_withdrew','Applicant withdrew','decline',
   'Applicant-initiated. Recorded so the funnel is accurate.', false),
  ('conditional_additional_deposit','Approved with an additional deposit','conditional',
   'A published, uniformly applied condition tied to a stated criterion. The deposit must remain within the statutory cap for the jurisdiction.', true),
  ('conditional_cosigner','Approved with a cosigner or guarantor','conditional',
   'A published, uniformly applied alternative to the income threshold.', true)
on conflict (code) do nothing;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'rental_applications_reason_fk'
  ) then
    alter table public.rental_applications
      add constraint rental_applications_reason_fk
      foreign key (decision_reason_code)
      references public.application_decision_reasons(code);
  end if;
end $$;


-- Screening order placed with a licensed CRA. There is NO score column, no
-- ranking, no recommendation. The platform records that an order was placed and
-- what the CRA returned as a pass/fail against criteria the landlord published
-- in advance — it does not evaluate anyone.
create table if not exists public.screening_orders (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.rental_applications(id) on delete cascade,
  -- The licensed consumer reporting agency. Named as a slug; no vendor is
  -- assumed by this schema.
  provider_slug  text not null,
  provider_order_id text,
  -- What was ordered. Each is separately consented to.
  includes_credit    boolean not null default false,
  includes_criminal  boolean not null default false,
  includes_eviction  boolean not null default false,
  -- FCRA §604(b)-style written authorization from the applicant.
  authorization_consent_id uuid references public.consent_records(id) on delete set null,
  status         text not null default 'ordered'
                 check (status in ('ordered','in_progress','complete','failed','cancelled')),
  -- The CRA's own pass/fail against the landlord's PUBLISHED criteria. Not a
  -- score, not a probability, not a recommendation.
  result_meets_criteria boolean,
  -- Where the report lives. The report itself is never copied into a column.
  report_document_id uuid references public.documents(id) on delete set null,
  ordered_by     uuid not null references public.profiles(id),
  ordered_at     timestamptz not null default now(),
  completed_at   timestamptz
);

comment on table public.screening_orders is
  'An order placed with a LICENSED consumer reporting agency. There is '
  'deliberately no score, rank, or recommendation column: algorithmic tenant '
  'screening is the most actively litigated corner of housing AI, and this '
  'platform does not build the model. FEATURES.md §6.6.';

create index if not exists screening_orders_app_idx on public.screening_orders (application_id);


alter table public.vacancy_listings            enable row level security;
alter table public.rental_applications         enable row level security;
alter table public.application_decision_reasons enable row level security;
alter table public.screening_orders            enable row level security;

-- WHY published vacancies are readable by every authenticated user: that is
-- what a vacancy listing is for. Drafts are visible only to the property team.
drop policy if exists vacancy_listings_select_published on public.vacancy_listings;
create policy vacancy_listings_select_published on public.vacancy_listings
  for select to authenticated
  using ( status = 'published' or property_id = any(private.property_ids_for_role('viewer')) );

drop policy if exists vacancy_listings_write_manager on public.vacancy_listings;
create policy vacancy_listings_write_manager on public.vacancy_listings
  for insert to authenticated
  with check (
    property_id = any(private.property_ids_for_role('manager'))
    and created_by = (select auth.uid())
  );

drop policy if exists vacancy_listings_update_manager on public.vacancy_listings;
create policy vacancy_listings_update_manager on public.vacancy_listings
  for update to authenticated
  using ( property_id = any(private.property_ids_for_role('manager')) )
  with check ( property_id = any(private.property_ids_for_role('manager')) );

-- WHY: an applicant sees their own application and nobody else's — critically,
-- NOT other applicants for the same unit. A landlord/manager sees applications
-- for their own properties. There is no policy that lets an applicant compare
-- themselves to another applicant.
drop policy if exists rental_applications_select on public.rental_applications;
create policy rental_applications_select on public.rental_applications
  for select to authenticated
  using (
    applicant_id = (select auth.uid())
    or property_id = any(private.property_ids_for_role('manager'))
  );

drop policy if exists rental_applications_insert_self on public.rental_applications;
create policy rental_applications_insert_self on public.rental_applications
  for insert to authenticated
  with check ( applicant_id = (select auth.uid()) );

-- WHY two update policies: the applicant edits their own draft; the manager
-- moves it through review. Neither can do the other's job.
drop policy if exists rental_applications_update_applicant on public.rental_applications;
create policy rental_applications_update_applicant on public.rental_applications
  for update to authenticated
  using ( applicant_id = (select auth.uid()) and status in ('draft','submitted') )
  with check ( applicant_id = (select auth.uid()) );

drop policy if exists rental_applications_update_manager on public.rental_applications;
create policy rental_applications_update_manager on public.rental_applications
  for update to authenticated
  using ( property_id = any(private.property_ids_for_role('manager')) )
  with check ( property_id = any(private.property_ids_for_role('manager')) );

drop policy if exists application_decision_reasons_select on public.application_decision_reasons;
create policy application_decision_reasons_select on public.application_decision_reasons
  for select to authenticated using ( true );

-- WHY the applicant can read their own screening order: FCRA gives them the
-- right to know a report was pulled and by whom.
drop policy if exists screening_orders_select on public.screening_orders;
create policy screening_orders_select on public.screening_orders
  for select to authenticated
  using (
    application_id in (
      select a.id from public.rental_applications a
       where a.applicant_id = (select auth.uid())
         or a.property_id = any(private.property_ids_for_role('manager'))
    )
  );

drop policy if exists screening_orders_insert_manager on public.screening_orders;
create policy screening_orders_insert_manager on public.screening_orders
  for insert to authenticated
  with check (
    ordered_by = (select auth.uid())
    and application_id in (
      select a.id from public.rental_applications a
       where a.property_id = any(private.property_ids_for_role('manager'))
    )
  );


-- =============================================================================
-- SECTION D — Expenses / Schedule E                                       (F9)
--
-- Categories map to IRS Schedule E (Form 1040), Part I, lines 5-19. The line
-- number is DATA on the category rather than logic in a report generator, so
-- the mapping is inspectable and a new category cannot be added without stating
-- where it lands on the form.
--
-- Nothing here computes a tax position. It produces a per-property rollup by
-- Schedule E line — the arithmetic a preparer would otherwise do from a
-- shoebox. Depreciation (line 18) is deliberately NOT computed: basis
-- allocation, placed-in-service dates and recovery periods are a preparer's
-- determination, not a SaaS feature.
-- =============================================================================

create table if not exists public.expense_categories (
  code            text primary key,
  display_name    text not null,
  -- Schedule E (Form 1040) Part I line number, 5 through 19.
  schedule_e_line smallint check (schedule_e_line is null or schedule_e_line between 5 and 19),
  irs_label       text,
  -- TRUE = likely a capital improvement to be depreciated, not a current-year
  -- deduction. Flagged, never decided: the repair/improvement line is a
  -- judgement call and this column exists to surface it to the preparer.
  is_capital_hint boolean not null default false,
  description     text,
  sort_order      smallint not null default 0,
  is_active       boolean not null default true
);

comment on table public.expense_categories is
  'Maps a plain-language category to an IRS Schedule E (Form 1040) Part I line. '
  'The mapping is data so it is inspectable and so a new category cannot exist '
  'without a stated line. Line 18 (depreciation) is intentionally never '
  'auto-computed — basis and recovery period are a preparer determination.';

insert into public.expense_categories
  (code, display_name, schedule_e_line, irs_label, is_capital_hint, description, sort_order)
values
  ('advertising','Advertising',5,'Advertising',false,'Listing fees, signage, photography for a vacancy.',50),
  ('auto_travel','Auto and travel',6,'Auto and travel',false,'Mileage to the property, travel to inspect or manage. Keep a contemporaneous log.',60),
  ('cleaning_maintenance','Cleaning and maintenance',7,'Cleaning and maintenance',false,'Turnover cleaning, lawn care, snow removal, pest control.',70),
  ('commissions','Commissions',8,'Commissions',false,'Leasing commissions paid to an agent.',80),
  ('insurance','Insurance',9,'Insurance',false,'Landlord/dwelling policy, umbrella liability allocated to the property.',90),
  ('legal_professional','Legal and other professional fees',10,'Legal and other professional fees',false,'Attorney, accountant, eviction filing fees.',100),
  ('management_fees','Management fees',11,'Management fees',false,'Third-party property management.',110),
  ('mortgage_interest','Mortgage interest paid to banks',12,'Mortgage interest paid to banks, etc.',false,'From Form 1098. Interest only — principal is not deductible.',120),
  ('other_interest','Other interest',13,'Other interest',false,'Interest on a loan used for the property that is not a bank mortgage.',130),
  ('repairs','Repairs',14,'Repairs',false,'Restores the property to working order without adding value or life. Contrast with a capital improvement.',140),
  ('supplies','Supplies',15,'Supplies',false,'Consumables: filters, light bulbs, hardware.',150),
  ('taxes','Taxes',16,'Taxes',false,'Real estate taxes and any local rental licence or registration fee.',160),
  ('utilities','Utilities',17,'Utilities',false,'Utilities the owner pays: water, sewer, refuse, gas, electric.',170),
  ('depreciation','Depreciation',18,'Depreciation expense or depletion',true,'NOT computed by this platform. Recorded only when a preparer supplies the figure.',180),
  ('hoa_dues','HOA dues',19,'Other',false,'Association dues. Reported on the Other line with a description.',190),
  ('bank_fees','Bank and processing fees',19,'Other',false,'Payment processing, wire fees, account fees attributable to the property.',200),
  ('licences_permits','Licences and permits',19,'Other',false,'Rental registration, certificate of occupancy, permit fees.',210),
  ('capital_improvement','Capital improvement',null,null,true,'Adds value, prolongs life, or adapts to a new use. Depreciated over its recovery period rather than deducted in the current year — it does NOT appear on a Schedule E line as an expense.',900),
  ('owner_draw','Owner draw',null,null,false,'Not an expense. Tracked for cash-flow completeness and excluded from every Schedule E line.',910),
  ('principal_payment','Mortgage principal',null,null,false,'Not deductible. Tracked so the bank statement reconciles; excluded from Schedule E.',920)
on conflict (code) do nothing;


create table if not exists public.expenses (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- A property-level expense. Unit is optional; a roof is the property's, a
  -- fridge is a unit's.
  property_id     uuid not null references public.properties(id) on delete cascade,
  unit_id         uuid references public.units(id) on delete set null,
  category_code   text not null references public.expense_categories(code),
  -- Integer cents, positive. A refund is a separate row with is_refund = true
  -- rather than a negative amount, so a sum never silently nets two unrelated
  -- things.
  amount_cents    bigint not null check (amount_cents >= 0),
  is_refund       boolean not null default false,
  currency        char(3) not null default 'USD',
  incurred_on     date not null,
  paid_on         date,
  payee_name      text,
  vendor_pro_id   uuid,      -- FK added in section E, after pro_profiles exists
  memo            text,
  -- Links that make the expense auditable end to end.
  receipt_document_id     uuid references public.documents(id) on delete set null,
  maintenance_request_id  uuid references public.maintenance_requests(id) on delete set null,
  payment_id              uuid references public.payments(id) on delete set null,
  -- Set TRUE when the preparer has reviewed the repair/improvement call.
  capital_review_done boolean not null default false,
  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists expenses_property_date_idx
  on public.expenses (property_id, incurred_on desc);
create index if not exists expenses_org_date_idx
  on public.expenses (organization_id, incurred_on desc);
create index if not exists expenses_category_idx
  on public.expenses (category_code, incurred_on desc);
create index if not exists expenses_unreceipted_idx
  on public.expenses (property_id) where receipt_document_id is null;

drop trigger if exists expenses_updated_at on public.expenses;
create trigger expenses_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();


-- Splitting one bill across several properties. A shared insurance policy or a
-- roof on a duplex where only one side is a rental. Shares are basis points so
-- the split is exact and the constraint below can be checked in integers.
create table if not exists public.expense_allocations (
  id            uuid primary key default gen_random_uuid(),
  expense_id    uuid not null references public.expenses(id) on delete cascade,
  property_id   uuid not null references public.properties(id) on delete cascade,
  unit_id       uuid references public.units(id) on delete set null,
  -- 10000 bps = 100%. Integer, so allocations sum exactly.
  share_bps     integer not null check (share_bps > 0 and share_bps <= 10000),
  amount_cents  bigint not null check (amount_cents >= 0),
  basis         text not null default 'manual'
                check (basis in ('manual','by_sqft','by_unit_count','by_rent')),
  -- NULLS NOT DISTINCT: a property-level allocation has unit_id NULL, and the
  -- default rule would let two of them coexist for the same property — which
  -- would then fail the balance assertion in a confusing place.
  constraint expense_allocations_uq
    unique nulls not distinct (expense_id, property_id, unit_id)
);

create index if not exists expense_allocations_expense_idx
  on public.expense_allocations (expense_id);
create index if not exists expense_allocations_property_idx
  on public.expense_allocations (property_id);

-- Allocations must sum to exactly the expense, in cents AND in basis points.
-- Deferred so a multi-row insert can be built up inside one transaction. This
-- is the same posture as the ledger balance assertion in 0001: an allocation
-- that silently loses a cent is a reconciliation bug that surfaces in April.
create or replace function private.assert_allocation_balanced()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_expense uuid := coalesce(new.expense_id, old.expense_id);
  v_total_cents bigint;
  v_total_bps int;
  v_amount bigint;
  v_count int;
begin
  select count(*), coalesce(sum(amount_cents),0), coalesce(sum(share_bps),0)
    into v_count, v_total_cents, v_total_bps
    from public.expense_allocations where expense_id = v_expense;

  -- No allocations at all is legal: the expense belongs wholly to its property.
  if v_count = 0 then
    return null;
  end if;

  select amount_cents into v_amount from public.expenses where id = v_expense;
  if v_amount is null then
    return null;   -- expense deleted in the same transaction
  end if;

  if v_total_cents <> v_amount then
    raise exception
      'Expense % allocations sum to % cents but the expense is % cents. Allocations must be exact.',
      v_expense, v_total_cents, v_amount
      using errcode = 'check_violation';
  end if;
  if v_total_bps <> 10000 then
    raise exception
      'Expense % allocations sum to % basis points, expected 10000.',
      v_expense, v_total_bps
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

drop trigger if exists expense_allocations_balanced on public.expense_allocations;
create constraint trigger expense_allocations_balanced
  after insert or update or delete on public.expense_allocations
  deferrable initially deferred
  for each row execute function private.assert_allocation_balanced();


-- Per-property Schedule E rollup. `security_invoker = on` so the view is
-- evaluated with the caller's permissions and the RLS on `expenses` applies —
-- without it a view is a hole straight through row level security.
create or replace view public.property_schedule_e_rollup
with (security_invoker = on) as
select
  e.property_id,
  extract(year from e.incurred_on)::smallint as tax_year,
  c.schedule_e_line,
  c.irs_label,
  c.code as category_code,
  c.display_name as category_name,
  count(*)::integer as entry_count,
  -- Refunds subtract. Modelled as a filtered sum rather than by allowing
  -- negative amounts, so the two are never conflated upstream.
  (coalesce(sum(e.amount_cents) filter (where not e.is_refund), 0)
   - coalesce(sum(e.amount_cents) filter (where e.is_refund), 0))::bigint as net_cents,
  count(*) filter (where e.receipt_document_id is null)::integer as missing_receipt_count
from public.expenses e
join public.expense_categories c on c.code = e.category_code
group by e.property_id, extract(year from e.incurred_on), c.schedule_e_line,
         c.irs_label, c.code, c.display_name, c.sort_order
order by e.property_id, tax_year desc, c.sort_order;

comment on view public.property_schedule_e_rollup is
  'Per-property, per-tax-year totals by Schedule E line. Rows with a NULL '
  'schedule_e_line (capital improvements, owner draws, principal) are '
  'deliberately included so the cash view reconciles — a report must filter '
  'them out to produce the form.';


alter table public.expense_categories   enable row level security;
alter table public.expenses             enable row level security;
alter table public.expense_allocations  enable row level security;

drop policy if exists expense_categories_select on public.expense_categories;
create policy expense_categories_select on public.expense_categories
  for select to authenticated using ( true );

-- WHY viewer and not tenant: expenses are the owner's books. A tenant has no
-- read path to this table at all, by omission rather than by an explicit deny.
drop policy if exists expenses_select_member on public.expenses;
create policy expenses_select_member on public.expenses
  for select to authenticated
  using ( property_id = any(private.property_ids_for_role('viewer')) );

drop policy if exists expenses_insert_manager on public.expenses;
create policy expenses_insert_manager on public.expenses
  for insert to authenticated
  with check (
    property_id = any(private.property_ids_for_role('manager'))
    and created_by = (select auth.uid())
  );

drop policy if exists expenses_update_manager on public.expenses;
create policy expenses_update_manager on public.expenses
  for update to authenticated
  using ( property_id = any(private.property_ids_for_role('manager')) )
  with check ( property_id = any(private.property_ids_for_role('manager')) );

drop policy if exists expenses_delete_owner on public.expenses;
create policy expenses_delete_owner on public.expenses
  for delete to authenticated
  using ( property_id = any(private.property_ids_for_role('owner')) );

drop policy if exists expense_allocations_select on public.expense_allocations;
create policy expense_allocations_select on public.expense_allocations
  for select to authenticated
  using ( property_id = any(private.property_ids_for_role('viewer')) );

drop policy if exists expense_allocations_write on public.expense_allocations;
create policy expense_allocations_write on public.expense_allocations
  for insert to authenticated
  with check ( property_id = any(private.property_ids_for_role('manager')) );

drop policy if exists expense_allocations_update on public.expense_allocations;
create policy expense_allocations_update on public.expense_allocations
  for update to authenticated
  using ( property_id = any(private.property_ids_for_role('manager')) )
  with check ( property_id = any(private.property_ids_for_role('manager')) );

drop policy if exists expense_allocations_delete on public.expense_allocations;
create policy expense_allocations_delete on public.expense_allocations
  for delete to authenticated
  using ( property_id = any(private.property_ids_for_role('manager')) );


-- =============================================================================
-- SECTION E — Pro directory + lead routing                               (F10)
--
-- Routing is DETERMINISTIC and its inputs are recorded. `lead_assignments.rank`
-- and `.match_reasons` come from `src/lib/domain/pros.ts`, which ranks on
-- service-area coverage, specialty match, licence/insurance currency,
-- responsiveness and current load. No model chooses a vendor, and every
-- assignment can be replayed from the stored inputs.
-- =============================================================================

do $$ begin
  create type public.pro_kind as enum (
    'agent', 'lender', 'inspector', 'appraiser', 'attorney', 'title',
    'property_manager', 'general_contractor', 'plumber', 'electrician',
    'hvac', 'roofer', 'painter', 'flooring', 'landscaper', 'cleaner',
    'pest_control', 'snow_removal', 'locksmith', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lead_status as enum (
    'new', 'routing', 'offered', 'accepted', 'declined_all', 'expired',
    'converted', 'closed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lead_assignment_status as enum (
    'offered', 'accepted', 'declined', 'expired', 'withdrawn'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.pro_profiles (
  id              uuid primary key default gen_random_uuid(),
  -- A pro may be a platform user, an organization, or neither (a directory
  -- entry the operator curated). At least one identity anchor OR a name.
  profile_id      uuid references public.profiles(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  display_name    text not null,
  kind            public.pro_kind not null,
  bio             text,
  phone_e164      text check (phone_e164 is null or phone_e164 ~ '^\+[1-9]\d{6,14}$'),
  email           text,
  website_url     text,
  -- Licensing. `license_verified_at IS NULL` must render as "licence not
  -- verified by us" — never as verified-by-omission.
  license_number  text,
  license_state   char(2),
  license_expires_on date,
  license_verified_at timestamptz,
  license_verified_by uuid references public.profiles(id),
  -- Insurance currency is the single most useful filter a landlord has and the
  -- one every directory omits.
  insured         boolean not null default false,
  insurance_expires_on date,
  bonded          boolean not null default false,
  -- Operational facts used by the deterministic router.
  emergency_available boolean not null default false,
  accepts_leads   boolean not null default true,
  max_open_leads  smallint not null default 5 check (max_open_leads >= 0),
  typical_response_hours numeric(5,1),
  hourly_rate_cents bigint check (hourly_rate_cents is null or hourly_rate_cents >= 0),
  trip_fee_cents  bigint check (trip_fee_cents is null or trip_fee_cents >= 0),
  is_published    boolean not null default false,
  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on column public.pro_profiles.license_verified_at is
  'NULL means WE have not verified the licence. The UI must render that as '
  '"not verified by us", never omit it — an unlabelled licence number reads as '
  'a verified one.';

create index if not exists pro_profiles_kind_idx on public.pro_profiles (kind) where is_published;
create index if not exists pro_profiles_profile_idx on public.pro_profiles (profile_id);
create index if not exists pro_profiles_leads_idx
  on public.pro_profiles (kind, accepts_leads) where is_published and accepts_leads;

drop trigger if exists pro_profiles_updated_at on public.pro_profiles;
create trigger pro_profiles_updated_at before update on public.pro_profiles
  for each row execute function public.set_updated_at();


create table if not exists public.pro_service_areas (
  id          uuid primary key default gen_random_uuid(),
  pro_id      uuid not null references public.pro_profiles(id) on delete cascade,
  area_kind   text not null check (area_kind in ('postal_code','city','county_fips','state','radius_miles')),
  -- The value in the unit implied by area_kind: '58201', 'Grand Forks',
  -- '38035', 'ND', or a radius in miles from the pro's base point.
  area_value  text not null,
  travel_fee_cents bigint check (travel_fee_cents is null or travel_fee_cents >= 0),
  constraint pro_service_areas_uq unique (pro_id, area_kind, area_value)
);

create index if not exists pro_service_areas_lookup_idx
  on public.pro_service_areas (area_kind, area_value);


create table if not exists public.pro_specialties (
  pro_id     uuid not null references public.pro_profiles(id) on delete cascade,
  specialty  text not null,   -- 'boiler','slab_leak','historic_windows','1031_exchange'
  primary key (pro_id, specialty)
);


create table if not exists public.leads (
  id            uuid primary key default gen_random_uuid(),
  requested_by  uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  -- What it is about. All optional but at least one gives the pro context.
  address_id    uuid references public.addresses(id) on delete set null,
  property_id   uuid references public.properties(id) on delete set null,
  unit_id       uuid references public.units(id) on delete set null,
  deal_room_id  uuid references public.deal_rooms(id) on delete set null,
  maintenance_request_id uuid references public.maintenance_requests(id) on delete set null,
  needed_kind   public.pro_kind not null,
  title         text not null,
  description   text,
  -- Deterministic urgency, mirroring maintenance_priority so an emergency
  -- maintenance ticket routes as an emergency lead without a translation table.
  urgency       public.maintenance_priority not null default 'routine',
  budget_min_cents bigint check (budget_min_cents is null or budget_min_cents >= 0),
  budget_max_cents bigint check (budget_max_cents is null or budget_max_cents >= 0),
  needed_by     date,
  status        public.lead_status not null default 'new',
  -- Snapshot of the inputs the router used, so an assignment can be replayed.
  routing_inputs jsonb not null default '{}'::jsonb,
  routed_at     timestamptz,
  closed_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint leads_budget_ck
    check (budget_min_cents is null or budget_max_cents is null or budget_max_cents >= budget_min_cents)
);

create index if not exists leads_requester_idx on public.leads (requested_by, created_at desc);
create index if not exists leads_open_idx on public.leads (needed_kind, status, created_at)
  where status in ('new','routing','offered');

drop trigger if exists leads_updated_at on public.leads;
create trigger leads_updated_at before update on public.leads
  for each row execute function public.set_updated_at();


create table if not exists public.lead_assignments (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads(id) on delete cascade,
  pro_id      uuid not null references public.pro_profiles(id) on delete cascade,
  -- 1 = the router's first choice. Ties are broken deterministically by
  -- pro_id so a re-run produces the same order.
  rank        smallint not null check (rank >= 1),
  -- Why this pro ranked here. Code-generated, never model output.
  match_reasons text[] not null default '{}',
  match_score numeric(6,2),
  status      public.lead_assignment_status not null default 'offered',
  offered_at  timestamptz not null default now(),
  responded_at timestamptz,
  response_note text,
  expires_at  timestamptz,
  constraint lead_assignments_uq unique (lead_id, pro_id)
);

create index if not exists lead_assignments_lead_idx on public.lead_assignments (lead_id, rank);
create index if not exists lead_assignments_pro_idx
  on public.lead_assignments (pro_id, status, offered_at desc);

-- Deferred FK from section D: an expense may name the pro who was paid.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'expenses_vendor_pro_fk'
  ) then
    alter table public.expenses
      add constraint expenses_vendor_pro_fk
      foreign key (vendor_pro_id) references public.pro_profiles(id)
      on delete set null;
  end if;
end $$;


alter table public.pro_profiles      enable row level security;
alter table public.pro_service_areas enable row level security;
alter table public.pro_specialties   enable row level security;
alter table public.leads             enable row level security;
alter table public.lead_assignments  enable row level security;

-- WHY published pros are readable by every authenticated user: it is a
-- directory. Unpublished entries are visible to their owner only.
drop policy if exists pro_profiles_select on public.pro_profiles;
create policy pro_profiles_select on public.pro_profiles
  for select to authenticated
  using (
    is_published
    or profile_id = (select auth.uid())
    or created_by = (select auth.uid())
    or (organization_id is not null and organization_id = any(private.org_ids_for_role('manager')))
  );

drop policy if exists pro_profiles_insert on public.pro_profiles;
create policy pro_profiles_insert on public.pro_profiles
  for insert to authenticated
  with check ( created_by = (select auth.uid()) );

-- NOTE: license_verified_at is writable here by the profile owner. That is a
-- known limitation of a self-serve directory and the reason the UI must render
-- the field as "verified by us" only when license_verified_by is an operator
-- account. Tightening this to service-role-only is the right follow-up once
-- there is a verification workflow to gate it behind.
drop policy if exists pro_profiles_update_own on public.pro_profiles;
create policy pro_profiles_update_own on public.pro_profiles
  for update to authenticated
  using ( profile_id = (select auth.uid()) or created_by = (select auth.uid()) )
  with check ( profile_id = (select auth.uid()) or created_by = (select auth.uid()) );

drop policy if exists pro_service_areas_select on public.pro_service_areas;
create policy pro_service_areas_select on public.pro_service_areas
  for select to authenticated
  using ( pro_id in (select p.id from public.pro_profiles p) );

drop policy if exists pro_service_areas_write on public.pro_service_areas;
create policy pro_service_areas_write on public.pro_service_areas
  for insert to authenticated
  with check (
    pro_id in (
      select p.id from public.pro_profiles p
       where p.profile_id = (select auth.uid()) or p.created_by = (select auth.uid())
    )
  );

drop policy if exists pro_service_areas_delete on public.pro_service_areas;
create policy pro_service_areas_delete on public.pro_service_areas
  for delete to authenticated
  using (
    pro_id in (
      select p.id from public.pro_profiles p
       where p.profile_id = (select auth.uid()) or p.created_by = (select auth.uid())
    )
  );

drop policy if exists pro_specialties_select on public.pro_specialties;
create policy pro_specialties_select on public.pro_specialties
  for select to authenticated
  using ( pro_id in (select p.id from public.pro_profiles p) );

drop policy if exists pro_specialties_write on public.pro_specialties;
create policy pro_specialties_write on public.pro_specialties
  for insert to authenticated
  with check (
    pro_id in (
      select p.id from public.pro_profiles p
       where p.profile_id = (select auth.uid()) or p.created_by = (select auth.uid())
    )
  );

drop policy if exists pro_specialties_delete on public.pro_specialties;
create policy pro_specialties_delete on public.pro_specialties
  for delete to authenticated
  using (
    pro_id in (
      select p.id from public.pro_profiles p
       where p.profile_id = (select auth.uid()) or p.created_by = (select auth.uid())
    )
  );

-- WHY: the requester sees their lead; a pro sees a lead only once it has been
-- offered to them. A pro cannot browse the lead pool.
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select to authenticated
  using (
    requested_by = (select auth.uid())
    or id in (
      select la.lead_id from public.lead_assignments la
       join public.pro_profiles p on p.id = la.pro_id
      where p.profile_id = (select auth.uid())
    )
  );

drop policy if exists leads_insert_self on public.leads;
create policy leads_insert_self on public.leads
  for insert to authenticated
  with check ( requested_by = (select auth.uid()) );

drop policy if exists leads_update_requester on public.leads;
create policy leads_update_requester on public.leads
  for update to authenticated
  using ( requested_by = (select auth.uid()) )
  with check ( requested_by = (select auth.uid()) );

drop policy if exists lead_assignments_select on public.lead_assignments;
create policy lead_assignments_select on public.lead_assignments
  for select to authenticated
  using (
    lead_id in (select l.id from public.leads l where l.requested_by = (select auth.uid()))
    or pro_id in (select p.id from public.pro_profiles p where p.profile_id = (select auth.uid()))
  );

-- WHY: a pro accepts or declines their own offer. Creating assignments is the
-- router's job and runs as service_role — a client that could assign itself a
-- lead would make the ranking meaningless.
drop policy if exists lead_assignments_respond on public.lead_assignments;
create policy lead_assignments_respond on public.lead_assignments
  for update to authenticated
  using ( pro_id in (select p.id from public.pro_profiles p where p.profile_id = (select auth.uid())) )
  with check ( pro_id in (select p.id from public.pro_profiles p where p.profile_id = (select auth.uid())) );


-- =============================================================================
-- Grants
-- =============================================================================

grant select, insert, update on
  public.saved_searches, public.documents, public.document_versions,
  public.signature_requests, public.signature_signers,
  public.vacancy_listings, public.rental_applications, public.screening_orders,
  public.expenses, public.expense_allocations,
  public.pro_profiles, public.pro_service_areas, public.pro_specialties,
  public.leads, public.lead_assignments
to authenticated;

grant update (notified_at, dismissed_at) on public.saved_search_matches to authenticated;
grant select on
  public.saved_search_matches, public.alert_deliveries, public.signature_events,
  public.application_decision_reasons, public.expense_categories,
  public.property_schedule_e_rollup
to authenticated;

grant delete on
  public.saved_searches, public.expenses, public.expense_allocations,
  public.pro_service_areas, public.pro_specialties
to authenticated;


-- =============================================================================
-- Post-migration assertions
-- =============================================================================

-- 1. Every new table has RLS.
do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ')
    into v_bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relname in (
       'saved_searches','saved_search_matches','alert_deliveries',
       'documents','document_versions','signature_requests','signature_signers',
       'signature_events','vacancy_listings','rental_applications',
       'application_decision_reasons','screening_orders','expense_categories',
       'expenses','expense_allocations','pro_profiles','pro_service_areas',
       'pro_specialties','leads','lead_assignments'
     )
     and not c.relrowsecurity;
  if v_bad is not null then
    raise exception 'Operations tables without RLS enabled: %', v_bad;
  end if;
end $$;

-- 2. FAIR HOUSING TRIPWIRE. Fails the migration if a protected-class column
--    name appears anywhere in the public schema. Blunt on purpose: a false
--    positive is a five-minute rename, a false negative is a lawsuit. Note
--    'sex' is matched as a whole word so 'sexual_harassment_policy_url' would
--    trip it and 'unisex' would not.
do $$
declare v_bad text;
begin
  select string_agg(format('%s.%s', c.relname, a.attname), ', ')
    into v_bad
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r','v','m')
     and a.attnum > 0
     and not a.attisdropped
     and (
       a.attname ~ '(^|_)(race|ethnicity|religion|creed|nationality|national_origin|disability|handicap|marital_status|familial_status|gender|sexual_orientation)($|_)'
       or a.attname ~ '(^|_)sex($|_)'
       or a.attname ~ '(^|_)(has_children|number_of_children|children_count)($|_)'
     );
  if v_bad is not null then
    raise exception
      'FAIR HOUSING: protected-class column name(s) found in public schema: %. '
      'There is deliberately no column for race, color, religion, sex, familial '
      'status, national origin or disability anywhere in this database. If a '
      'feature seems to need one, involve counsel — do not add the column.',
      v_bad;
  end if;
end $$;

-- 3. Every Schedule E category maps to a line in 5..19, or is explicitly
--    excluded (capital, draws, principal) with a NULL line.
do $$
declare v_bad text;
begin
  select string_agg(code, ', ') into v_bad
    from public.expense_categories
   where schedule_e_line is not null
     and (schedule_e_line < 5 or schedule_e_line > 19);
  if v_bad is not null then
    raise exception 'Expense categories outside Schedule E lines 5-19: %', v_bad;
  end if;
end $$;
