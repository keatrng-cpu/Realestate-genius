-- =============================================================================
-- Realestate Genius — complete Postgres / Supabase schema
-- Target: Supabase project "Realestate Genius" (ref xgqhqwxlpwncfcvmywtb),
--         AWS ca-central-1, Postgres 17.
--
-- Ellingson Estates LLC / VitaForge Holdings — Grand Forks & Fargo, ND
--
-- HOW TO RUN
--   Split into ordered migration files under supabase/migrations/ (see the
--   section markers). Running this file top-to-bottom in one transaction also
--   works on an empty database.
--
-- DESIGN RULES THIS SCHEMA ENFORCES (carried over from
-- vitaforge-property-alerts and made structural rather than conventional):
--
--   1. MONEY IS INTEGER CENTS. No float, no numeric-with-implicit-rounding.
--      Every monetary column is `bigint` named `*_cents`, paired with a
--      currency code. Rounding happens once, at display time, in the client.
--
--   2. THE AI NEVER COMPUTES A NUMBER. Tables that hold model output
--      (photo_analyses, ai_runs) hold ONLY classifications, booleans, enums and
--      prose. Tables that hold numbers (analyses, analysis_factors,
--      ledger_postings) are written exclusively by deterministic code. A CHECK
--      constraint and a trigger make the violation loud rather than silent.
--
--   3. EVERY FACT CARRIES PROVENANCE. `property_facts` cannot be inserted
--      without a source_id and an observed_at. "Where did this number come
--      from" must always be answerable — it is the difference between a
--      defensible product and a liability.
--
--   4. FAIR-HOUSING SENSITIVE ATTRIBUTES ARE SEGREGATED AND FLAGGED.
--      See section 9. There is no column anywhere in this schema for a
--      person's race, color, religion, sex, familial status, national origin,
--      or disability. That is deliberate and must stay true.
--
--   5. RLS IS DENY-BY-DEFAULT. Every table gets `enable row level security`
--      with no permissive policy until one is written explicitly below.
--      `service_role` bypasses RLS — that is how the ingestion pipeline writes.
-- =============================================================================


-- =============================================================================
-- SECTION 0 — Extensions, schemas, conventions
-- =============================================================================

create extension if not exists "pgcrypto"  with schema extensions;  -- gen_random_uuid, digest
create extension if not exists "postgis"   with schema extensions;  -- parcel/zoning polygons, point-in-polygon
create extension if not exists "pg_trgm"   with schema extensions;  -- fuzzy address search
create extension if not exists "btree_gist" with schema extensions; -- exclusion constraint on lease date ranges

-- `private` holds SECURITY DEFINER helper functions used inside RLS policies.
-- Nothing in here is exposed through PostgREST (it is not in the API search
-- path), so these functions are not callable by clients directly.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- `app` holds internal machinery (job state, webhook dedup) that clients never
-- touch. Also not exposed via PostgREST.
create schema if not exists app;
revoke all on schema app from public, anon, authenticated;


-- Standard updated_at trigger.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- -----------------------------------------------------------------------------
-- Enumerated vocabularies
-- -----------------------------------------------------------------------------

-- Contextual roles. NOTE: role is per-property, never global. The same person
-- is a landlord at one address and a tenant at another; a global `users.role`
-- column would be wrong and would leak access across contexts.
create type public.property_role as enum (
  'owner',        -- can do anything incl. delete, payouts, invite others
  'manager',      -- day-to-day: leases, maintenance, messaging. No payout/bank changes.
  'maintenance',  -- sees maintenance requests + unit access info only
  'viewer'        -- read-only (accountant, lender, spouse)
);

create type public.lease_status as enum (
  'draft', 'pending_signature', 'active', 'ending', 'ended', 'terminated', 'void'
);

create type public.unit_status as enum (
  'occupied', 'vacant', 'turning', 'off_market', 'owner_occupied'
);

create type public.listing_kind as enum ('for_sale', 'for_rent', 'sold', 'off_market');

create type public.listing_status as enum (
  'active', 'pending', 'contingent', 'coming_soon', 'withdrawn', 'expired', 'closed'
);

create type public.maintenance_status as enum (
  'submitted', 'acknowledged', 'scheduled', 'in_progress',
  'awaiting_parts', 'completed', 'cancelled', 'rejected'
);

create type public.maintenance_priority as enum (
  'emergency',   -- habitability / safety: no heat in winter, gas, sewage, no water
  'urgent',      -- 24-72h
  'routine',     -- normal queue
  'cosmetic'
);

create type public.payment_status as enum (
  'scheduled', 'processing', 'succeeded', 'failed', 'refunded',
  'disputed', 'canceled', 'requires_action'
);

create type public.invoice_status as enum (
  'draft', 'open', 'partially_paid', 'paid', 'void', 'uncollectible'
);

create type public.charge_kind as enum (
  'rent', 'late_fee', 'utility', 'pet_rent', 'parking',
  'security_deposit', 'damage', 'other_credit', 'other_debit'
);

create type public.analysis_audience as enum (
  'investor',   -- Keat's own buy-box; may use every factor
  'consumer'    -- shown to ordinary buyers/renters; fair-housing constrained
);

create type public.confidence as enum ('observed', 'derived', 'estimated', 'unverified');

create type public.message_author_kind as enum ('user', 'assistant', 'system');

create type public.ai_disposition as enum (
  'answered', 'declined_out_of_scope', 'escalated_to_human',
  'declined_legal_advice', 'declined_fair_housing'
);


-- =============================================================================
-- SECTION 1 — Identity, organizations, membership
-- =============================================================================

-- Mirrors auth.users. Supabase convention: never FK application data to
-- auth.users directly from many tables — go through profiles so the app owns
-- its own user surface.
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text,
  display_name  text,
  phone_e164    text check (phone_e164 is null or phone_e164 ~ '^\+[1-9]\d{6,14}$'),
  avatar_path   text,                         -- Supabase Storage object path
  locale        text not null default 'en-US',
  timezone      text not null default 'America/Chicago',
  -- Notification prefs live here rather than a side table; small and always read
  -- with the profile.
  notify_email  boolean not null default true,
  notify_sms    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.profiles is
  'Application-side user record. Deliberately contains NO protected-class '
  'attributes (race, color, religion, sex, familial status, national origin, '
  'disability). Adding such a column would create direct Fair Housing Act '
  'exposure — do not.';

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row when a user signs up.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, display_name)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();


-- An operating entity. Keat's properties belong to Ellingson Estates LLC;
-- a solo landlord with one duplex gets an implicit personal org.
create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  legal_name    text,
  ein_last4     text check (ein_last4 is null or ein_last4 ~ '^\d{4}$'),  -- never the full EIN
  is_personal   boolean not null default false,
  created_by    uuid not null references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  role            public.property_role not null default 'viewer',
  invited_by      uuid references public.profiles(id),
  accepted_at     timestamptz,
  created_at      timestamptz not null default now(),
  primary key (organization_id, profile_id)
);
create index organization_members_profile_idx on public.organization_members (profile_id);


-- =============================================================================
-- SECTION 2 — Canonical address + parcel spine
--
-- The dedup anchor. `vitaforge-property-alerts/lib/dedup.js` normalizes an
-- address string in JS; here that normalized form becomes a first-class row
-- with a unique constraint, so "the same house seen by 4 sources" is one row
-- by construction rather than by convention.
-- =============================================================================

create table public.addresses (
  id                  uuid primary key default gen_random_uuid(),
  -- Output of normalizeAddress() from lib/dedup.js, PLUS zip. This is the
  -- dedup key. Uppercase, punctuation stripped, suffixes/directionals
  -- canonicalized. Unit designators are NOT stripped (see dedup.js rationale:
  -- merging two units of a duplex would be worse than duplicating them).
  normalized_key      text not null,
  line1               text not null,
  line2               text,
  city                text not null,
  state               char(2) not null,
  postal_code         text not null,
  county_fips         char(5),
  -- WGS84. Populated from the source feed, or by lib/geocode.js (US Census
  -- geocoder — free, no key).
  geom                extensions.geography(Point, 4326),
  geocode_source      text,                  -- 'census' | 'source_feed' | 'manual' | 'mapbox'
  geocode_accuracy    text,                  -- 'rooftop' | 'interpolated' | 'centroid'
  census_tract_geoid  char(11),              -- for ACS joins; see FAIR HOUSING note in section 9
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint addresses_normalized_key_uq unique (normalized_key, postal_code)
);
create index addresses_geom_idx    on public.addresses using gist (geom);
create index addresses_trgm_idx    on public.addresses using gin (line1 extensions.gin_trgm_ops);
create index addresses_city_st_idx on public.addresses (state, city);
create trigger addresses_updated_at before update on public.addresses
  for each row execute function public.set_updated_at();

-- County assessor / GIS parcel. One address may map to one parcel; one parcel
-- may contain several addresses (a fourplex on one parcel).
create table public.parcels (
  id                    uuid primary key default gen_random_uuid(),
  apn                   text not null,            -- assessor parcel number as published
  county_fips           char(5) not null,
  legal_description     text,
  lot_size_sqft         bigint,
  lot_geom              extensions.geography(MultiPolygon, 4326),
  zoning_code_raw       text,                     -- verbatim from the county, e.g. 'R-2'
  zoning_district_id    uuid,                     -- resolved FK, set in section 5
  owner_name_public     text,                     -- public record; see privacy note below
  owner_mailing_zip     text,
  owner_occupied_flag   boolean,
  source_id             uuid not null,            -- FK added after data_sources exists
  source_record_id      text,
  observed_at           timestamptz not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint parcels_apn_uq unique (county_fips, apn)
);
comment on column public.parcels.owner_name_public is
  'Owner name as published in the county public record. This is lawfully public '
  'but aggregating it into a searchable people-index changes its character and '
  'can trigger state data-broker registration duties (e.g. CA/TX/OR/VT). Do NOT '
  'expose a reverse lookup (owner name -> all properties) to end users without '
  'counsel review. See OPEN_QUESTIONS.md.';
create index parcels_lot_geom_idx on public.parcels using gist (lot_geom);
create index parcels_zoning_idx   on public.parcels (zoning_district_id);
create trigger parcels_updated_at before update on public.parcels
  for each row execute function public.set_updated_at();

create table public.address_parcels (
  address_id uuid not null references public.addresses(id) on delete cascade,
  parcel_id  uuid not null references public.parcels(id)  on delete cascade,
  is_primary boolean not null default true,
  primary key (address_id, parcel_id)
);
create index address_parcels_parcel_idx on public.address_parcels (parcel_id);


-- =============================================================================
-- SECTION 3 — Data source registry + provenance
--
-- Every external source is a row. This is not bookkeeping — it is the control
-- surface for the legal risk in DATA_SOURCES.md. `tos_risk` and
-- `redistribution_allowed` are read at query time to decide what may be shown
-- to a user vs. used only for internal scoring.
-- =============================================================================

