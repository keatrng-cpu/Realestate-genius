-- =============================================================================
-- 0006 — INGESTION SUPPORT
--
-- Structure the generic ArcGIS ingestion engine (`src/lib/ingest/*`,
-- `scripts/ingest.mjs`) needs and 0001-0005 do not provide:
--
--   A. `public.jurisdictions`          — the coverage registry. The honest
--                                        answer to "which cities do you cover,
--                                        and how deeply".
--   B. `public.parcel_zoning_overrides`— PUD / conditional-use / overlay
--                                        records, and the flag that tells
--                                        downstream code the base district's
--                                        dimensional standards DO NOT APPLY.
--   C. `parcels.zoning_code_secondary_raw` — Zone2 is a real secondary
--                                        district and dropping it loses law.
--   D. `public.parcel_zoning_context`  — one view a caller can trust before
--                                        rendering any zoning number.
--   E. `fact_types` seed               — the typed vocabulary the parcel
--                                        ingest emits.
--   F. `property_facts` idempotency    — a partial unique index so re-running
--                                        an ingest updates instead of doubling.
--
-- Conventions inherited from 0005: `create table if not exists`, RLS enabled on
-- every table, policies dropped and recreated, `(select auth.uid())` never
-- bare, `to authenticated` on every policy, functions `security definer` with
-- `set search_path = ''`. Idempotent end to end.
-- =============================================================================


-- =============================================================================
-- SECTION A — Jurisdiction registry / coverage depth
--
-- WHY THIS EXISTS: "we cover 3,000 cities" is a lie unless you say what
-- "cover" means. Having every parcel boundary in a city is not the same as
-- knowing its minimum lot area, and only the second one can produce a dollar
-- figure. This table forces the distinction to be a stored, queryable,
-- publishable value rather than a marketing claim.
-- =============================================================================