create table public.data_sources (
  id                      uuid primary key default gen_random_uuid(),
  slug                    text not null unique,           -- 'fema_nfhl', 'rentcast', 'gfbmls_reso'
  display_name            text not null,
  category                text not null,                  -- 'government'|'commercial_api'|'mls'|'scrape'|'user_supplied'
  access_method           text not null,                  -- 'rest'|'arcgis'|'reso_web_api'|'browser_automation'|'file_download'
  -- Legal posture. Set deliberately, reviewed with counsel, not guessed.
  tos_risk                text not null default 'unreviewed'
                          check (tos_risk in ('none','low','medium','high','prohibited','unreviewed')),
  redistribution_allowed  boolean not null default false, -- may raw values be shown to an end user?
  attribution_required    text,                           -- exact attribution string if required
  license_note            text,
  cost_note               text,
  rate_limit_note         text,
  is_enabled              boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
comment on column public.data_sources.redistribution_allowed is
  'FALSE means the data may be used to compute a derived signal but its raw '
  'values must never be rendered to an end user. The API layer MUST filter on '
  'this. Several MLS/IDX and scraped sources fall here.';
create trigger data_sources_updated_at before update on public.data_sources
  for each row execute function public.set_updated_at();

alter table public.parcels
  add constraint parcels_source_fk foreign key (source_id) references public.data_sources(id);

-- One row per pipeline execution. Lets you answer "what changed and when did
-- we last successfully read Grand Forks permits".
create table app.ingest_runs (
  id             uuid primary key default gen_random_uuid(),
  source_id      uuid not null references public.data_sources(id),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null default 'running'
                 check (status in ('running','succeeded','partial','failed')),
  records_seen   integer not null default 0,
  records_written integer not null default 0,
  error_text     text,
  meta           jsonb not null default '{}'::jsonb
);
create index ingest_runs_source_started_idx on app.ingest_runs (source_id, started_at desc);


-- =============================================================================
-- SECTION 4 — Property facts (the typed, provenanced fact store)
--
-- Rather than a 200-column `properties` table that is half-null for every row,
-- facts are rows. This is what makes "surface everything a buyer needs,
-- including the non-obvious" tractable: a new fact type is a new registry row,
-- not a migration.
--
-- Trade-off, stated plainly: querying is more awkward than a wide table, and
-- naive queries will be slow. Mitigation is section 4b — a materialized
-- current-facts view.
-- =============================================================================

create table public.fact_types (
  key                  text primary key,          -- 'year_built', 'roof_age_years', 'adu_permitted'
  display_name         text not null,
  value_type           text not null check (value_type in ('number','integer','money_cents','text','boolean','date','json')),
  unit                 text,                      -- 'sqft', 'years', 'usd_cents'
  category             text not null,             -- 'structure'|'financial'|'risk'|'legal'|'opportunity'|'location'
  -- FAIR HOUSING GATE. See section 9 and FEATURES.md.
  -- true  => may be DISPLAYED as neutral fact but may NEVER be an input to a
  --          ranking, score, or recommendation shown to a consumer.
  fair_housing_sensitive boolean not null default false,
  consumer_visible       boolean not null default true,
  description          text,
  created_at           timestamptz not null default now()
);

create table public.property_facts (
  id            bigint generated always as identity primary key,
  address_id    uuid not null references public.addresses(id) on delete cascade,
  fact_key      text not null references public.fact_types(key),
  -- Exactly one of these is populated, matching fact_types.value_type.
  value_number  double precision,
  value_int     bigint,
  value_money_cents bigint,
  value_text    text,
  value_bool    boolean,
  value_date    date,
  value_json    jsonb,
  -- Provenance is mandatory. No fact without a source and a timestamp.
  source_id     uuid not null references public.data_sources(id),
  source_url    text,
  observed_at   timestamptz not null,
  confidence    public.confidence not null default 'observed',
  ingest_run_id uuid references app.ingest_runs(id),
  superseded_at timestamptz,                       -- null = current
  created_at    timestamptz not null default now(),
  constraint property_facts_one_value_ck check (
    (value_number is not null)::int + (value_int is not null)::int +
    (value_money_cents is not null)::int + (value_text is not null)::int +
    (value_bool is not null)::int + (value_date is not null)::int +
    (value_json is not null)::int = 1
  )
);
create index property_facts_current_idx
  on public.property_facts (address_id, fact_key, observed_at desc)
  where superseded_at is null;
create index property_facts_key_idx on public.property_facts (fact_key) where superseded_at is null;
create index property_facts_source_idx on public.property_facts (source_id);

-- 4b — current facts, denormalized for read performance.
-- Refreshed concurrently by the ingest pipeline after each run.
create materialized view public.property_facts_current as
select distinct on (address_id, fact_key)
  address_id, fact_key, value_number, value_int, value_money_cents,
  value_text, value_bool, value_date, value_json,
  source_id, observed_at, confidence
from public.property_facts
where superseded_at is null
order by address_id, fact_key, observed_at desc;

create unique index property_facts_current_uq
  on public.property_facts_current (address_id, fact_key);


-- =============================================================================
-- SECTION 5 — Zoning, permits, hazards, opportunity signals
--
-- This is the "non-obvious" layer the product is actually differentiated on.
-- =============================================================================

create table public.zoning_districts (
  id                     uuid primary key default gen_random_uuid(),
  jurisdiction           text not null,          -- 'Grand Forks, ND'
  code                   text not null,          -- 'R-2'
  name                   text,
  geom                   extensions.geography(MultiPolygon, 4326),
  -- Structured rules. Parsed from the municipal code by a human or an AI
  -- EXTRACTION step whose output is reviewed — never inferred at query time.
  min_lot_area_sqft      integer,
  min_lot_width_ft       numeric(6,2),
  max_height_ft          numeric(6,2),
  max_density_units_per_acre numeric(8,3),
  front_setback_ft       numeric(6,2),
  side_setback_ft        numeric(6,2),
  rear_setback_ft        numeric(6,2),
  max_lot_coverage_pct   numeric(5,2),
  parking_spaces_per_unit numeric(4,2),
  adu_permitted          boolean,
  adu_conditions         text,
  permitted_uses         text[],
  conditional_uses       text[],
  -- Unrelated-occupancy cap. Grand Forks and Fargo both regulate this and it
  -- is the single biggest driver of room-rental math. MUST be verified against
  -- the current ordinance text, per source, with an effective date.
  max_unrelated_occupants integer,
  ordinance_citation     text not null,
  ordinance_url          text,
  ordinance_effective_on date,
  verified_by            uuid references public.profiles(id),
  verified_at            timestamptz,
  source_id              uuid not null references public.data_sources(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint zoning_districts_uq unique (jurisdiction, code, ordinance_effective_on)
);
comment on table public.zoning_districts is
  'Zoning rules are LAW, not data. Every row requires an ordinance citation and '
  'an effective date. A row with verified_at IS NULL must be surfaced to users '
  'as "unverified — confirm with the city" and must never drive a dollar figure.';
create index zoning_districts_geom_idx on public.zoning_districts using gist (geom);
create trigger zoning_districts_updated_at before update on public.zoning_districts
  for each row execute function public.set_updated_at();

alter table public.parcels
  add constraint parcels_zoning_fk foreign key (zoning_district_id)
  references public.zoning_districts(id);

create table public.permits (
  id                 uuid primary key default gen_random_uuid(),
  address_id         uuid references public.addresses(id) on delete set null,
  parcel_id          uuid references public.parcels(id)  on delete set null,
  jurisdiction       text not null,
  permit_number      text not null,
  permit_type        text,                       -- verbatim from the portal
  permit_type_norm   text,                       -- normalized: 'roof'|'electrical'|'hvac'|'addition'|'adu'|'plumbing'|'demo'|'solar'
  description        text,
  status             text,
  applied_on         date,
  issued_on          date,
  finaled_on         date,
  declared_value_cents bigint,
  contractor_name    text,
  source_id          uuid not null references public.data_sources(id),
  source_url         text,
  observed_at        timestamptz not null,
  created_at         timestamptz not null default now(),
  constraint permits_uq unique (jurisdiction, permit_number)
);
create index permits_address_idx on public.permits (address_id, issued_on desc);
create index permits_parcel_idx  on public.permits (parcel_id, issued_on desc);
create index permits_type_idx    on public.permits (permit_type_norm, issued_on desc);
comment on table public.permits is
  'Permit ABSENCE is as informative as presence: a 1962 house with no electrical '
  'permit ever pulled is a different risk than one rewired in 2019. But absence '
  'is only meaningful where portal coverage is known-complete — see '
  'data_sources.rate_limit_note and the coverage_start_date convention in '
  'DATA_SOURCES.md. Never render "no permits" without stating the coverage window.';

create table public.hazards (
  id            uuid primary key default gen_random_uuid(),
  address_id    uuid not null references public.addresses(id) on delete cascade,
  hazard_type   text not null,     -- 'fema_flood_zone'|'radon_zone'|'wildfire'|'seismic'|'nri_composite'
  -- Verbatim classification from the authority. For FEMA this is FLD_ZONE.
  classification text,
  sub_type      text,              -- FEMA ZONE_SUBTY
  numeric_value double precision,  -- e.g. NRI score
  is_high_risk  boolean,
  detail        jsonb not null default '{}'::jsonb,
  source_id     uuid not null references public.data_sources(id),
  observed_at   timestamptz not null,
  created_at    timestamptz not null default now(),
  constraint hazards_uq unique (address_id, hazard_type, observed_at)
);
create index hazards_address_type_idx on public.hazards (address_id, hazard_type, observed_at desc);
-- NOTE: `comment on ... is` takes a single string *constant*, so no `||`.
-- Postgres implicitly concatenates adjacent literals separated by a newline,
-- but an E'...' may only START such a sequence, never continue one — mixing
-- them is a syntax error. This comment needs real newlines, so it is written
-- as one single-line E-string rather than a wrapped sequence.
comment on table public.hazards is
  E'Mirrors lib/femaFloodCheck.js. TWO rules that must never be violated:\n  1. A FEMA query returning NO feature means "not in a detailed flood study", NOT "no flood risk". Store classification=NULL with detail->>''fema_status'' = ''UNMAPPED_OR_ZONE_X''.\n  2. sub_type IS LOAD-BEARING, especially in Grand Forks. A live query there returns FLD_ZONE="X" with ZONE_SUBTY="AREA WITH REDUCED FLOOD RISK DUE TO LEVEE". That is a levee-protected zone, not an absence of flood risk, in the city that flooded catastrophically in 1997. Rendering "Zone X — minimal risk" there would be actively misleading. Always surface sub_type alongside classification, and ingest the city''s own levee/floodwall layers (Grand Forks OpenDataLayers 17-23) as corroboration.';

-- Opportunity signals: ADU potential, lot split, rezoning, room-rental math.
-- These are DERIVED. The derivation is deterministic code; the row records the
-- inputs and the rule version so any number is reproducible and auditable.
create table public.opportunity_signals (
  id                uuid primary key default gen_random_uuid(),
  address_id        uuid not null references public.addresses(id) on delete cascade,
  signal_type       text not null,   -- 'adu_potential'|'lot_split'|'rezoning_candidate'|'room_rental'|'basement_conversion'
  -- Deterministic verdict.
  eligible          boolean,
  -- Every number below is computed by code, never by a model.
  headroom_value    numeric(14,4),   -- e.g. surplus lot sqft above the split minimum
  headroom_unit     text,
  estimated_value_cents bigint,
  -- The exact inputs used, so the calc can be replayed. e.g.
  -- {"lot_size_sqft":10800,"min_lot_area_sqft":5000,"zoning_code":"R-2"}
  inputs            jsonb not null,
  rule_id           text not null,   -- 'adu.gf.v1'
  rule_version      integer not null,
  blockers          text[] not null default '{}',   -- 'setback_fail','no_alley_access','below_min_width'
  -- AI may write ONLY this field: a plain-language explanation of the numbers
  -- above. It must not contain any figure not present in `inputs`/`headroom_*`.
  narrative         text,
  requires_verification boolean not null default true,
  computed_at       timestamptz not null default now(),
  constraint opportunity_signals_uq unique (address_id, signal_type, rule_id, rule_version)
);
create index opportunity_signals_addr_idx on public.opportunity_signals (address_id, signal_type);


-- =============================================================================
-- SECTION 6 — Listings (market observations) + dedup
--
-- Direct descendant of sources/tier1 + sources/tier2 and lib/dedup.js.
-- The JS `mergeListingRecords` field-priority merge becomes:
--   listing_observations  = one row per (source, listing) sighting  [raw]
--   listings              = the merged canonical record            [derived]
-- =============================================================================

create table public.listings (
  id                  uuid primary key default gen_random_uuid(),
  address_id          uuid not null references public.addresses(id) on delete cascade,
  kind                public.listing_kind not null,
  status              public.listing_status not null,
  price_cents         bigint check (price_cents is null or price_cents >= 0),
  currency            char(3) not null default 'USD',
  beds                smallint,
  baths_full          smallint,
  baths_partial       smallint,
  -- Generated, mirroring totalBaths() in lib/filters.js exactly.
  baths_total         numeric(4,1) generated always as
                        (coalesce(baths_full,0) + 0.5 * coalesce(baths_partial,0)) stored,
  sqft_total          integer,
  sqft_above_grade    integer,       -- scoring factor 5 uses THIS, not total
  lot_size_sqft       bigint,
  year_built          smallint,
  property_type       text,          -- 'Single Family'|'Duplex'|'Triplex'|'Fourplex'|'Multi-Family'|'Condo'|'Townhouse'
  garage_spaces       smallint,
  listed_on           date,
  days_on_market      integer,
  description_text    text,
  disclosure_text     text,
  -- Which sources confirmed this listing (mirrors `sources_confirmed`).
  source_slugs        text[] not null default '{}',
  first_seen_at       timestamptz not null default now(),
  first_seen_source   text,
  last_seen_at        timestamptz not null default now(),
  -- If the CANONICAL source forbids redistribution, the whole listing is
  -- internal-only. Checked by RLS below.
  redistributable     boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index listings_address_idx  on public.listings (address_id);
create index listings_active_idx   on public.listings (kind, status, last_seen_at desc)
                                    where status = 'active';
create index listings_price_idx    on public.listings (price_cents) where status = 'active';
create trigger listings_updated_at before update on public.listings
  for each row execute function public.set_updated_at();

create table public.listing_observations (
  id                uuid primary key default gen_random_uuid(),
  listing_id        uuid references public.listings(id) on delete cascade,
  address_id        uuid not null references public.addresses(id) on delete cascade,
  source_id         uuid not null references public.data_sources(id),
  source_listing_id text,                    -- MLS number, zpid, etc.
  source_url        text,
  raw               jsonb not null,          -- untouched payload; the audit trail
  observed_at       timestamptz not null,
  ingest_run_id     uuid references app.ingest_runs(id),
  created_at        timestamptz not null default now()
);
create index listing_obs_listing_idx on public.listing_observations (listing_id, observed_at desc);
create index listing_obs_source_idx  on public.listing_observations (source_id, observed_at desc);
create unique index listing_obs_dedup_uq
  on public.listing_observations (source_id, source_listing_id, observed_at)
  where source_listing_id is not null;

create table public.listing_price_history (
  id          bigint generated always as identity primary key,
  listing_id  uuid not null references public.listings(id) on delete cascade,
  price_cents bigint not null,
  effective_on date not null,
  source_id   uuid references public.data_sources(id),
  constraint listing_price_history_uq unique (listing_id, effective_on, price_cents)
);
create index listing_price_history_listing_idx
  on public.listing_price_history (listing_id, effective_on desc);

create table public.listing_photos (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references public.listings(id) on delete cascade,
  url          text not null,
  storage_path text,                 -- set only if we are permitted to cache it
  ordinal      smallint,
  caption      text,
  -- Photo copyright belongs to the photographer/broker. Hotlinking is usually
  -- tolerated; caching and re-serving usually is not. Default to not caching.
  cacheable    boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint listing_photos_uq unique (listing_id, url)
);

-- Assessments, kept separate from facts because the year dimension matters.
create table public.assessments (
  id                  uuid primary key default gen_random_uuid(),
  parcel_id           uuid not null references public.parcels(id) on delete cascade,
  tax_year            smallint not null,
  assessed_total_cents bigint,
  assessed_land_cents  bigint,
  assessed_improvement_cents bigint,
  market_value_cents   bigint,     -- if the county publishes a separate full-market value
  -- The ratio the county assesses at. lib/scoring.js hardcodes `assessed * 2`
  -- (a 50% ratio). THAT IS AN ASSUMPTION and it must become data — this column
  -- is where it lives. See OPEN_QUESTIONS.md #3.
  assessment_ratio     numeric(6,4),
  tax_billed_cents     bigint,
  mill_rate            numeric(10,6),
  homestead_credit_cents bigint,
  source_id           uuid not null references public.data_sources(id),
  observed_at         timestamptz not null,
  constraint assessments_uq unique (parcel_id, tax_year)
);
create index assessments_parcel_year_idx on public.assessments (parcel_id, tax_year desc);


-- =============================================================================
-- SECTION 7 — Scoring / analysis (the generalized engine)
--
-- The existing lib/scoring.js is one hardcoded profile: an investor buy-box for
-- Grand Forks. Here the WEIGHTS AND CURVES become data (scoring_profiles) while
-- the MATH stays deterministic code. That is the whole generalization:
--   - "Investor buy-box"    -> profile 'investor.gf.v1'  (the current 8 factors)
--   - "First-time buyer"    -> profile 'consumer.fthb.v1'
--   - "Renter fit"          -> profile 'consumer.rent.v1'
-- =============================================================================

create table public.scoring_factors (
  key            text primary key,        -- 'price_vs_assessed', 'dom_price_cuts'
  display_name   text not null,
  description    text not null,
  -- The deterministic function that implements it. Named, versioned, in code.
  impl_id        text not null,           -- 'scoring/priceVsAssessed'
  impl_version   integer not null default 1,
  -- CONSUMER SAFETY GATE. If false, this factor may never appear in an analysis
  -- with audience='consumer'. Enforced by trigger below.
  consumer_safe  boolean not null default false,
  -- Why it is or isn't consumer-safe. Required — forces the decision to be made
  -- explicitly rather than by default.
  safety_rationale text not null,
  created_at     timestamptz not null default now()
);

create table public.scoring_profiles (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null,                    -- 'investor.gf'
  version       integer not null,
  display_name  text not null,
  audience      public.analysis_audience not null,
  owner_id      uuid references public.profiles(id),   -- null = system profile
  -- Parameters only. Shape: {"factors":[{"key":"price_vs_assessed","weight":20,
  --   "params":{"full_points_at":0.85,"zero_points_at":1.15}}, ...],
  --   "thresholds":{"immediate":65,"digest":50}}
  -- No formulas, no expressions, no code. Code lives in the repo.
  config        jsonb not null,
  is_active     boolean not null default false,
  created_at    timestamptz not null default now(),
  constraint scoring_profiles_uq unique (slug, version)
);
comment on column public.scoring_profiles.config is
  'PARAMETERS ONLY. If you ever find yourself wanting to put an expression '
  'string here and eval it, stop: that reintroduces non-determinism and makes '
  'the score unauditable. Add a new impl_id in scoring_factors instead.';

create table public.analyses (
  id                  uuid primary key default gen_random_uuid(),
  address_id          uuid not null references public.addresses(id) on delete cascade,
  listing_id          uuid references public.listings(id) on delete set null,
  profile_id          uuid not null references public.scoring_profiles(id),
  audience            public.analysis_audience not null,
  requested_by        uuid references public.profiles(id),   -- null = pipeline-initiated
  -- Deterministic outputs.
  raw_score           numeric(7,2),     -- uncapped (garage bonus can exceed weight, per spec)
  display_score       smallint check (display_score between 0 and 100),
  tier                text check (tier in ('immediate_alert','daily_digest','below_threshold','n/a')),
  hard_filter_passed  boolean not null,
  hard_filter_reasons text[] not null default '{}',
  disqualified        boolean not null default false,
  disqualify_reasons  text[] not null default '{}',
  soft_flags          jsonb not null default '[]'::jsonb,
  -- Market context actually used (never fabricated — see lib/marketStats.js).
  area_median_price_per_sqft_cents bigint,
  area_median_sample_size integer,
  -- AI-authored, numbers-free explanation. Enforced by trigger below.
  narrative           text,
  narrative_model     text,
  engine_version      text not null,     -- git sha of the scoring code
  computed_at         timestamptz not null default now()
);
create index analyses_address_idx on public.analyses (address_id, computed_at desc);
create index analyses_listing_idx on public.analyses (listing_id, computed_at desc);
create index analyses_requester_idx on public.analyses (requested_by, computed_at desc);

create table public.analysis_factors (
  id           bigint generated always as identity primary key,
  analysis_id  uuid not null references public.analyses(id) on delete cascade,
  factor_key   text not null references public.scoring_factors(key),
  points       numeric(7,2) not null,
  max_points   numeric(7,2) not null,
  -- The inputs that produced `points`, so the number is reproducible.
  inputs       jsonb not null default '{}'::jsonb,
  -- Deterministic, code-generated note (e.g. "22% below assessed-value implied
  -- price"). NOT model output.
  note         text,
  caution      boolean not null default false,
  constraint analysis_factors_uq unique (analysis_id, factor_key)
);
create index analysis_factors_analysis_idx on public.analysis_factors (analysis_id);

-- ENFORCEMENT: a consumer-audience analysis may not contain a factor that is
-- not consumer_safe. This is the structural fair-housing guardrail — a
-- developer cannot accidentally ship a consumer ranking that includes, say, a
-- school-rating or neighborhood-demographic factor.
create or replace function private.enforce_consumer_safe_factors()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_audience public.analysis_audience;
  v_safe boolean;
begin
  select a.audience into v_audience from public.analyses a where a.id = new.analysis_id;
  if v_audience = 'consumer' then
    select f.consumer_safe into v_safe from public.scoring_factors f where f.key = new.factor_key;
    if not coalesce(v_safe, false) then
      raise exception
        'Factor "%" is not consumer_safe and cannot appear in a consumer-audience analysis (analysis %). See scoring_factors.safety_rationale.',
        new.factor_key, new.analysis_id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger analysis_factors_consumer_safe
  before insert or update on public.analysis_factors
  for each row execute function private.enforce_consumer_safe_factors();

-- ENFORCEMENT: the AI narrative must not introduce numbers. A model that
-- hallucinates "$34,000 of equity" into prose is exactly the failure mode this
-- codebase already forbids in lib/photoAnalysis.js. This trigger rejects any
-- narrative containing a currency amount or a percentage.
-- Deliberately blunt: it is better to force the writer to reference a computed
-- field than to allow a plausible-looking figure through.
create or replace function private.reject_numbers_in_narrative()
returns trigger
language plpgsql
as $$
begin
  if new.narrative is not null and new.narrative ~ '(\$\s?[0-9]|[0-9]\s?%|\b[0-9]{1,3}(,[0-9]{3})+\b)' then
    raise exception
      'analyses.narrative contains a numeric/currency literal. The AI layer explains, it never computes. Reference analysis_factors instead.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger analyses_narrative_no_numbers
  before insert or update of narrative on public.analyses
  for each row execute function private.reject_numbers_in_narrative();

-- Photo analysis output. Carries over lib/photoAnalysis.js verbatim in shape.
-- Booleans and enums only — no scores.
create table public.photo_analyses (
  id                              uuid primary key default gen_random_uuid(),
  listing_id                      uuid references public.listings(id) on delete cascade,
  address_id                      uuid not null references public.addresses(id) on delete cascade,
  photo_flags                     text[] not null default '{}',
  water_intrusion_pattern_suspected boolean not null default false,
  panel_appears_knob_and_tube     boolean not null default false,
  renovation_tier                 text check (renovation_tier in
                                    ('cosmetic_dated','move_in_ready','active_deterioration','unknown')),
  summary                         text,
  photos_analyzed                 smallint not null default 0,
  model                           text not null,
  model_refused                   boolean not null default false,
  analyzed_at                     timestamptz not null default now()
);
create index photo_analyses_listing_idx on public.photo_analyses (listing_id, analyzed_at desc);


-- =============================================================================
-- SECTION 8 — Managed portfolio: properties, units, leases
--
-- This is the ownership domain. `addresses` is the shared spine — a managed
-- property points at the same address row the market-intelligence side uses, so
-- a landlord automatically gets every fact, permit, hazard and comp the
-- pipeline knows about their own building. That is requirement B's "expose
-- every data point the system can pull about their property", achieved by
-- reference rather than by copying.
-- =============================================================================

create table public.properties (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  address_id       uuid not null references public.addresses(id) on delete restrict,
  nickname         text,
  property_type    text,
  unit_count       smallint not null default 1 check (unit_count > 0),
  acquired_on      date,
  purchase_price_cents bigint,
  -- Owner-supplied truth that beats any scraped value.
  owner_notes      text,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint properties_org_address_uq unique (organization_id, address_id)
);
create index properties_org_idx     on public.properties (organization_id) where archived_at is null;
create index properties_address_idx on public.properties (address_id);
create trigger properties_updated_at before update on public.properties
  for each row execute function public.set_updated_at();

-- Per-property ACL. Sits alongside organization_members: org membership grants
-- a default role across the org; a property_members row overrides it for one
-- property (e.g. a handyman who only sees 1512 5th Ave).
create table public.property_members (
  property_id  uuid not null references public.properties(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id)   on delete cascade,
  role         public.property_role not null,
  invited_by   uuid references public.profiles(id),
  accepted_at  timestamptz,
  created_at   timestamptz not null default now(),
  primary key (property_id, profile_id)
);
create index property_members_profile_idx on public.property_members (profile_id);

create table public.units (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.properties(id) on delete cascade,
  label         text not null,               -- 'Unit A', 'Upper', '1'
  beds          smallint,
  baths_full    smallint,
  baths_partial smallint,
  sqft          integer,
  status        public.unit_status not null default 'vacant',
  market_rent_cents bigint,
  -- Legally meaningful per-unit facts a landlord must be able to see and a
  -- tenant may need. Structured, not free text.
  has_egress_window boolean,
  heat_type     text,
  utilities_included text[] not null default '{}',
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint units_property_label_uq unique (property_id, label)
);
create index units_property_idx on public.units (property_id) where archived_at is null;
create trigger units_updated_at before update on public.units
  for each row execute function public.set_updated_at();

create table public.leases (
  id                  uuid primary key default gen_random_uuid(),
  unit_id             uuid not null references public.units(id) on delete restrict,
  status              public.lease_status not null default 'draft',
  starts_on           date not null,
  ends_on             date,                        -- null = month-to-month
  term                daterange generated always as
                        (daterange(starts_on, ends_on, '[)')) stored,
  rent_cents          bigint not null check (rent_cents >= 0),
  currency            char(3) not null default 'USD',
  rent_due_day        smallint not null default 1 check (rent_due_day between 1 and 28),
  -- ND: NDCC 47-16-07.1 caps the deposit at one month's rent for most tenancies
  -- (higher for certain pet/history cases) and requires return within 30 days
  -- of termination WITH an itemized statement. MN: Minn. Stat. 504B.178 —
  -- 21 days, plus interest. These deadlines are computed, not typed.
  -- VERIFY the current statute text before relying on either. See LEGAL notes.
  security_deposit_cents bigint not null default 0 check (security_deposit_cents >= 0),
  deposit_held_by     text not null default 'landlord'
                      check (deposit_held_by in ('landlord','platform_escrow','third_party')),
  late_fee_cents      bigint not null default 0,
  late_fee_grace_days smallint not null default 0,
  document_path       text,                        -- signed PDF in Storage
  signed_at           timestamptz,
  terminated_on       date,
  move_out_on         date,
  -- Deadline the software must enforce. Set on termination by trigger/job.
  deposit_return_due_on date,
  created_by          uuid not null references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint leases_dates_ck check (ends_on is null or ends_on > starts_on)
);
-- No two ACTIVE leases may overlap on the same unit. This is a correctness
-- guarantee the app layer should not be trusted with.
alter table public.leases add constraint leases_no_overlap
  exclude using gist (
    unit_id with =,
    term with &&
  ) where (status in ('active','ending','pending_signature'));
create index leases_unit_idx   on public.leases (unit_id, starts_on desc);
create index leases_status_idx on public.leases (status) where status in ('active','ending');
create trigger leases_updated_at before update on public.leases
  for each row execute function public.set_updated_at();

create table public.lease_tenants (
  lease_id     uuid not null references public.leases(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete restrict,
  is_primary   boolean not null default false,
  -- Tenant vs occupant matters legally: an occupant is not on the hook for rent.
  is_responsible_for_rent boolean not null default true,
  moved_in_on  date,
  moved_out_on date,
  invited_at   timestamptz,
  accepted_at  timestamptz,
  primary key (lease_id, profile_id)
);
create index lease_tenants_profile_idx on public.lease_tenants (profile_id);
-- Exactly one primary tenant per lease.
create unique index lease_tenants_one_primary_uq
  on public.lease_tenants (lease_id) where is_primary;


-- =============================================================================
-- SECTION 9 — Fair-housing / compliance surfaces
--
-- Restating the design rule in schema form:
--
--  * There is NO table and NO column anywhere for race, color, religion, sex,
--    familial status, national origin, or disability. Not on profiles, not on
--    lease_tenants, not in a jsonb blob. If a future feature seems to need one,
--    that is the moment to involve counsel, not to add the column.
--
--  * Census tract is stored on `addresses` because ACS data is genuinely useful
--    (median income for affordability math, commute times). But tract-level
--    demographics are a textbook proxy for protected class. Hence:
--       - fact_types.fair_housing_sensitive = true for anything demographic
--       - scoring_factors.consumer_safe = false for the same
--       - the analysis_factors trigger above makes it structurally impossible
--         to slip one into a consumer ranking
--
--  * School data: stored as a factual ATTENDANCE ASSIGNMENT plus raw published
--    NCES figures. A composite "school quality score" is deliberately absent.
--    Ranking homes by school rating is one of the best-documented disparate-
--    impact vectors in real-estate tech. Display, don't rank.
-- =============================================================================

create table public.schools (
  id            uuid primary key default gen_random_uuid(),
  nces_id       text unique,
  name          text not null,
  district_name text,
  level         text check (level in ('elementary','middle','high','other')),
  geom          extensions.geography(Point, 4326),
  source_id     uuid not null references public.data_sources(id),
  observed_at   timestamptz not null,
  created_at    timestamptz not null default now()
);

create table public.school_assignments (
  address_id  uuid not null references public.addresses(id) on delete cascade,
  school_id   uuid not null references public.schools(id)  on delete cascade,
  level       text not null,
  -- How this assignment was determined. 'boundary_polygon' is authoritative;
  -- 'nearest' is a guess and MUST be labeled as such in the UI.
  method      text not null check (method in ('boundary_polygon','district_published','nearest','unknown')),
  source_id   uuid not null references public.data_sources(id),
  observed_at timestamptz not null,
  primary key (address_id, school_id, level)
);
comment on table public.school_assignments is
  'Attendance assignment only. There is intentionally no rating/score column. '
  'Rendering a school "grade" and letting users sort by it is a recognized '
  'disparate-impact vector under the Fair Housing Act. Show the assigned school '
  'and link to the official source; do not rank.';

-- Immutable record of every consent the user gave. Needed for: ACH mandates
-- (NACHA authorization proof), e-sign, ToS, and the fair-housing / AI
-- disclosure the product must show before any ranked output.
create table public.consent_records (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  consent_type  text not null,     -- 'tos'|'privacy'|'ach_mandate'|'esign'|'ai_disclosure'|'screening'
  document_version text not null,
  document_hash text,              -- sha256 of the exact text shown
  consented_at  timestamptz not null default now(),
  ip_inet       inet,
  user_agent    text,
  -- What the consent attaches to (a lease, a payment method).
  subject_type  text,
  subject_id    uuid,
  revoked_at    timestamptz
);
create index consent_records_profile_idx on public.consent_records (profile_id, consent_type, consented_at desc);

-- Append-only audit log. Written by triggers on sensitive tables + by the API.
create table public.audit_log (
  id           bigint generated always as identity primary key,
  actor_id     uuid references public.profiles(id),
  actor_role   text,
  action       text not null,          -- 'lease.terminate','payment.refund','member.invite'
  subject_type text not null,
  subject_id   uuid,
  before       jsonb,
  after        jsonb,
  ip_inet      inet,
  created_at   timestamptz not null default now()
);
create index audit_log_subject_idx on public.audit_log (subject_type, subject_id, created_at desc);
create index audit_log_actor_idx   on public.audit_log (actor_id, created_at desc);


-- =============================================================================
-- SECTION 10 — Maintenance
-- =============================================================================

create table public.maintenance_requests (
  id             uuid primary key default gen_random_uuid(),
  unit_id        uuid not null references public.units(id) on delete cascade,
  lease_id       uuid references public.leases(id) on delete set null,
  reported_by    uuid not null references public.profiles(id),
  title          text not null,
  description    text,
  category       text,             -- 'plumbing'|'electrical'|'hvac'|'appliance'|'structural'|'pest'|'other'
  priority       public.maintenance_priority not null default 'routine',
  -- Set by deterministic rules (e.g. "no heat" + outside temp < 40F => emergency),
  -- optionally SUGGESTED by the AI triage step but always recorded separately so
  -- you can audit whether the model's suggestion was right.
  priority_suggested_by_ai public.maintenance_priority,
  status         public.maintenance_status not null default 'submitted',
  -- Habitability clock. ND and MN both impose "reasonable time" duties with
  -- different teeth; emergency items need a documented response time.
  acknowledged_at timestamptz,
  scheduled_for  timestamptz,
  completed_at   timestamptz,
  entry_permission_granted boolean,
  entry_notes    text,
  assigned_to    uuid references public.profiles(id),
  vendor_name    text,
  cost_cents     bigint,
  -- Whether the tenant is being charged (damage vs normal wear).
  chargeable_to_tenant boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index maint_unit_status_idx  on public.maintenance_requests (unit_id, status, created_at desc);
create index maint_reporter_idx     on public.maintenance_requests (reported_by, created_at desc);
create index maint_open_idx         on public.maintenance_requests (status, priority, created_at)
                                     where status not in ('completed','cancelled','rejected');
create trigger maintenance_requests_updated_at before update on public.maintenance_requests
  for each row execute function public.set_updated_at();

create table public.maintenance_events (
  id           bigint generated always as identity primary key,
  request_id   uuid not null references public.maintenance_requests(id) on delete cascade,
  actor_id     uuid references public.profiles(id),
  from_status  public.maintenance_status,
  to_status    public.maintenance_status,
  note         text,
  created_at   timestamptz not null default now()
);
create index maintenance_events_request_idx on public.maintenance_events (request_id, created_at);

create table public.maintenance_attachments (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.maintenance_requests(id) on delete cascade,
  uploaded_by  uuid not null references public.profiles(id),
  storage_path text not null,          -- bucket 'maintenance', path <property_id>/<request_id>/<uuid>
  mime_type    text not null,
  size_bytes   bigint not null check (size_bytes > 0 and size_bytes <= 26214400), -- 25 MB
  width        integer,
  height       integer,
  -- Optional AI classification of the photo (what is broken). Classification
  -- only — never a repair cost.
  ai_labels    text[] not null default '{}',
  ai_model     text,
  created_at   timestamptz not null default now()
);
create index maintenance_attachments_request_idx on public.maintenance_attachments (request_id);


-- =============================================================================
-- SECTION 11 — Messaging + AI assistant
-- =============================================================================

create table public.conversations (
  id            uuid primary key default gen_random_uuid(),
  -- Scope. A conversation belongs to a lease (landlord<->tenant), a
  -- maintenance request, or a property (landlord<->manager).
  scope_type    text not null check (scope_type in ('lease','maintenance_request','property')),
  lease_id      uuid references public.leases(id) on delete cascade,
  maintenance_request_id uuid references public.maintenance_requests(id) on delete cascade,
  property_id   uuid references public.properties(id) on delete cascade,
  subject       text,
  -- Realtime topic. Clients subscribe to `conv:<id>` as a PRIVATE channel; the
  -- RLS policy on realtime.messages (section 14) gates it.
  topic         text generated always as ('conv:' || id::text) stored,
  last_message_at timestamptz,
  closed_at     timestamptz,
  created_at    timestamptz not null default now(),
  constraint conversations_scope_ck check (
    (scope_type = 'lease'               and lease_id is not null) or
    (scope_type = 'maintenance_request' and maintenance_request_id is not null) or
    (scope_type = 'property'            and property_id is not null)
  )
);
create index conversations_lease_idx    on public.conversations (lease_id);
create index conversations_maint_idx    on public.conversations (maintenance_request_id);
create index conversations_property_idx on public.conversations (property_id);
create unique index conversations_topic_uq on public.conversations (topic);

create table public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  -- Their role IN THIS THREAD, which may differ from their property role.
  participant_role text not null check (participant_role in ('landlord','tenant','manager','maintenance','observer')),
  last_read_at    timestamptz,
  muted           boolean not null default false,
  joined_at       timestamptz not null default now(),
  left_at         timestamptz,
  primary key (conversation_id, profile_id)
);
create index conversation_participants_profile_idx
  on public.conversation_participants (profile_id) where left_at is null;

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  author_kind     public.message_author_kind not null default 'user',
  author_id       uuid references public.profiles(id),      -- null when author_kind='assistant'
  body            text,
  -- If the assistant wrote this, which run produced it (for audit).
  ai_run_id       uuid,
  -- Visibility: an assistant reply can be addressed to one party only (e.g.
  -- coaching the landlord privately). NULL = visible to all participants.
  visible_to      uuid[],
  edited_at       timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  constraint messages_author_ck check (
    (author_kind = 'user'      and author_id is not null) or
    (author_kind in ('assistant','system'))
  )
);
create index messages_conversation_idx on public.messages (conversation_id, created_at desc);
create index messages_author_idx on public.messages (author_id, created_at desc);

create table public.message_attachments (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.messages(id) on delete cascade,
  storage_path text not null,
  mime_type    text not null,
  size_bytes   bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  created_at   timestamptz not null default now()
);

-- Every AI turn is logged. Three reasons, all load-bearing:
--   1. UPL defense — proof the assistant declined to give legal advice.
--   2. Fair-housing defense — proof of what was and wasn't said to a consumer.
--   3. Debugging a system whose behavior is otherwise unreproducible.
create table public.ai_runs (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid references public.profiles(id),
  surface        text not null,        -- 'chat'|'maintenance_triage'|'listing_narrative'|'photo_analysis'
  conversation_id uuid references public.conversations(id) on delete set null,
  model          text not null,
  system_prompt_version text not null,
  input_summary  text,                 -- redacted; never store raw PII payloads
  output_text    text,
  disposition    public.ai_disposition not null,
  -- Which tools/data the model was given, so you can answer "did it see the
  -- tenant's payment history when it said that?"
  tools_used     text[] not null default '{}',
  guardrails_triggered text[] not null default '{}',
  input_tokens   integer,
  output_tokens  integer,
  latency_ms     integer,
  created_at     timestamptz not null default now()
);
create index ai_runs_profile_idx on public.ai_runs (profile_id, created_at desc);
create index ai_runs_conv_idx    on public.ai_runs (conversation_id, created_at desc);

alter table public.messages
  add constraint messages_ai_run_fk foreign key (ai_run_id) references public.ai_runs(id);

-- Keep conversations.last_message_at hot for inbox ordering.
create or replace function private.touch_conversation()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.conversations
     set last_message_at = new.created_at
   where id = new.conversation_id;
  return new;
end;
$$;
create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function private.touch_conversation();


-- =============================================================================
-- SECTION 12 — Payments, ledger, escrow
--
-- Design posture (see ARCHITECTURE.md §7 and OPEN_QUESTIONS.md #6):
--   * Stripe Connect, SEPARATE CHARGES AND TRANSFERS.
--   * The transfer to the landlord is created ONLY after `charge.succeeded`.
--     Verified from Stripe's docs: for asynchronous methods like ACH,
--     "avoid using source_transaction ... wait until a charge.succeeded event
--     is triggered before transferring the funds."
--     https://docs.stripe.com/connect/separate-charges-and-transfers
--   * ACH Direct Debit settles T+4 standard (T+2 with faster settlement, if
--     eligible). Personal-account ACH disputes run up to 60 calendar days.
--     https://docs.stripe.com/payments/ach-direct-debit
--   * Stripe is the system of record for money movement. This ledger is the
--     system of record for what the platform BELIEVES, reconciled against
--     Stripe nightly. Divergence is an alert, never an auto-correct.
-- =============================================================================

create table public.stripe_connected_accounts (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  stripe_account_id     text not null unique,          -- acct_...
  livemode              boolean not null,
  account_type          text not null check (account_type in ('standard','express','custom')),
  charges_enabled       boolean not null default false,
  payouts_enabled       boolean not null default false,
  details_submitted     boolean not null default false,
  requirements_due      text[] not null default '{}',
  default_payout_delay_days smallint,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint stripe_connected_accounts_org_uq unique (organization_id, livemode)
);
create trigger stripe_connected_accounts_updated_at before update on public.stripe_connected_accounts
  for each row execute function public.set_updated_at();

-- Tenant-side saved payment method. NEVER store a PAN, account number, or
-- routing number. Only Stripe identifiers plus display-safe remnants.
create table public.payment_methods (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid not null references public.profiles(id) on delete cascade,
  stripe_customer_id  text not null,
  stripe_payment_method_id text not null unique,
  kind                text not null check (kind in ('us_bank_account','card','link')),
  brand_or_bank       text,
  last4               char(4),
  -- ACH mandate proof. NACHA requires the originator to retain authorization.
  mandate_id          text,
  mandate_accepted_at timestamptz,
  mandate_text_hash   text,
  verification_status text check (verification_status in
                        ('pending','verified','failed','requires_microdeposit')),
  is_default          boolean not null default false,
  archived_at         timestamptz,
  created_at          timestamptz not null default now()
);
create index payment_methods_profile_idx on public.payment_methods (profile_id) where archived_at is null;
create unique index payment_methods_one_default_uq
  on public.payment_methods (profile_id) where is_default and archived_at is null;

-- A rent obligation for one period. Generated ahead of time by a scheduled job
-- so both parties can see what is coming.
create table public.rent_invoices (
  id                uuid primary key default gen_random_uuid(),
  lease_id          uuid not null references public.leases(id) on delete restrict,
  period_start      date not null,
  period_end        date not null,
  due_on            date not null,
  status            public.invoice_status not null default 'draft',
  currency          char(3) not null default 'USD',
  -- Denormalized totals, maintained by trigger from invoice_line_items.
  subtotal_cents    bigint not null default 0,
  amount_paid_cents bigint not null default 0,
  amount_due_cents  bigint generated always as (subtotal_cents - amount_paid_cents) stored,
  stripe_invoice_id text,
  issued_at         timestamptz,
  paid_at           timestamptz,
  voided_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint rent_invoices_period_uq unique (lease_id, period_start),
  constraint rent_invoices_period_ck check (period_end >= period_start)
);
create index rent_invoices_lease_idx on public.rent_invoices (lease_id, period_start desc);
create index rent_invoices_due_idx   on public.rent_invoices (due_on)
                                     where status in ('open','partially_paid');
create trigger rent_invoices_updated_at before update on public.rent_invoices
  for each row execute function public.set_updated_at();

create table public.invoice_line_items (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.rent_invoices(id) on delete cascade,
  kind         public.charge_kind not null,
  description  text not null,
  amount_cents bigint not null,          -- may be negative (credit/concession)
  -- Late fees must be provable. Store the rule that produced it.
  rule_id      text,
  created_at   timestamptz not null default now()
);
create index invoice_line_items_invoice_idx on public.invoice_line_items (invoice_id);

-- NOTE: TG_OP branching is required, not stylistic. In a PL/pgSQL DELETE
-- trigger `NEW` is unassigned, and `coalesce(new.x, old.x)` raises
-- 'record "new" is not assigned yet' at runtime rather than returning old.x.
create or replace function private.recalc_invoice_subtotal()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare v_invoice uuid;
begin
  if tg_op = 'DELETE' then
    v_invoice := old.invoice_id;
  else
    v_invoice := new.invoice_id;
  end if;

  update public.rent_invoices i
     set subtotal_cents = coalesce((
           select sum(li.amount_cents) from public.invoice_line_items li
            where li.invoice_id = v_invoice), 0)
   where i.id = v_invoice;
  return null;
end;
$$;
create trigger invoice_line_items_recalc
  after insert or update or delete on public.invoice_line_items
  for each row execute function private.recalc_invoice_subtotal();

create table public.payments (
  id                    uuid primary key default gen_random_uuid(),
  invoice_id            uuid references public.rent_invoices(id) on delete restrict,
  lease_id              uuid not null references public.leases(id) on delete restrict,
  payer_profile_id      uuid not null references public.profiles(id),
  payment_method_id     uuid references public.payment_methods(id),
  amount_cents          bigint not null check (amount_cents > 0),
  currency              char(3) not null default 'USD',
  status                public.payment_status not null default 'scheduled',
  -- Stripe linkage.
  stripe_payment_intent_id text unique,
  stripe_charge_id      text,
  stripe_transfer_id    text,           -- set only AFTER charge.succeeded
  transfer_group        text,
  application_fee_cents bigint not null default 0,
  processor_fee_cents   bigint,
  failure_code          text,
  failure_message       text,
  -- ACH facts worth persisting: dispute window and expected debit date.
  expected_debit_date   date,
  settled_at            timestamptz,
  disputed_at           timestamptz,
  refunded_cents        bigint not null default 0,
  -- Idempotency for retries.
  idempotency_key       text unique,
  initiated_at          timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index payments_lease_idx    on public.payments (lease_id, initiated_at desc);
create index payments_invoice_idx  on public.payments (invoice_id);
create index payments_payer_idx    on public.payments (payer_profile_id, initiated_at desc);
create index payments_status_idx   on public.payments (status) where status in ('processing','requires_action');
create trigger payments_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

create table public.payouts (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id),
  stripe_transfer_id    text unique,
  stripe_payout_id      text,
  amount_cents          bigint not null,
  currency              char(3) not null default 'USD',
  status                text not null default 'pending'
                        check (status in ('pending','in_transit','paid','failed','reversed','canceled')),
  covers_payment_ids    uuid[] not null default '{}',
  arrival_date          date,
  failure_message       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index payouts_org_idx on public.payouts (organization_id, created_at desc);
create trigger payouts_updated_at before update on public.payouts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Double-entry ledger. Every cent that moves has two postings that sum to zero.
-- This is not over-engineering for a rent platform: without it, a partial
-- refund on a disputed ACH payment that was already transferred out silently
-- corrupts the landlord's balance and there is no way to prove what happened.
-- ---------------------------------------------------------------------------

create table public.ledger_accounts (
  id           uuid primary key default gen_random_uuid(),
  -- Who the account belongs to.
  scope_type   text not null check (scope_type in ('organization','profile','platform','escrow')),
  scope_id     uuid,
  kind         text not null check (kind in (
                 'tenant_receivable','landlord_payable','platform_revenue',
                 'processor_fees','security_deposit_escrow','clearing','writeoff')),
  currency     char(3) not null default 'USD',
  created_at   timestamptz not null default now(),
  constraint ledger_accounts_uq unique (scope_type, scope_id, kind, currency)
);

create table public.ledger_transactions (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,           -- 'rent_charged','rent_paid','payout','refund','dispute','fee'
  occurred_at  timestamptz not null default now(),
  -- What in the app caused this.
  subject_type text,
  subject_id   uuid,
  memo         text,
  created_at   timestamptz not null default now()
);
create index ledger_transactions_subject_idx on public.ledger_transactions (subject_type, subject_id);

create table public.ledger_postings (
  id            bigint generated always as identity primary key,
  transaction_id uuid not null references public.ledger_transactions(id) on delete restrict,
  account_id    uuid not null references public.ledger_accounts(id) on delete restrict,
  -- Signed. Debits positive, credits negative. Must net to zero per transaction.
  amount_cents  bigint not null check (amount_cents <> 0),
  currency      char(3) not null default 'USD',
  created_at    timestamptz not null default now()
);
create index ledger_postings_txn_idx     on public.ledger_postings (transaction_id);
create index ledger_postings_account_idx on public.ledger_postings (account_id, created_at desc);

-- Deferred balance check: postings must sum to zero per transaction per
-- currency at COMMIT time, so a multi-row insert is legal mid-transaction.
create or replace function private.assert_ledger_balanced()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_unbalanced record;
  v_txn uuid;
begin
  -- See the note on recalc_invoice_subtotal: NEW is unassigned during DELETE.
  if tg_op = 'DELETE' then
    v_txn := old.transaction_id;
  else
    v_txn := new.transaction_id;
  end if;

  select p.transaction_id, p.currency, sum(p.amount_cents) as total
    into v_unbalanced
    from public.ledger_postings p
   where p.transaction_id = v_txn
   group by p.transaction_id, p.currency
  having sum(p.amount_cents) <> 0
   limit 1;

  if found then
    raise exception 'Ledger transaction % is unbalanced in % (net %)',
      v_unbalanced.transaction_id, v_unbalanced.currency, v_unbalanced.total
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger ledger_postings_balanced
  after insert or update or delete on public.ledger_postings
  deferrable initially deferred
  for each row execute function private.assert_ledger_balanced();

-- Ledger is append-only.
create or replace function private.forbid_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Table % is append-only', tg_table_name using errcode = 'insufficient_privilege';
end;
$$;
create trigger ledger_postings_append_only
  before update or delete on public.ledger_postings
  for each row execute function private.forbid_mutation();
create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function private.forbid_mutation();

-- Security deposits tracked separately because they are (in many states)
-- someone else's money. `deposit_held_by = 'platform_escrow'` is DISABLED at
-- launch — holding deposits is what turns a software platform into something a
-- state regulator cares about. See OPEN_QUESTIONS.md #7.
create table public.security_deposits (
  id                 uuid primary key default gen_random_uuid(),
  lease_id           uuid not null references public.leases(id) on delete restrict,
  amount_cents       bigint not null check (amount_cents >= 0),
  received_on        date,
  held_by            text not null check (held_by in ('landlord','platform_escrow','third_party')),
  institution_name   text,
  -- Statutory return deadline, computed by code from lease.terminated_on and
  -- the jurisdiction rule set. Never typed by a human.
  return_due_on      date,
  itemization_sent_at timestamptz,
  returned_cents     bigint not null default 0,
  withheld_cents     bigint not null default 0,
  withholding_reasons jsonb not null default '[]'::jsonb,
  interest_owed_cents bigint not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint security_deposits_lease_uq unique (lease_id)
);
create trigger security_deposits_updated_at before update on public.security_deposits
  for each row execute function public.set_updated_at();

-- Webhook idempotency. Stripe delivers at-least-once.
create table app.stripe_webhook_events (
  id            text primary key,          -- Stripe event id (evt_...)
  type          text not null,
  livemode      boolean not null,
  account_id    text,                       -- connected account, if any
  payload       jsonb not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  process_error text,
  attempts      smallint not null default 0
);
create index stripe_webhook_unprocessed_idx on app.stripe_webhook_events (received_at)
  where processed_at is null;


-- =============================================================================
-- SECTION 13 — RLS helper functions (SECURITY DEFINER, in `private`)
--
-- WHY SECURITY DEFINER: these functions read membership tables. If they ran as
-- the caller, RLS on those tables would apply inside the policy that is itself
-- evaluating RLS — infinite recursion. Running as definer bypasses RLS inside
-- the function, which is exactly Supabase's documented pattern.
--
-- WHY `stable`: lets Postgres cache the result within a statement.
-- WHY `set search_path = ''`: prevents search-path hijacking of a definer
--   function, which would otherwise be a privilege-escalation vector.
-- =============================================================================

-- Property IDs the current user can act on at >= the given role.
create or replace function private.property_ids_for_role(p_min_role public.property_role)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  with rank_map(role, rank) as (
    values ('viewer'::public.property_role, 1),
           ('maintenance'::public.property_role, 2),
           ('manager'::public.property_role, 3),
           ('owner'::public.property_role, 4)
  ),
  want as (select rank from rank_map where role = p_min_role),
  -- Direct per-property grants
  direct as (
    select pm.property_id
      from public.property_members pm
      join rank_map r on r.role = pm.role
     where pm.profile_id = (select auth.uid())
       and pm.accepted_at is not null
       and r.rank >= (select rank from want)
  ),
  -- Org-level grants cascade to every property in the org
  via_org as (
    select p.id as property_id
      from public.organization_members om
      join rank_map r on r.role = om.role
      join public.properties p on p.organization_id = om.organization_id
     where om.profile_id = (select auth.uid())
       and om.accepted_at is not null
       and r.rank >= (select rank from want)
  )
  select coalesce(array_agg(distinct property_id), '{}')
    from (select property_id from direct union select property_id from via_org) s;
$$;

create or replace function private.org_ids_for_role(p_min_role public.property_role)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  with rank_map(role, rank) as (
    values ('viewer'::public.property_role, 1),
           ('maintenance'::public.property_role, 2),
           ('manager'::public.property_role, 3),
           ('owner'::public.property_role, 4)
  ),
  want as (select rank from rank_map where role = p_min_role)
  select coalesce(array_agg(distinct om.organization_id), '{}')
    from public.organization_members om
    join rank_map r on r.role = om.role
   where om.profile_id = (select auth.uid())
     and om.accepted_at is not null
     and r.rank >= (select rank from want);
$$;

-- Lease IDs where the current user is a tenant/occupant (any time, including
-- ended leases — a former tenant keeps read access to their own record).
create or replace function private.tenant_lease_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(lt.lease_id), '{}')
    from public.lease_tenants lt
   where lt.profile_id = (select auth.uid())
     and lt.accepted_at is not null;
$$;

-- Unit IDs the current user occupies (currently or historically).
create or replace function private.tenant_unit_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct l.unit_id), '{}')
    from public.lease_tenants lt
    join public.leases l on l.id = lt.lease_id
   where lt.profile_id = (select auth.uid())
     and lt.accepted_at is not null;
$$;

-- Conversations the current user participates in.
create or replace function private.conversation_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(cp.conversation_id), '{}')
    from public.conversation_participants cp
   where cp.profile_id = (select auth.uid())
     and cp.left_at is null;
$$;

-- Property IDs a tenant is attached to (needed so a tenant can read the
-- non-sensitive facts about the building they live in).
create or replace function private.tenant_property_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct u.property_id), '{}')
    from public.lease_tenants lt
    join public.leases l on l.id = lt.lease_id
    join public.units  u on u.id = l.unit_id
   where lt.profile_id = (select auth.uid())
     and lt.accepted_at is not null;
$$;

grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;


-- =============================================================================
-- SECTION 14 — ROW LEVEL SECURITY
--
-- Read this section as the security spec. Each policy states WHO, WHAT, and WHY.
--
-- Global rules applied throughout, each for a documented reason:
--   * `to authenticated` on every policy. Supabase benchmarks ~99.78%
--     improvement from this alone, because the policy is skipped entirely for
--     anon. It also prevents accidentally exposing data to the anon key.
--   * `(select auth.uid())` never bare `auth.uid()` — lets Postgres evaluate
--     once per statement instead of once per row (~95% faster in Supabase's
--     own benchmark).
--   * `= any(private.x())` instead of a join — Supabase measures joins in
--     policies as the single worst RLS performance mistake.
--   * Every column referenced in a policy is indexed (see the index list above
--     each table).
--   * Writes get their own policies with `with check`; nothing relies on a
--     `for all` policy, because `for all` makes it easy to accidentally grant
--     delete. (One exception, called out where it appears: the `avatars`
--     storage bucket, where every operation is genuinely "your own folder".)
-- =============================================================================

alter table public.profiles                    enable row level security;
alter table public.organizations               enable row level security;
alter table public.organization_members        enable row level security;
alter table public.addresses                   enable row level security;
alter table public.parcels                     enable row level security;
alter table public.address_parcels             enable row level security;
alter table public.data_sources                enable row level security;
alter table public.fact_types                  enable row level security;
alter table public.property_facts              enable row level security;
alter table public.zoning_districts            enable row level security;
alter table public.permits                     enable row level security;
alter table public.hazards                     enable row level security;
alter table public.opportunity_signals         enable row level security;
alter table public.listings                    enable row level security;
alter table public.listing_observations        enable row level security;
alter table public.listing_price_history       enable row level security;
alter table public.listing_photos              enable row level security;
alter table public.assessments                 enable row level security;
alter table public.scoring_factors             enable row level security;
alter table public.scoring_profiles            enable row level security;
alter table public.analyses                    enable row level security;
alter table public.analysis_factors            enable row level security;
alter table public.photo_analyses              enable row level security;
alter table public.schools                     enable row level security;
alter table public.school_assignments          enable row level security;
alter table public.properties                  enable row level security;
alter table public.property_members            enable row level security;
alter table public.units                       enable row level security;
alter table public.leases                      enable row level security;
alter table public.lease_tenants               enable row level security;
alter table public.maintenance_requests        enable row level security;
alter table public.maintenance_events          enable row level security;
alter table public.maintenance_attachments     enable row level security;
alter table public.conversations               enable row level security;
alter table public.conversation_participants   enable row level security;
alter table public.messages                    enable row level security;
alter table public.message_attachments         enable row level security;
alter table public.ai_runs                     enable row level security;
alter table public.stripe_connected_accounts   enable row level security;
alter table public.payment_methods             enable row level security;
alter table public.rent_invoices               enable row level security;
alter table public.invoice_line_items          enable row level security;
alter table public.payments                    enable row level security;
alter table public.payouts                     enable row level security;
alter table public.ledger_accounts             enable row level security;
alter table public.ledger_transactions         enable row level security;
alter table public.ledger_postings             enable row level security;
alter table public.security_deposits           enable row level security;
alter table public.consent_records             enable row level security;
alter table public.audit_log                   enable row level security;