create table if not exists public.jurisdictions (
  slug                 text primary key,          -- 'fargo-nd', matches the CLI arg
  display_name         text not null,             -- 'Fargo, ND'
  city                 text not null,
  state                char(2) not null,
  county_fips          char(5) not null,

  -- The coverage ladder. Each rung is a strictly stronger claim.
  --   none               nothing ingested
  --   boundaries_only    we know the place exists; no parcels
  --   parcels_mapped     parcels + raw zoning CODES; no dimensional standards
  --   standards_partial  some districts have human-verified standards
  --   standards_verified every district in the jurisdiction is verified
  coverage_depth       text not null default 'none'
                       check (coverage_depth in
                         ('none','boundaries_only','parcels_mapped',
                          'standards_partial','standards_verified')),

  parcel_count                    integer not null default 0,
  address_count                   integer not null default 0,
  zoning_district_count           integer not null default 0,
  zoning_district_verified_count  integer not null default 0,
  -- Parcels whose base-district standards are superseded (PUD etc.). These can
  -- never be answered from district standards no matter how verified they are.
  parcels_with_superseding_override integer not null default 0,
  -- Parcels with no zoning district on record at all.
  parcels_zoning_unknown          integer not null default 0,

  primary_source_id    uuid references public.data_sources(id),
  last_ingested_at     timestamptz,
  last_ingest_run_id   uuid references app.ingest_runs(id),
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.jurisdictions is
  'Coverage registry. coverage_depth is the ONLY honest way to answer "do you '
  'cover my city". parcels_mapped means we hold boundaries and the raw zoning '
  'code and nothing more: no minimum lot area, no setbacks, no height, no ADU '
  'permission. Those are LAW and require a human reading the ordinance. Never '
  'render a jurisdiction as "covered" without rendering its coverage_depth '
  'next to it.';

comment on column public.jurisdictions.parcels_with_superseding_override is
  'Parcels where a PUD or equivalent replaces the base district standards. For '
  'these, district-level dimensional answers are wrong by construction, not '
  'merely unverified.';

drop trigger if exists jurisdictions_updated_at on public.jurisdictions;
create trigger jurisdictions_updated_at before update on public.jurisdictions
  for each row execute function public.set_updated_at();


-- =============================================================================
-- SECTION B — Parcel-level zoning overrides (PUD / CUP / overlay / variance)
--
-- THE SINGLE MOST IMPORTANT TABLE IN THIS MIGRATION.
--
-- A Planned Unit Development is not a zoning district with different numbers.
-- It is a negotiated site plan, approved by ordinance for one specific piece of
-- land, that REPLACES the base district's dimensional standards with terms
-- recorded in a document. Those terms are in no GIS layer, no assessor extract,
-- and no open-data portal — they are in a PDF attached to a council resolution,
-- if they are digitised at all.
--
-- Consequently: for a parcel with supersedes_base_standards = true, returning
-- the base district's minimum lot area, setbacks, height limit, density cap or
-- coverage cap is not "unverified" — it is WRONG. It is the highest-severity
-- incorrect answer this product can produce, because it is specific,
-- plausible, actionable, and about to be relied on by someone spending money.
-- =============================================================================

create table if not exists public.parcel_zoning_overrides (
  id            uuid primary key default gen_random_uuid(),
  parcel_id     uuid not null references public.parcels(id) on delete cascade,
  override_kind text not null
                check (override_kind in
                  ('pud','conditional_use','overlay','variance','development_agreement')),
  -- PUD number, CUP case id, overlay code. As published; may be non-numeric.
  identifier    text,
  effective_on  date,

  -- See the header comment. This is read by the API layer as a hard gate.
  supersedes_base_standards boolean not null default false,

  note          text,
  detail        jsonb not null default '{}'::jsonb,
  source_id     uuid not null references public.data_sources(id),
  observed_at   timestamptz not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.parcel_zoning_overrides is
  'Parcel-specific departures from the base zoning district. When '
  'supersedes_base_standards is true the base district dimensional standards '
  'DO NOT APPLY and must not be rendered for this parcel under any confidence '
  'label; surface the override identifier and route the user to the recorded '
  'document instead.';

-- Idempotency anchor. `identifier` may legitimately be null (an overlay with no
-- case number), so coalesce it rather than letting NULL defeat the constraint.
create unique index if not exists parcel_zoning_overrides_uq
  on public.parcel_zoning_overrides (parcel_id, override_kind, coalesce(identifier, ''));
create index if not exists parcel_zoning_overrides_parcel_idx
  on public.parcel_zoning_overrides (parcel_id);
create index if not exists parcel_zoning_overrides_supersede_idx
  on public.parcel_zoning_overrides (parcel_id) where supersedes_base_standards;

drop trigger if exists parcel_zoning_overrides_updated_at on public.parcel_zoning_overrides;
create trigger parcel_zoning_overrides_updated_at before update on public.parcel_zoning_overrides
  for each row execute function public.set_updated_at();


-- =============================================================================
-- SECTION C — Secondary zoning district on the parcel
--
-- Fargo's Zone2 is a real second district applying to part of a split-zoned
-- parcel (and is literally 'PUD' on 11 of them). Dropping it because the spine
-- only modelled one code would silently discard law.
-- =============================================================================

alter table public.parcels
  add column if not exists zoning_code_secondary_raw text;

comment on column public.parcels.zoning_code_secondary_raw is
  'Secondary/split zoning district as published. A parcel carrying this is '
  'split-zoned: neither district describes the whole parcel and any '
  'dimensional answer needs the boundary between them, which is not in the '
  'attribute table.';


-- =============================================================================
-- SECTION D — The view a caller should read before rendering any zoning number
-- =============================================================================

create or replace view public.parcel_zoning_context
  with (security_invoker = true) as
select
  p.id                            as parcel_id,
  p.apn,
  p.county_fips,
  p.zoning_code_raw,
  p.zoning_code_secondary_raw,
  p.zoning_district_id,
  z.jurisdiction,
  z.code                          as district_code,
  z.verified_at                   as district_verified_at,
  -- Is the district even known? NULL zoning is right-of-way, unzoned land, or
  -- a mapping gap. It is not a district called 'NULL'.
  (p.zoning_code_raw is not null) as zoning_known,
  (p.zoning_code_secondary_raw is not null) as split_zoned,
  exists (
    select 1 from public.parcel_zoning_overrides o
     where o.parcel_id = p.id and o.supersedes_base_standards
  )                               as base_standards_superseded,
  exists (
    select 1 from public.parcel_zoning_overrides o
     where o.parcel_id = p.id and o.override_kind = 'conditional_use'
  )                               as has_conditional_use,
  -- THE GATE. False means: do not render a dimensional standard for this
  -- parcel, at any confidence level, with any caveat.
  (
        p.zoning_code_raw is not null
    and z.id is not null
    and z.verified_at is not null
    and not exists (
      select 1 from public.parcel_zoning_overrides o
       where o.parcel_id = p.id and o.supersedes_base_standards
    )
  )                               as base_standards_usable
from public.parcels p
left join public.zoning_districts z on z.id = p.zoning_district_id;

comment on view public.parcel_zoning_context is
  'Read this before rendering any zoning-derived number. base_standards_usable '
  'is false whenever the district is unknown, unverified, or superseded by a '
  'PUD. There is no caveat text that makes a superseded standard safe to show.';


-- =============================================================================
-- SECTION E — fact_types vocabulary emitted by the parcel/zoning ingest
--
-- FAIR HOUSING: school assignment and neighborhood name are marked
-- fair_housing_sensitive. Per 0001 §9 that means they may be DISPLAYED as
-- neutral facts and may NEVER be an input to a ranking, score, or
-- recommendation shown to a consumer. School quality and neighborhood name are
-- textbook proxies for protected class, and a "best neighborhoods" ranking
-- built on them is a steering claim waiting to happen.
-- =============================================================================

insert into public.fact_types
  (key, display_name, value_type, unit, category, fair_housing_sensitive, consumer_visible, description)
values
  ('year_built', 'Year Built', 'integer', null, 'structure', false, true,
   'Assessor-recorded year of original construction. Not the year of the most recent major renovation.'),
  ('building_floor_area_sqft', 'Building Floor Area', 'integer', 'sqft', 'structure', false, true,
   'Total building square footage as carried by the assessor. Basis (finished only, above-grade only, gross) varies by jurisdiction and is generally not documented.'),
  ('main_floor_area_sqft', 'Main Floor Area', 'integer', 'sqft', 'structure', false, true,
   'Main-floor area. The closest available proxy for building FOOTPRINT, which is what lot-coverage math needs; it is a proxy, not a measurement.'),
  ('building_stories', 'Stories', 'number', 'stories', 'structure', false, true,
   'Storey count. NOT a height in feet — do not convert. Storey height varies from 8ft to 20ft and a zoning height limit is measured in feet.'),
  ('dwelling_units', 'Dwelling Units', 'integer', 'units', 'structure', false, true,
   'Dwelling unit count as recorded. Frequently null for 1-4 unit residential, where absence means "not recorded", not "one unit".'),
  ('lot_width_front_ft', 'Lot Width (front)', 'number', 'ft', 'structure', false, true,
   'Frontage width from the assessor lot card.'),
  ('lot_width_rear_ft', 'Lot Width (rear)', 'number', 'ft', 'structure', false, true,
   'Rear width from the assessor lot card. Differs from frontage on irregular and cul-de-sac lots.'),
  ('lot_depth_ft', 'Lot Depth', 'number', 'ft', 'structure', false, true,
   'Primary lot depth from the assessor lot card.'),
  ('lot_depth_secondary_ft', 'Lot Depth (secondary)', 'number', 'ft', 'structure', false, true,
   'Second depth measurement on an irregular lot.'),
  ('assessor_segment_area_sqft', 'Assessor Segment Area', 'integer', 'sqft', 'structure', false, false,
   'Segment-level area from the assessor. On a condo or apartment parcel this is the unit segment, NOT the lot. Never use it as lot size; parcels.lot_size_sqft is the parcel figure.'),
  ('assessed_land_value_cents', 'Assessed Land Value', 'money_cents', 'usd_cents', 'financial', false, true,
   'Assessor land value. An assessed value is not a market value and the ratio between them varies by jurisdiction and year.'),
  ('assessed_improvement_value_cents', 'Assessed Improvement Value', 'money_cents', 'usd_cents', 'financial', false, true,
   'Assessor building/improvement value.'),
  ('assessed_total_value_cents', 'Assessed Total Value', 'money_cents', 'usd_cents', 'financial', false, true,
   'Assessor total value. Not a market value, not an appraisal, not a listing price.'),
  ('assessment_year', 'Assessment Year', 'integer', null, 'financial', false, true,
   'Tax year the assessed values belong to. Assessors publish forward-dated years; a 2027 value is next cycle''s working number, not a stale one.'),
  ('land_use_code', 'Land Use Code', 'text', null, 'legal', false, true,
   'Assessor land-use classification code. A tax classification, NOT a zoning district and NOT a permission to do anything.'),
  ('land_use_description', 'Land Use', 'text', null, 'legal', false, true,
   'Human-readable assessor land-use classification.'),
  ('property_type_description', 'Property Type', 'text', null, 'structure', false, true,
   'Assessor structure type description.'),
  ('zoning_code_primary', 'Zoning District (primary)', 'text', null, 'legal', false, true,
   'Base zoning district code as published by the jurisdiction. The CODE only. It carries no dimensional standards; those are in the ordinance.'),
  ('zoning_code_secondary', 'Zoning District (secondary)', 'text', null, 'legal', false, true,
   'Second district on a split-zoned parcel. Its presence means no single district describes the whole parcel.'),
  ('comprehensive_plan_designation', 'Comprehensive Plan Designation', 'text', null, 'legal', false, true,
   'Future land-use designation from the comprehensive plan. ASPIRATIONAL, not regulatory: it describes what the city hopes the area becomes and confers no right to build anything.'),
  ('school_district', 'School District', 'text', null, 'location', true, true,
   'FAIR HOUSING SENSITIVE. Display only. Must never be an input to a score, ranking or recommendation shown to a consumer.'),
  ('elementary_school', 'Elementary School', 'text', null, 'location', true, true,
   'FAIR HOUSING SENSITIVE. Display only, never a scoring input.'),
  ('middle_school', 'Middle School', 'text', null, 'location', true, true,
   'FAIR HOUSING SENSITIVE. Display only, never a scoring input.'),
  ('high_school', 'High School', 'text', null, 'location', true, true,
   'FAIR HOUSING SENSITIVE. Display only, never a scoring input.'),
  ('neighborhood_name', 'Neighborhood', 'text', null, 'location', true, true,
   'FAIR HOUSING SENSITIVE. Neighborhood name is a well-established proxy for protected class. Display only, never a scoring input.')
on conflict (key) do update set
  display_name           = excluded.display_name,
  value_type             = excluded.value_type,
  unit                   = excluded.unit,
  category               = excluded.category,
  fair_housing_sensitive = excluded.fair_housing_sensitive,
  consumer_visible       = excluded.consumer_visible,
  description            = excluded.description;


-- =============================================================================
-- SECTION F — property_facts idempotency
--
-- `property_facts` has no natural key in 0001, which is correct for a store
-- that keeps history. But an ingest that re-runs nightly needs SOMETHING to
-- conflict on or it doubles the table every night.
--
-- The rule this index encodes: one CURRENT row per (address, fact, source).
-- Different sources still coexist and disagree, which is the point of the
-- table. Superseded rows are exempt from the index, so explicit versioning
-- (set superseded_at, insert a new row) still works when a caller wants it.
-- =============================================================================

create unique index if not exists property_facts_source_current_uq
  on public.property_facts (address_id, fact_key, source_id)
  where superseded_at is null;


-- =============================================================================
-- SECTION G — Coverage recompute
-- =============================================================================

create or replace function public.refresh_jurisdiction_coverage(p_slug text)
returns public.jurisdictions
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.jurisdictions;
  v_parcels        integer := 0;
  v_addresses      integer := 0;
  v_districts      integer := 0;
  v_verified       integer := 0;
  v_superseded     integer := 0;
  v_zoning_unknown integer := 0;
  v_depth          text;
begin
  select * into j from public.jurisdictions where slug = p_slug;
  if not found then
    raise exception 'unknown jurisdiction %', p_slug;
  end if;

  if j.primary_source_id is not null then
    select count(*) into v_parcels
      from public.parcels p where p.source_id = j.primary_source_id;

    select count(*) into v_zoning_unknown
      from public.parcels p
     where p.source_id = j.primary_source_id and p.zoning_code_raw is null;

    select count(distinct o.parcel_id) into v_superseded
      from public.parcel_zoning_overrides o
      join public.parcels p on p.id = o.parcel_id
     where o.supersedes_base_standards and p.source_id = j.primary_source_id;

    -- Count addresses through the parcel link rather than by matching the city
    -- string. City text is display-cased and varies between feeds; the
    -- address -> parcel -> source path is exact.
    select count(distinct ap.address_id) into v_addresses
      from public.address_parcels ap
      join public.parcels p on p.id = ap.parcel_id
     where p.source_id = j.primary_source_id;
  else
    select count(*) into v_addresses
      from public.addresses a
     where upper(a.city) = upper(j.city) and a.state = j.state;
  end if;

  select count(*), count(*) filter (where z.verified_at is not null)
    into v_districts, v_verified
    from public.zoning_districts z
   where z.jurisdiction = j.display_name;

  v_depth := case
    when v_parcels = 0                              then 'boundaries_only'
    when v_districts = 0                            then 'parcels_mapped'
    when v_verified = 0                             then 'parcels_mapped'
    when v_verified < v_districts                   then 'standards_partial'
    else 'standards_verified'
  end;

  update public.jurisdictions set
    parcel_count                      = v_parcels,
    address_count                     = v_addresses,
    zoning_district_count             = v_districts,
    zoning_district_verified_count    = v_verified,
    parcels_with_superseding_override = v_superseded,
    parcels_zoning_unknown            = v_zoning_unknown,
    coverage_depth                    = v_depth
  where slug = p_slug
  returning * into j;

  return j;
end;
$$;

comment on function public.refresh_jurisdiction_coverage(text) is
  'Recompute coverage counters from what is actually in the database. Called '
  'at the end of every ingest run. Deliberately derives coverage_depth rather '
  'than letting a caller assert it.';

revoke all on function public.refresh_jurisdiction_coverage(text) from public;
grant execute on function public.refresh_jurisdiction_coverage(text) to service_role;


-- =============================================================================
-- SECTION H — RLS
--
-- Both new tables are public-record reference data, readable by any signed-in
-- user and writable only by the ingest pipeline (service_role, which bypasses
-- RLS). No anon access: requiring a login is what makes rate-limiting and
-- abuse-tracing possible, per 0001 §14.3.
-- =============================================================================

alter table public.jurisdictions             enable row level security;
alter table public.parcel_zoning_overrides   enable row level security;

drop policy if exists jurisdictions_select_authed on public.jurisdictions;
create policy jurisdictions_select_authed on public.jurisdictions
  for select to authenticated using (true);

drop policy if exists parcel_zoning_overrides_select_authed on public.parcel_zoning_overrides;
create policy parcel_zoning_overrides_select_authed on public.parcel_zoning_overrides
  for select to authenticated using (true);

-- A signed-in user may annotate an override they are actively verifying only
-- through the audited path; no direct write policy is granted here. The
-- `(select auth.uid())` form below is the house pattern for any policy that
-- later needs an owner check — kept as the documented shape, not as dead code:
-- there is deliberately no INSERT/UPDATE/DELETE policy on either table, so
-- writes are service_role-only and every change is attributable to an
-- `app.ingest_runs` row.

revoke all on public.jurisdictions           from anon;
revoke all on public.parcel_zoning_overrides from anon;
revoke all on public.parcel_zoning_context   from anon;
grant select on public.parcel_zoning_context to authenticated;