-- No policies are written for these, which means: authenticated users can read
-- NOTHING from them through PostgREST. Only `service_role` (server-side) can.
-- That is intentional for the raw provenance and money-internals tables.
--   listing_observations  — raw scraped payloads; ToS risk if exposed
--   ledger_*              — internal accounting; users see payments/payouts
--   audit_log             — read via a server endpoint with its own checks
--   ai_runs (write side)  — see the narrow read policy below


-- ---------------------------------------------------------------------------
-- 14.1  Profiles
-- ---------------------------------------------------------------------------

-- WHY: a user always sees themselves.
create policy profiles_select_self on public.profiles
  for select to authenticated
  using ( (select auth.uid()) = id );

-- WHY: a landlord must see the name/phone of their own tenants, and a tenant
-- must see their landlord's, or the messaging UI shows "unknown user". This is
-- scoped to counterparties, NOT a global directory: you can only see someone
-- you actually share a conversation with. That is the narrowest join that makes
-- the product work.
create policy profiles_select_counterparties on public.profiles
  for select to authenticated
  using (
    id in (
      select cp.profile_id
        from public.conversation_participants cp
       where cp.conversation_id = any (private.conversation_ids())
    )
  );

create policy profiles_update_self on public.profiles
  for update to authenticated
  using  ( (select auth.uid()) = id )
  with check ( (select auth.uid()) = id );

-- No insert policy: rows are created by the on_auth_user_created trigger
-- (security definer). No delete policy: account deletion cascades from
-- auth.users and is a server-side operation.


-- ---------------------------------------------------------------------------
-- 14.2  Organizations & membership
-- ---------------------------------------------------------------------------

create policy organizations_select_member on public.organizations
  for select to authenticated
  using ( id = any (private.org_ids_for_role('viewer')) );

create policy organizations_insert_self on public.organizations
  for insert to authenticated
  with check ( created_by = (select auth.uid()) );

create policy organizations_update_owner on public.organizations
  for update to authenticated
  using      ( id = any (private.org_ids_for_role('owner')) )
  with check ( id = any (private.org_ids_for_role('owner')) );

-- WHY: you can see the membership roster of orgs you belong to. Needed for the
-- "who has access" screen.
create policy org_members_select on public.organization_members
  for select to authenticated
  using ( organization_id = any (private.org_ids_for_role('viewer')) );

-- WHY owner-only: adding a member is a privilege grant. A manager escalating
-- themselves to owner is the classic broken-access-control bug.
create policy org_members_write_owner on public.organization_members
  for insert to authenticated
  with check ( organization_id = any (private.org_ids_for_role('owner')) );

create policy org_members_update_owner on public.organization_members
  for update to authenticated
  using      ( organization_id = any (private.org_ids_for_role('owner')) )
  with check ( organization_id = any (private.org_ids_for_role('owner')) );

create policy org_members_delete_owner on public.organization_members
  for delete to authenticated
  using ( organization_id = any (private.org_ids_for_role('owner')) );

-- WHY this extra one: a newly invited user must be able to accept their own
-- invitation before they are a member of anything.
create policy org_members_accept_own on public.organization_members
  for update to authenticated
  using      ( profile_id = (select auth.uid()) and accepted_at is null )
  with check ( profile_id = (select auth.uid()) );


-- ---------------------------------------------------------------------------
-- 14.3  Market intelligence — public reference data
--
-- Addresses, zoning, schools, hazards and permits are public-record or
-- public-API data. Any signed-in user may read them. They are NOT open to
-- `anon`: requiring a login is what makes rate-limiting and abuse-tracing
-- possible, and stops the whole dataset being trivially re-scraped out of us.
-- ---------------------------------------------------------------------------

create policy addresses_select_authed        on public.addresses        for select to authenticated using (true);
create policy parcels_select_authed          on public.parcels          for select to authenticated using (true);
create policy address_parcels_select_authed  on public.address_parcels  for select to authenticated using (true);
create policy zoning_select_authed           on public.zoning_districts for select to authenticated using (true);
create policy permits_select_authed          on public.permits          for select to authenticated using (true);
create policy hazards_select_authed          on public.hazards          for select to authenticated using (true);
create policy assessments_select_authed      on public.assessments      for select to authenticated using (true);
create policy schools_select_authed          on public.schools          for select to authenticated using (true);
create policy school_assign_select_authed    on public.school_assignments for select to authenticated using (true);
create policy opportunity_select_authed      on public.opportunity_signals for select to authenticated using (true);
create policy fact_types_select_authed       on public.fact_types       for select to authenticated using (true);
create policy scoring_factors_select_authed  on public.scoring_factors  for select to authenticated using (true);

-- WHY filtered: `data_sources` rows carry commercial terms and contract notes.
-- Users get the display name and attribution string only — enforce that with a
-- view rather than exposing the table.
create view public.data_sources_public
  with (security_invoker = true) as
  select id, slug, display_name, category, attribution_required
    from public.data_sources
   where is_enabled;
grant select on public.data_sources_public to authenticated;
revoke all on public.data_sources_public from anon;

create policy data_sources_select_enabled on public.data_sources
  for select to authenticated
  using ( is_enabled );

-- WHY the redistribution gate: several feeds (MLS/IDX, some scraped sources)
-- may be used to compute a signal but their raw values may not be shown. This
-- policy is the enforcement point — not the frontend, which can be bypassed.
create policy property_facts_select_redistributable on public.property_facts
  for select to authenticated
  using (
    source_id in (select ds.id from public.data_sources ds where ds.redistribution_allowed)
  );

-- WHY the extra grant to owners: a landlord may see EVERY fact about their own
-- building, including ones sourced from non-redistributable feeds, because
-- they are the subject of the data rather than a third-party consumer of it.
create policy property_facts_select_own_property on public.property_facts
  for select to authenticated
  using (
    address_id in (
      select p.address_id from public.properties p
       where p.id = any (private.property_ids_for_role('viewer'))
    )
  );

create policy listings_select_redistributable on public.listings
  for select to authenticated
  using ( redistributable );

create policy listing_photos_select on public.listing_photos
  for select to authenticated
  using ( listing_id in (select l.id from public.listings l where l.redistributable) );

create policy listing_price_history_select on public.listing_price_history
  for select to authenticated
  using ( listing_id in (select l.id from public.listings l where l.redistributable) );

create policy photo_analyses_select on public.photo_analyses
  for select to authenticated
  using (
    listing_id in (select l.id from public.listings l where l.redistributable)
    or address_id in (
      select p.address_id from public.properties p
       where p.id = any (private.property_ids_for_role('viewer'))
    )
  );


-- ---------------------------------------------------------------------------
-- 14.4  Analyses
--
-- An analysis is either (a) system-generated for a public listing — readable by
-- anyone who can read the listing, or (b) user-requested — private to that user.
-- WHY private: a user's saved analyses reveal their buying intent and budget.
-- ---------------------------------------------------------------------------

create policy analyses_select on public.analyses
  for select to authenticated
  using (
    requested_by = (select auth.uid())
    or (
      requested_by is null
      and listing_id in (select l.id from public.listings l where l.redistributable)
    )
    or address_id in (
      select p.address_id from public.properties p
       where p.id = any (private.property_ids_for_role('viewer'))
    )
  );

-- WHY no insert policy for authenticated: analyses are written by the scoring
-- service using `service_role`. A user "requesting" an analysis calls an Edge
-- Function, which validates and then writes. If a client could insert directly
-- it could fabricate a score — the exact thing the determinism rule forbids.

create policy analysis_factors_select on public.analysis_factors
  for select to authenticated
  using ( analysis_id in (select a.id from public.analyses a) );
-- NOTE: the sub-select above is itself RLS-filtered (analyses has RLS), so this
-- resolves to "factors of analyses you can see". This is one place where the
-- nested select is intentional and cheap — analysis_id is indexed and the inner
-- set is small.

create policy scoring_profiles_select on public.scoring_profiles
  for select to authenticated
  using ( owner_id is null or owner_id = (select auth.uid()) );

create policy scoring_profiles_write_own on public.scoring_profiles
  for insert to authenticated
  with check ( owner_id = (select auth.uid()) );

create policy scoring_profiles_update_own on public.scoring_profiles
  for update to authenticated
  using      ( owner_id = (select auth.uid()) )
  with check ( owner_id = (select auth.uid()) );


-- ---------------------------------------------------------------------------
-- 14.5  Managed portfolio
--
-- THE CORE REQUIREMENT: "landlords must only see their properties, tenants only
-- their unit." Both directions are implemented below, and both are tested by
-- the assertions at the end of this file.
-- ---------------------------------------------------------------------------

-- Landlord/manager/viewer path.
create policy properties_select_member on public.properties
  for select to authenticated
  using ( id = any (private.property_ids_for_role('viewer')) );

-- TENANT PATH — deliberately NOT a policy on `properties`.
--
-- A tenant legitimately needs to see facts about the building they live in
-- (address, type, unit count), but must never see `purchase_price_cents`,
-- `acquired_on`, or `owner_notes`. Postgres RLS is ROW-level only — it cannot
-- hide a column.
--
-- The obvious fix (grant the row, then `revoke select (col)` from
-- authenticated) is a TRAP: it also strips those columns from the landlord,
-- because column privileges are not role-contextual the way policies are, and
-- a `security_invoker` view re-checks the invoker's column privileges so it
-- cannot restore them either.
--
-- So: tenants get no policy on `properties` at all. They read a view that
-- physically does not contain the sensitive columns.
--
-- NOTE the `security_invoker = false` — this is the ONE place in the schema
-- where a view runs with definer rights, and it is deliberate. With
-- security_invoker = true the view would re-evaluate RLS on `properties` as the
-- tenant, who has no SELECT policy there, and it would return zero rows.
-- Running as the view owner bypasses that, which means THE VIEW'S OWN WHERE
-- CLAUSE IS THE SECURITY BOUNDARY. Treat it accordingly: it is short, it calls
-- the same helper every other tenant policy calls, and it must be covered by
-- the RLS assertion suite (a tenant of unit 1 must not resolve building 2).
create view public.my_building
  with (security_invoker = false) as
  select p.id           as property_id,
         p.nickname,
         p.property_type,
         p.unit_count,
         a.id           as address_id,
         a.line1, a.line2, a.city, a.state, a.postal_code
    from public.properties p
    join public.addresses  a on a.id = p.address_id
   where p.id = any (private.tenant_property_ids());

comment on view public.my_building is
  'Tenant-facing projection of properties. Sensitive columns '
  '(purchase_price_cents, acquired_on, owner_notes) are absent BY CONSTRUCTION '
  'rather than by privilege — the only version of this that a future policy '
  'change cannot silently defeat. Definer-rights view: its WHERE clause is the '
  'security boundary and must be covered by the RLS test suite.';

grant select on public.my_building to authenticated;
revoke all on public.my_building from anon;

create policy properties_insert_member on public.properties
  for insert to authenticated
  with check ( organization_id = any (private.org_ids_for_role('manager')) );

create policy properties_update_member on public.properties
  for update to authenticated
  using      ( id = any (private.property_ids_for_role('manager')) )
  with check ( id = any (private.property_ids_for_role('manager')) );

create policy properties_delete_owner on public.properties
  for delete to authenticated
  using ( id = any (private.property_ids_for_role('owner')) );

create policy property_members_select on public.property_members
  for select to authenticated
  using ( property_id = any (private.property_ids_for_role('viewer')) );

create policy property_members_write_owner on public.property_members
  for insert to authenticated
  with check ( property_id = any (private.property_ids_for_role('owner')) );

create policy property_members_update_owner on public.property_members
  for update to authenticated
  using      ( property_id = any (private.property_ids_for_role('owner')) )
  with check ( property_id = any (private.property_ids_for_role('owner')) );

create policy property_members_delete_owner on public.property_members
  for delete to authenticated
  using ( property_id = any (private.property_ids_for_role('owner')) );

-- Units: landlord sees all units in their properties; a tenant sees ONLY the
-- unit(s) on their own lease — not their neighbor's.
create policy units_select_member on public.units
  for select to authenticated
  using ( property_id = any (private.property_ids_for_role('viewer')) );

create policy units_select_tenant on public.units
  for select to authenticated
  using ( id = any (private.tenant_unit_ids()) );

create policy units_write_manager on public.units
  for insert to authenticated
  with check ( property_id = any (private.property_ids_for_role('manager')) );

create policy units_update_manager on public.units
  for update to authenticated
  using      ( property_id = any (private.property_ids_for_role('manager')) )
  with check ( property_id = any (private.property_ids_for_role('manager')) );

-- Leases.
create policy leases_select_landlord on public.leases
  for select to authenticated
  using (
    unit_id in (
      select u.id from public.units u
       where u.property_id = any (private.property_ids_for_role('viewer'))
    )
  );

-- WHY tenants keep read access after move-out: they need their own lease and
-- payment history for taxes, disputes, and future rental applications. Removing
-- it would be user-hostile and, in a deposit dispute, evidentially one-sided.
create policy leases_select_tenant on public.leases
  for select to authenticated
  using ( id = any (private.tenant_lease_ids()) );

create policy leases_write_manager on public.leases
  for insert to authenticated
  with check (
    unit_id in (
      select u.id from public.units u
       where u.property_id = any (private.property_ids_for_role('manager'))
    )
  );

create policy leases_update_manager on public.leases
  for update to authenticated
  using (
    unit_id in (select u.id from public.units u
                 where u.property_id = any (private.property_ids_for_role('manager')))
  )
  with check (
    unit_id in (select u.id from public.units u
                 where u.property_id = any (private.property_ids_for_role('manager')))
  );

-- WHY no delete policy on leases: a lease is a legal record. It gets
-- status='void', never DELETE.

create policy lease_tenants_select on public.lease_tenants
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or lease_id in (
      select l.id from public.leases l
       join public.units u on u.id = l.unit_id
      where u.property_id = any (private.property_ids_for_role('viewer'))
    )
  );

create policy lease_tenants_write_manager on public.lease_tenants
  for insert to authenticated
  with check (
    lease_id in (
      select l.id from public.leases l
       join public.units u on u.id = l.unit_id
      where u.property_id = any (private.property_ids_for_role('manager'))
    )
  );

-- Tenant accepts their own invitation.
create policy lease_tenants_accept_own on public.lease_tenants
  for update to authenticated
  using      ( profile_id = (select auth.uid()) and accepted_at is null )
  with check ( profile_id = (select auth.uid()) );


-- ---------------------------------------------------------------------------
-- 14.6  Maintenance
-- ---------------------------------------------------------------------------

create policy maint_select_landlord on public.maintenance_requests
  for select to authenticated
  using (
    unit_id in (select u.id from public.units u
                 where u.property_id = any (private.property_ids_for_role('maintenance')))
  );

-- Tenant sees requests for their own unit — including ones the landlord raised,
-- because the tenant needs to know a plumber is coming.
create policy maint_select_tenant on public.maintenance_requests
  for select to authenticated
  using ( unit_id = any (private.tenant_unit_ids()) );

-- WHY the `reported_by` check on insert: prevents a tenant filing a request in
-- someone else's name, and prevents filing against a unit they do not occupy.
create policy maint_insert_tenant on public.maintenance_requests
  for insert to authenticated
  with check (
    reported_by = (select auth.uid())
    and unit_id = any (private.tenant_unit_ids())
  );

create policy maint_insert_staff on public.maintenance_requests
  for insert to authenticated
  with check (
    reported_by = (select auth.uid())
    and unit_id in (select u.id from public.units u
                     where u.property_id = any (private.property_ids_for_role('maintenance')))
  );

-- Landlord/manager/maintenance can move a request through its lifecycle.
create policy maint_update_staff on public.maintenance_requests
  for update to authenticated
  using (
    unit_id in (select u.id from public.units u
                 where u.property_id = any (private.property_ids_for_role('maintenance')))
  )
  with check (
    unit_id in (select u.id from public.units u
                 where u.property_id = any (private.property_ids_for_role('maintenance')))
  );

-- A tenant may edit their own request only while it is still `submitted`, and
-- may cancel it. Enforced via a WITH CHECK on status, plus a column-level
-- revoke so they cannot set cost or chargeability.
create policy maint_update_own_tenant on public.maintenance_requests
  for update to authenticated
  using      ( reported_by = (select auth.uid()) and status = 'submitted' )
  with check ( reported_by = (select auth.uid()) and status in ('submitted','cancelled') );

revoke update (cost_cents, chargeable_to_tenant, assigned_to, vendor_name)
  on public.maintenance_requests from authenticated;
-- Those four are set through an Edge Function that re-checks the staff role.

create policy maint_events_select on public.maintenance_events
  for select to authenticated
  using ( request_id in (select r.id from public.maintenance_requests r) );

create policy maint_events_insert on public.maintenance_events
  for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and request_id in (select r.id from public.maintenance_requests r)
  );

create policy maint_attach_select on public.maintenance_attachments
  for select to authenticated
  using ( request_id in (select r.id from public.maintenance_requests r) );

create policy maint_attach_insert on public.maintenance_attachments
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and request_id in (select r.id from public.maintenance_requests r)
  );

-- WHY delete-own-only: a tenant may remove a photo they uploaded by mistake
-- (it might contain something private). A landlord may not delete the tenant's
-- evidence — that would be spoliation in a habitability dispute.
create policy maint_attach_delete_own on public.maintenance_attachments
  for delete to authenticated
  using ( uploaded_by = (select auth.uid()) );


-- ---------------------------------------------------------------------------
-- 14.7  Messaging
-- ---------------------------------------------------------------------------

create policy conversations_select on public.conversations
  for select to authenticated
  using ( id = any (private.conversation_ids()) );

create policy conv_participants_select on public.conversation_participants
  for select to authenticated
  using ( conversation_id = any (private.conversation_ids()) );

-- WHY update-self-only: `last_read_at` and `muted` are the user's own state.
create policy conv_participants_update_self on public.conversation_participants
  for update to authenticated
  using      ( profile_id = (select auth.uid()) )
  with check ( profile_id = (select auth.uid()) );

create policy messages_select on public.messages
  for select to authenticated
  using (
    conversation_id = any (private.conversation_ids())
    and deleted_at is null
    -- Honors targeted assistant messages.
    and (visible_to is null or (select auth.uid()) = any (visible_to))
  );

create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    author_kind = 'user'
    and author_id = (select auth.uid())
    and conversation_id = any (private.conversation_ids())
  );
-- Assistant/system messages are inserted by an Edge Function with service_role,
-- so a client cannot forge a message "from the AI" — which would otherwise be a
-- trivial way to put words in the platform's mouth in a legal dispute.

-- WHY soft delete only, and only your own: message history in a landlord-tenant
-- relationship is evidence. Neither party gets to erase the record.
create policy messages_update_own on public.messages
  for update to authenticated
  using      ( author_id = (select auth.uid()) and author_kind = 'user' )
  with check ( author_id = (select auth.uid()) and author_kind = 'user' );

create policy message_attachments_select on public.message_attachments
  for select to authenticated
  using ( message_id in (select m.id from public.messages m) );

create policy message_attachments_insert on public.message_attachments
  for insert to authenticated
  with check ( message_id in (select m.id from public.messages m where m.author_id = (select auth.uid())) );

-- Users may read their own AI interaction history (transparency), nothing else.
create policy ai_runs_select_own on public.ai_runs
  for select to authenticated
  using ( profile_id = (select auth.uid()) );


-- ---------------------------------------------------------------------------
-- 14.8  Money
--
-- Tightest policies in the schema. Note what is DELIBERATELY MISSING: there is
-- no INSERT or UPDATE policy for `authenticated` on any payment table. Every
-- write happens server-side (Edge Function / webhook handler) with
-- `service_role`, after re-validating authorization. A client that could insert
-- a `payments` row could mark rent as paid.
-- ---------------------------------------------------------------------------

create policy stripe_accounts_select_owner on public.stripe_connected_accounts
  for select to authenticated
  using ( organization_id = any (private.org_ids_for_role('owner')) );

create policy payment_methods_select_own on public.payment_methods
  for select to authenticated
  using ( profile_id = (select auth.uid()) );

-- WHY landlords cannot see tenant payment methods at all: they have no
-- legitimate need for the bank name or last4, and it is exactly the kind of
-- incidental financial data that turns a breach into a reportable one.

create policy payment_methods_update_own on public.payment_methods
  for update to authenticated
  using      ( profile_id = (select auth.uid()) )
  with check ( profile_id = (select auth.uid()) );

create policy invoices_select_tenant on public.rent_invoices
  for select to authenticated
  using ( lease_id = any (private.tenant_lease_ids()) );

create policy invoices_select_landlord on public.rent_invoices
  for select to authenticated
  using (
    lease_id in (
      select l.id from public.leases l
       join public.units u on u.id = l.unit_id
      where u.property_id = any (private.property_ids_for_role('viewer'))
    )
  );

create policy invoice_lines_select on public.invoice_line_items
  for select to authenticated
  using ( invoice_id in (select i.id from public.rent_invoices i) );

create policy payments_select_own on public.payments
  for select to authenticated
  using ( payer_profile_id = (select auth.uid()) );

create policy payments_select_landlord on public.payments
  for select to authenticated
  using (
    lease_id in (
      select l.id from public.leases l
       join public.units u on u.id = l.unit_id
      where u.property_id = any (private.property_ids_for_role('viewer'))
    )
  );

create policy payouts_select_org on public.payouts
  for select to authenticated
  using ( organization_id = any (private.org_ids_for_role('owner')) );

create policy deposits_select_tenant on public.security_deposits
  for select to authenticated
  using ( lease_id = any (private.tenant_lease_ids()) );

create policy deposits_select_landlord on public.security_deposits
  for select to authenticated
  using (
    lease_id in (
      select l.id from public.leases l
       join public.units u on u.id = l.unit_id
      where u.property_id = any (private.property_ids_for_role('manager'))
    )
  );

create policy consent_select_own on public.consent_records
  for select to authenticated
  using ( profile_id = (select auth.uid()) );


-- ---------------------------------------------------------------------------
-- 14.9  Realtime authorization
--
-- Supabase gates private Realtime channels with RLS on `realtime.messages`.
-- The client joins channel `conv:<uuid>` with `{ config: { private: true } }`;
-- `realtime.topic()` returns that string and the policy below checks it against
-- the user's conversations.
--
-- WHY Broadcast rather than Postgres Changes: Postgres Changes evaluates RLS
-- per subscriber per row on the WAL reader, which becomes the bottleneck as
-- subscriptions grow. Broadcast-from-database (a trigger calling
-- realtime.broadcast_changes) does the fan-out in Realtime instead, and is
-- Supabase's recommended path for anything beyond small scale.
-- ---------------------------------------------------------------------------

create policy realtime_conv_read on realtime.messages
  for select to authenticated
  using (
    (select realtime.topic()) = any (
      select 'conv:' || c.id::text
        from public.conversations c
       where c.id = any (private.conversation_ids())
    )
    and realtime.messages.extension in ('broadcast','presence')
  );

create policy realtime_conv_write on realtime.messages
  for insert to authenticated
  with check (
    (select realtime.topic()) = any (
      select 'conv:' || c.id::text
        from public.conversations c
       where c.id = any (private.conversation_ids())
    )
    and realtime.messages.extension = 'broadcast'
  );

-- Fan out new messages to the conversation topic.
create or replace function private.broadcast_message()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  perform realtime.broadcast_changes(
    'conv:' || new.conversation_id::text,  -- topic
    tg_op,                                  -- event
    tg_op,                                  -- operation
    tg_table_name,
    tg_table_schema,
    new,
    null
  );
  return null;
end;
$$;

create trigger messages_broadcast
  after insert or update on public.messages
  for each row execute function private.broadcast_message();

-- Maintenance status changes also stream, on the property topic.
create policy realtime_maint_read on realtime.messages
  for select to authenticated
  using (
    (select realtime.topic()) = any (
      select 'unit:' || u.id::text from public.units u
       where u.id = any (private.tenant_unit_ids())
      union
      select 'unit:' || u.id::text from public.units u
       where u.property_id = any (private.property_ids_for_role('maintenance'))
    )
    and realtime.messages.extension in ('broadcast','presence')
  );


-- ---------------------------------------------------------------------------
-- 14.10  Storage buckets + object policies
--
-- Three buckets, all PRIVATE. Access is via signed URLs minted server-side
-- after an authorization check, plus the RLS below as defense in depth.
-- Path convention encodes the authorization key as the first path segment,
-- which is what makes the policy a cheap prefix comparison rather than a join.
--   maintenance/<property_id>/<request_id>/<uuid>.<ext>
--   lease-docs/<property_id>/<lease_id>/<uuid>.pdf
--   avatars/<profile_id>/<uuid>.<ext>
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('maintenance', 'maintenance', false, 26214400,
     array['image/jpeg','image/png','image/webp','image/heic','video/mp4']),
  ('lease-docs',  'lease-docs',  false, 26214400, array['application/pdf']),
  ('avatars',     'avatars',     false,  2097152,
     array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy maintenance_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'maintenance'
    and (
      (storage.foldername(name))[1] = any (
        select p.id::text from public.properties p
         where p.id = any (private.property_ids_for_role('maintenance'))
      )
      or (storage.foldername(name))[1] = any (
        select u.property_id::text from public.units u
         where u.id = any (private.tenant_unit_ids())
      )
    )
  );

create policy maintenance_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'maintenance'
    and owner = (select auth.uid())
    and (
      (storage.foldername(name))[1] = any (
        select u.property_id::text from public.units u
         where u.id = any (private.tenant_unit_ids())
      )
      or (storage.foldername(name))[1] = any (
        select p.id::text from public.properties p
         where p.id = any (private.property_ids_for_role('maintenance'))
      )
    )
  );

create policy maintenance_delete_own on storage.objects
  for delete to authenticated
  using ( bucket_id = 'maintenance' and owner = (select auth.uid()) );

create policy lease_docs_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'lease-docs'
    and (
      (storage.foldername(name))[1] = any (
        select p.id::text from public.properties p
         where p.id = any (private.property_ids_for_role('viewer'))
      )
      or (storage.foldername(name))[2] = any (
        select lid::text from unnest(private.tenant_lease_ids()) as lid
      )
    )
  );

create policy avatars_rw on storage.objects
  for all to authenticated
  using      ( bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text )
  with check ( bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text );


-- =============================================================================
-- SECTION 15 — Grants
--
-- Supabase grants ALL on new tables in `public` to anon/authenticated by
-- default via the default-privileges setup; RLS is what actually protects them.
-- Here we tighten it: `anon` gets nothing at all, and `authenticated` gets no
-- DELETE except where a policy exists.
-- =============================================================================

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- Nobody deletes financial or legal records through the API.
revoke delete on
  public.leases, public.lease_tenants, public.payments, public.payouts,
  public.rent_invoices, public.invoice_line_items, public.security_deposits,
  public.ledger_postings, public.ledger_transactions, public.audit_log,
  public.consent_records, public.messages, public.ai_runs
from authenticated;


-- =============================================================================
-- SECTION 16 — Seed: the eight existing scoring factors, ported
--
-- Straight port of lib/scoring.js. Note `consumer_safe` on each — this is where
-- the investor engine and the consumer product diverge, and the rationale is
-- recorded rather than assumed.
-- =============================================================================

insert into public.scoring_factors (key, display_name, description, impl_id, consumer_safe, safety_rationale) values
 ('price_vs_assessed','Price vs assessed value',
  'asking price / (assessed value x assessment_ratio inverse). Full points at <=0.85, linear to zero at 1.15.',
  'scoring/priceVsAssessed', true,
  'Property-intrinsic and publicly verifiable. No protected-class proxy. Safe to show consumers, but must display the assessment ratio used.'),

 ('multi_unit','Multi-unit structure',
  'Duplex/triplex/fourplex full points; single family partial scaled by bed count.',
  'scoring/multiUnit', false,
  'Investor-specific value judgment. Meaningless to an owner-occupant buyer and would distort a consumer ranking. Excluded from consumer profiles rather than reweighted.'),

 ('dom_price_cuts','Days on market + price cuts',
  '60-150 DOM with one modest cut = full points (motivated seller). <14 DOM low. >150 with no cuts flagged.',
  'scoring/domPriceCuts', true,
  'Market-behavior signal about the listing, not the neighborhood or its residents. Safe, and genuinely useful to ordinary buyers negotiating.'),

 ('bath_bed_ratio','Bath-to-bed ratio',
  'ratio >=0.5 full points, linear to zero at 0.25.',
  'scoring/bathBedRatio', true,
  'Physical attribute of the structure.'),

 ('price_per_sqft','Price per above-grade sqft vs area median',
  'Compared against trailing 90-day median for the area. Neutral half-credit when no median is available — never zero.',
  'scoring/pricePerSqft', true,
  'CONDITIONAL: safe only when the comparison area is a ZIP/market geography. If the comparison area is ever narrowed to a census tract or block group, this becomes a demographic proxy and must be reclassified. Enforce the geography level in code.'),

 ('garage','Garage presence',
  'Any garage full points; 3+ stalls bonus that may exceed the factor weight.',
  'scoring/garage', true,
  'Physical attribute.'),

 ('year_built','Year built / systems risk',
  'Pre-1920 partial with manual-review flag; post-1970 full; linear between.',
  'scoring/yearBuilt', true,
  'Physical attribute. NOTE: housing age correlates with neighborhood demographics in many cities. Kept consumer-safe because it is a direct proxy for systems risk (wiring, plumbing) rather than for people, but it should be monitored in the disparate-impact review (see FEATURES.md).'),

 ('disclosure_completeness','Disclosure completeness',
  'Penalizes blank electrical/heating/water-heater-age disclosure fields.',
  'scoring/disclosureCompleteness', true,
  'Attribute of the listing paperwork.')
on conflict (key) do nothing;

insert into public.scoring_profiles (slug, version, display_name, audience, config, is_active) values
 ('investor.gf', 1, 'VitaForge investor buy-box (Grand Forks)', 'investor',
  '{"factors":[
      {"key":"price_vs_assessed","weight":20,"params":{"full_at":0.85,"zero_at":1.15}},
      {"key":"multi_unit","weight":15,"params":{"sf_base":6,"sf_per_bed":2,"sf_cap":12}},
      {"key":"dom_price_cuts","weight":15,"params":{}},
      {"key":"bath_bed_ratio","weight":10,"params":{"full_at":0.5,"zero_at":0.25}},
      {"key":"price_per_sqft","weight":15,"params":{"full_at":0.85,"zero_at":1.15,"geography":"zip"}},
      {"key":"garage","weight":5,"params":{"bonus_at_stalls":3,"bonus_points":7}},
      {"key":"year_built","weight":10,"params":{"low_anchor":1920,"high_anchor":1970}},
      {"key":"disclosure_completeness","weight":10,"params":{}}
    ],
    "thresholds":{"immediate":65,"digest":50}}'::jsonb, true)
on conflict (slug, version) do nothing;


-- =============================================================================
-- SECTION 17 — Post-deploy assertions
--
-- Run these after every migration. They are the cheapest possible regression
-- test for the security model, and they will catch the single most common
-- Supabase production incident: a new table shipped without RLS.
-- =============================================================================

do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ')
    into v_bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity;
  if v_bad is not null then
    raise exception 'Tables in public without RLS enabled: %', v_bad;
  end if;
end $$;

do $$
declare v_bad text;
begin
  -- Any policy that forgot `TO authenticated` (roles = {public}) is both a
  -- performance and a correctness problem.
  select string_agg(format('%s.%s', schemaname, policyname), ', ')
    into v_bad
    from pg_policies
   where schemaname = 'public'
     and roles = '{public}';
  if v_bad is not null then
    raise warning 'Policies missing an explicit TO role: %', v_bad;
  end if;
end $$;
