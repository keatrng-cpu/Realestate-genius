-- =============================================================================
-- Realestate Genius — migration 0003: the AI brain
--
-- Depends on 0001_base_schema.sql for:
--   public.profiles, public.properties, public.addresses,
--   public.message_author_kind, public.ai_disposition,
--   public.set_updated_at(), the `private` schema.
--
-- Everything here is idempotent (`if not exists` / `create or replace` /
-- `drop policy if exists`), so re-running the file is a no-op.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS ADDS AND WHY IT IS SHAPED THIS WAY
-- -----------------------------------------------------------------------------
-- Five tables and one RPC, borrowed wholesale from the Pantheon architecture
-- that already runs in production on another product:
--
--   ai_conversations  a chat thread with one assistant persona
--   ai_messages       every turn, with provider/model/token/disposition audit
--   ai_memory         DURABLE FACTS about a user ("owns a duplex on Reeves")
--   ai_events         a LEARNING LOG — append-only, what happened over time
--   ai_brain_state    STANDING DIRECTIVES — one row per user, the current read
--
--   get_ai_brain()    one round trip that assembles all of the above into a
--                     single jsonb context block
--
-- The split matters. Memory is what is *true*; events are what *happened*;
-- brain_state is what the system has *decided to do about it*. Collapsing them
-- into one "context" table loses the ability to expire events without
-- forgetting facts, or to rewrite the standing directive without rewriting
-- history.
--
-- -----------------------------------------------------------------------------
-- THE NON-NEGOTIABLE RULE, RESTATED (see 0001 header, design rule 2)
-- -----------------------------------------------------------------------------
--   THE AI NEVER COMPUTES A NUMBER.
--
-- Nothing in this migration stores a model-produced quantity. `ai_messages`
-- holds prose, an enum disposition, and token counters written by our own
-- transport code — never a score, a rent estimate, a cap rate, or a dollar
-- amount authored by a model. Those live in `analyses` / `analysis_factors` /
-- `ledger_postings`, written exclusively by deterministic TypeScript and SQL.
--
-- Note what is deliberately ABSENT here: the `reject_numbers_in_narrative`
-- trigger that guards `analyses.narrative` is NOT applied to `ai_messages.body`.
-- That is intentional, not an oversight. A chat reply must be able to say "the
-- $1,450 rent figure on your ledger" — quoting a number that was computed
-- deterministically and passed *into* the prompt is the entire point. A blunt
-- reject would make the assistant unable to discuss its own inputs. The
-- enforcement for chat is a *shadow numeric-provenance guard* in
-- src/lib/ai/brain.ts: every numeral in a reply is checked against the context
-- ledger the model was given, and unsourced numerals are logged to `ai_events`
-- as kind 'numeric_guard_shadow'. Detection, then escalation once the false
-- positive rate is known — not a hard block that breaks the product on day one.
--
-- -----------------------------------------------------------------------------
-- FAIR HOUSING
-- -----------------------------------------------------------------------------
-- As with `profiles`, there is no column anywhere below for a person's race,
-- color, religion, sex, familial status, national origin, or disability. There
-- must never be. `ai_memory` in particular is a tempting place to accumulate
-- "notes about a tenant" — the CHECK on `kind` deliberately offers no bucket
-- for personal characteristics, and `guardrails_triggered` on `ai_messages`
-- exists so a refusal is provable after the fact.
-- =============================================================================


-- =============================================================================
-- SECTION 0 — Enums
--
-- `message_author_kind` and `ai_disposition` come from 0001. They are recreated
-- here under a duplicate_object guard purely so this file can be applied to a
-- database where 0001 landed partially; on a normal run these are no-ops.
-- =============================================================================

do $$
begin
  create type public.message_author_kind as enum ('user', 'assistant', 'system');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.ai_disposition as enum (
    'answered', 'declined_out_of_scope', 'escalated_to_human',
    'declined_legal_advice', 'declined_fair_housing'
  );
exception when duplicate_object then null;
end $$;

-- The four assistant personas. An enum rather than free text because the
-- persona selects the system prompt AND the data-visibility posture — a typo
-- that silently fell through to a default would be a cross-party leak.
do $$
begin
  create type public.ai_persona as enum (
    'buyer_intel',   -- explains what the deterministic analysis found
    'landlord_ops',  -- maintenance triage, lease questions, tenant comms drafts
    'tenant_help',   -- repair reporting, rights-adjacent info, NEVER legal advice
    'deal_desk'      -- multi-party deal guidance
  );
exception when duplicate_object then null;
end $$;

-- Which upstream actually answered. Recorded per message so a bad answer can be
-- traced to a provider, and so the routing table can be audited against reality
-- rather than against its own comments.
do $$
begin
  create type public.ai_provider as enum ('anthropic', 'xai', 'none');
exception when duplicate_object then null;
end $$;
comment on type public.ai_provider is
  '''none'' means no model was called — a deterministic refusal or a '
  'guardrail short-circuit produced the reply.';


-- =============================================================================
-- SECTION 1 — Conversations and messages
-- =============================================================================

create table if not exists public.ai_conversations (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  persona       public.ai_persona not null,
  -- Model-written, ~60 chars. Prose only; see the header rule.
  title         text,
  -- Optional subject. Both are nullable: "explain cap rate to me" has no
  -- address. When set, the deterministic context loader scopes what it fetches.
  subject_address_id  uuid references public.addresses(id)  on delete set null,
  subject_property_id uuid references public.properties(id) on delete set null,
  last_message_at timestamptz,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists ai_conversations_profile_idx
  on public.ai_conversations (profile_id, last_message_at desc nulls last);
create index if not exists ai_conversations_property_idx
  on public.ai_conversations (subject_property_id)
  where subject_property_id is not null;

drop trigger if exists ai_conversations_updated_at on public.ai_conversations;
create trigger ai_conversations_updated_at
  before update on public.ai_conversations
  for each row execute function public.set_updated_at();


create table if not exists public.ai_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  author_kind     public.message_author_kind not null,
  -- Prose, an enum, or a classification. NEVER a computed quantity.
  body            text not null,

  -- Transport audit. Written by our code, never by a model.
  provider        public.ai_provider,
  model           text,
  -- The routing-table key that selected the model (e.g. 'landlord_ops_chat').
  -- Lets you answer "which route is burning the budget" with a group-by.
  task            text,
  -- True when the primary provider failed and the fallback answered. The single
  -- most useful reliability metric this table produces.
  fallback_used   boolean not null default false,

  -- Token accounting. `reasoning_tokens` is separate because xAI's grok-4.x
  -- models burn reasoning tokens that do NOT appear in the visible completion —
  -- a trivial one-word reply measured 88 of them. Folding those into
  -- output_tokens would be wrong; omitting them understates spend.
  input_tokens        integer check (input_tokens        is null or input_tokens        >= 0),
  cached_input_tokens integer check (cached_input_tokens is null or cached_input_tokens >= 0),
  output_tokens       integer check (output_tokens       is null or output_tokens       >= 0),
  reasoning_tokens    integer check (reasoning_tokens    is null or reasoning_tokens    >= 0),
  latency_ms          integer check (latency_ms          is null or latency_ms          >= 0),

  -- Compliance record. `disposition` is the UPL / fair-housing defense: proof
  -- the assistant declined, and on what ground.
  disposition          public.ai_disposition,
  guardrails_triggered text[] not null default '{}',

  created_at      timestamptz not null default now(),

  -- A user turn has no provider. An assistant turn always records how it was
  -- produced, even when that answer came from a deterministic refusal
  -- (provider = 'none').
  constraint ai_messages_provider_ck check (
    (author_kind = 'user'   and provider is null and disposition is null) or
    (author_kind = 'system' and provider is null) or
    (author_kind = 'assistant' and provider is not null and disposition is not null)
  ),
  -- 'none' is the only provider allowed to have no model id.
  constraint ai_messages_model_ck check (
    provider is null or provider = 'none' or model is not null
  )
);

create index if not exists ai_messages_conversation_idx
  on public.ai_messages (conversation_id, created_at);
-- Cost/quality rollups: "what did grok-4.5 cost us on deal_redteam last week".
create index if not exists ai_messages_model_idx
  on public.ai_messages (model, created_at desc) where model is not null;
-- Compliance sweep: every refusal, newest first.
create index if not exists ai_messages_disposition_idx
  on public.ai_messages (disposition, created_at desc)
  where disposition is not null and disposition <> 'answered';

comment on column public.ai_messages.body is
  'Qualitative output only: prose, classifications, enum selections. Any '
  'number appearing here must be verbatim from the deterministic context block '
  'the model was given — see the shadow numeric-provenance guard in '
  'src/lib/ai/brain.ts.';


-- Keep the thread's sort key hot without a correlated subquery in the inbox.
create or replace function private.touch_ai_conversation()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.ai_conversations
     set last_message_at = new.created_at
   where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists ai_messages_touch_conversation on public.ai_messages;
create trigger ai_messages_touch_conversation
  after insert on public.ai_messages
  for each row execute function private.touch_ai_conversation();


-- =============================================================================
-- SECTION 2 — Durable memory
--
-- Facts that stay true between sessions. Small, curated, user-visible and
-- user-deletable. This is NOT a transcript archive: if it grows past a few
-- dozen rows per user, the write path is too loose.
-- =============================================================================

create table if not exists public.ai_memory (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,

  kind         text not null check (kind in (
                 'fact',        -- "owns a 4-plex at 214 Reeves Dr"
                 'preference',  -- "wants plain language, no jargon"
                 'goal',        -- "targeting a second rental by spring"
                 'constraint',  -- "cash purchase only, no financing"
                 'portfolio',   -- "manages 3 properties, 11 units"
                 'directive'    -- standing instruction from the user
               )),

  -- NOTE the absence of a 'personal' or 'demographic' kind. There is no bucket
  -- here for a person's protected characteristics, by design. See file header.

  content      text not null check (char_length(content) between 1 and 400),
  importance   smallint not null default 3 check (importance between 1 and 5),

  -- NULL = every persona sees it. Set = scoped to one persona, so a landlord
  -- ops note never surfaces in the tenant assistant.
  persona      public.ai_persona,

  source       text not null default 'system' check (source in
                 ('system', 'user', 'chat', 'analysis', 'import')),
  active       boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index if not exists ai_memory_profile_idx
  on public.ai_memory (profile_id, importance desc, last_seen_at desc)
  where active;

-- Dedup key. A NULL persona means "every persona sees it", and by default NULLs
-- are DISTINCT in a unique index — so the same global fact could be inserted
-- forever. `nulls not distinct` (PG15+) makes NULL compare equal here.
--
-- The obvious alternative, coalesce(persona::text, '*'), does NOT work: casting
-- an enum to text is only STABLE, not IMMUTABLE (labels can be renamed), and
-- Postgres rejects non-IMMUTABLE functions in an index expression.
create unique index if not exists ai_memory_dedup_uq
  on public.ai_memory (profile_id, persona, lower(content))
  nulls not distinct;


-- =============================================================================
-- SECTION 3 — Learning log
--
-- Append-only. What happened, in order. Trimmed to the newest 300 rows per user
-- by record_ai_event() so it cannot become an unbounded transcript store.
-- =============================================================================

create table if not exists public.ai_events (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,

  domain     text not null check (domain in (
               'search', 'analysis', 'listing', 'maintenance', 'lease',
               'payment', 'deal', 'chat', 'system'
             )),
  kind       text not null default 'observation' check (kind in (
               'observation',          -- something was noticed
               'outcome',              -- something concluded
               'milestone',            -- a step the user completed
               'adjustment',           -- the system changed its approach
               'refusal',              -- the assistant declined
               'numeric_guard_shadow'  -- an unsourced numeral appeared in a reply
             )),

  summary    text not null check (char_length(summary) between 1 and 400),
  data       jsonb not null default '{}'::jsonb,
  -- Salience. The context assembler prefers heavier events when it truncates.
  weight     smallint not null default 1 check (weight between 1 and 5),
  created_at timestamptz not null default now()
);

create index if not exists ai_events_profile_time_idx
  on public.ai_events (profile_id, created_at desc);
create index if not exists ai_events_profile_domain_idx
  on public.ai_events (profile_id, domain, created_at desc);
-- The compliance/quality sweep: every guard hit and every refusal.
create index if not exists ai_events_kind_idx
  on public.ai_events (kind, created_at desc)
  where kind in ('refusal', 'numeric_guard_shadow');


-- =============================================================================
-- SECTION 4 — Standing directives
--
-- One row per user. The system's current read on them, refreshed periodically
-- from the event log. Read on every turn, written rarely.
-- =============================================================================

create table if not exists public.ai_brain_state (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  -- One line. "Comparing two Grand Forks duplexes, financing not yet arranged."
  headline   text check (headline is null or char_length(headline) <= 200),
  summary    text check (summary  is null or char_length(summary)  <= 1000),
  -- { phase, priorities[], watchouts[] } — prose fragments only, no metrics.
  focus      jsonb not null default '{}'::jsonb,
  -- Which model wrote this read, or 'rule-based' when the deterministic
  -- fallback did. Never leave it null: an unattributable directive is
  -- unauditable.
  model      text,
  updated_at timestamptz not null default now()
);

comment on table public.ai_brain_state is
  'Standing directives. Contains prose and enum-ish strings only — never a '
  'score, target, or dollar figure. Quantitative state belongs in analyses.';


-- =============================================================================
-- SECTION 5 — RLS
--
-- Owner-only on every table. `auth.uid()` is wrapped as `(select auth.uid())`
-- so Postgres evaluates it once per query via an InitPlan instead of once per
-- row (Supabase's auth_rls_initplan advisor; matters at a few thousand rows).
--
-- service_role bypasses all of this — that is how the server-side transport in
-- src/lib/ai/ writes assistant turns after authorising the caller itself.
-- =============================================================================

alter table public.ai_conversations enable row level security;
alter table public.ai_messages      enable row level security;
alter table public.ai_memory        enable row level security;
alter table public.ai_events        enable row level security;
alter table public.ai_brain_state   enable row level security;

-- Resolves the caller's own thread ids without recursing into ai_messages'
-- own policy. Same idiom as private.conversation_ids() in 0001.
create or replace function private.ai_conversation_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(c.id), '{}'::uuid[])
    from public.ai_conversations c
   where c.profile_id = (select auth.uid());
$$;
-- 0001 ends with `grant execute on all functions in schema private to
-- authenticated`, which ran before this function existed. Without an explicit
-- grant here the default PUBLIC execute is the only thing keeping it callable,
-- and revoking PUBLIC below would silently break every ai_messages policy that
-- depends on it — the table would simply return zero rows for everyone.
revoke all on function private.ai_conversation_ids() from public, anon;
grant execute on function private.ai_conversation_ids() to authenticated;


-- --- ai_conversations --------------------------------------------------------
drop policy if exists ai_conversations_select_own on public.ai_conversations;
create policy ai_conversations_select_own on public.ai_conversations
  for select to authenticated
  using ( profile_id = (select auth.uid()) );

drop policy if exists ai_conversations_insert_own on public.ai_conversations;
create policy ai_conversations_insert_own on public.ai_conversations
  for insert to authenticated
  with check ( profile_id = (select auth.uid()) );

drop policy if exists ai_conversations_update_own on public.ai_conversations;
create policy ai_conversations_update_own on public.ai_conversations
  for update to authenticated
  using      ( profile_id = (select auth.uid()) )
  with check ( profile_id = (select auth.uid()) );

drop policy if exists ai_conversations_delete_own on public.ai_conversations;
create policy ai_conversations_delete_own on public.ai_conversations
  for delete to authenticated
  using ( profile_id = (select auth.uid()) );


-- --- ai_messages -------------------------------------------------------------
-- Read own threads. Insert only your OWN user turns: an assistant turn is
-- written server-side with service_role, so a client cannot forge a reply
-- (and then screenshot "the assistant told me I could withhold rent").
drop policy if exists ai_messages_select_own on public.ai_messages;
create policy ai_messages_select_own on public.ai_messages
  for select to authenticated
  using ( conversation_id = any (private.ai_conversation_ids()) );

drop policy if exists ai_messages_insert_own_user_turn on public.ai_messages;
create policy ai_messages_insert_own_user_turn on public.ai_messages
  for insert to authenticated
  with check (
    author_kind = 'user'
    and conversation_id = any (private.ai_conversation_ids())
  );

-- No UPDATE and no DELETE policy, deliberately. The transcript is the
-- compliance record; a user who could edit it could rewrite a refusal.
-- Deleting the conversation cascades, which is the supported way out.


-- --- ai_memory ---------------------------------------------------------------
-- Full CRUD: memory is user-facing and must be correctable. A user who cannot
-- delete a wrong fact about themselves will stop trusting the assistant.
drop policy if exists ai_memory_select_own on public.ai_memory;
create policy ai_memory_select_own on public.ai_memory
  for select to authenticated
  using ( profile_id = (select auth.uid()) );

drop policy if exists ai_memory_insert_own on public.ai_memory;
create policy ai_memory_insert_own on public.ai_memory
  for insert to authenticated
  with check ( profile_id = (select auth.uid()) );

drop policy if exists ai_memory_update_own on public.ai_memory;
create policy ai_memory_update_own on public.ai_memory
  for update to authenticated
  using      ( profile_id = (select auth.uid()) )
  with check ( profile_id = (select auth.uid()) );

drop policy if exists ai_memory_delete_own on public.ai_memory;
create policy ai_memory_delete_own on public.ai_memory
  for delete to authenticated
  using ( profile_id = (select auth.uid()) );


-- --- ai_events ---------------------------------------------------------------
-- SELECT only. The learning log is evidence; a client that could rewrite it
-- could erase the record of a guard firing. Writes go through the
-- security-definer RPC below, or service_role.
drop policy if exists ai_events_select_own on public.ai_events;
create policy ai_events_select_own on public.ai_events
  for select to authenticated
  using ( profile_id = (select auth.uid()) );


-- --- ai_brain_state ----------------------------------------------------------
-- SELECT only. Standing directives are authored by the system, not requested
-- by the user; a self-authored directive is a prompt-injection surface.
drop policy if exists ai_brain_state_select_own on public.ai_brain_state;
create policy ai_brain_state_select_own on public.ai_brain_state
  for select to authenticated
  using ( profile_id = (select auth.uid()) );


-- =============================================================================
-- SECTION 6 — Write RPCs
--
-- security definer + `set search_path = ''` so every object reference below is
-- fully schema-qualified and cannot be hijacked by a caller-set search_path.
-- =============================================================================

-- Append to the learning log, then trim to the newest 300 rows for this user.
-- The trim lives HERE rather than in application code so the bound holds no
-- matter which path writes.
create or replace function public.record_ai_event(
  p_domain  text,
  p_summary text,
  p_kind    text  default 'observation',
  p_data    jsonb default '{}'::jsonb,
  p_weight  int   default 1
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id  uuid;
begin
  if v_uid is null then
    return null;
  end if;

  insert into public.ai_events (profile_id, domain, kind, summary, data, weight)
  values (
    v_uid,
    p_domain,
    coalesce(p_kind, 'observation'),
    left(trim(p_summary), 400),
    coalesce(p_data, '{}'::jsonb),
    greatest(1, least(coalesce(p_weight, 1), 5))
  )
  returning id into v_id;

  delete from public.ai_events e
   where e.profile_id = v_uid
     and e.id not in (
       select id from public.ai_events
        where profile_id = v_uid
        order by created_at desc
        limit 300
     );

  return v_id;
end;
$$;

-- Upsert a durable fact. Dedup is a case-insensitive exact content match within
-- (user, persona) — deliberately NOT fuzzy. A fuzzy match that silently merges
-- "owns 214 Reeves" with "owns 216 Reeves" is worse than a duplicate row.
-- On a hit: keep the HIGHER importance and refresh last_seen_at, so a fact that
-- keeps coming up rises rather than resetting.
create or replace function public.record_ai_memory(
  p_kind       text,
  p_content    text,
  p_importance int  default 3,
  p_persona    public.ai_persona default null,
  p_source     text default 'system'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_id     uuid;
  v_imp    smallint := greatest(1, least(coalesce(p_importance, 3), 5))::smallint;
  v_body   text     := left(trim(p_content), 400);
begin
  if v_uid is null or v_body = '' then
    return null;
  end if;

  -- Aliased as `m` because DO UPDATE cannot reference the target by its
  -- schema-qualified name — `public.ai_memory.importance` raises "missing
  -- FROM-clause entry for table public". The alias is the portable fix.
  insert into public.ai_memory as m
    (profile_id, kind, content, importance, persona, source)
  values (v_uid, p_kind, v_body, v_imp, p_persona, coalesce(p_source, 'system'))
  on conflict (profile_id, coalesce(persona::text, '*'), lower(content))
  do update set
    importance   = greatest(m.importance, excluded.importance),
    active       = true,
    last_seen_at = now()
  returning m.id into v_id;

  return v_id;
end;
$$;


-- =============================================================================
-- SECTION 7 — get_ai_brain: the single context-assembly round trip
--
-- Returns ONE jsonb object holding everything the prompt builder needs. One
-- RPC rather than four selects because the chat endpoint is latency-bound and
-- each extra round trip to Postgres is ~15-40ms of dead time before the first
-- token.
--
-- Returns jsonb, NOT text. Rendering to the "=== CONTEXT ===" block happens in
-- TypeScript (src/lib/ai/brain.ts, brainBlock()) so the wording can change
-- without a migration, and so the same jsonb can feed a non-prompt consumer.
--
-- EVERY VALUE IN HERE IS EITHER PROSE OR A COUNT READ STRAIGHT FROM A ROW.
-- Nothing is derived, averaged, or projected. If a future edit is tempted to
-- add `avg(...)` or a dollar computation, that belongs in the deterministic
-- analysis layer, and its OUTPUT can be passed in — not computed here for a
-- model to read as if it were ground truth.
-- =============================================================================

create or replace function public.get_ai_brain(p_user uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- auth.uid() wins when present. p_user is only honoured for the service-role
  -- path (cron, batch analysis), where there is no JWT to read. A signed-in
  -- caller therefore cannot pass someone else's uuid and read their brain.
  v_uid     uuid := coalesce((select auth.uid()), p_user);
  v_result  jsonb;
  v_intents jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'no_user');
  end if;

  -- `account_intents` is owned by the onboarding migration, which may land
  -- before or after this one. Probe rather than hard-depend: a missing intents
  -- list degrades the assistant's tone slightly; a missing table that hard-
  -- errors takes the whole chat endpoint down.
  if to_regclass('public.account_intents') is not null then
    execute
      'select coalesce(to_jsonb(a.intents), ''[]''::jsonb)
         from public.account_intents a where a.id = $1'
      into v_intents
      using v_uid;
    v_intents := coalesce(v_intents, '[]'::jsonb);
  end if;

  v_result := jsonb_build_object(
    'profile', (
      select jsonb_build_object(
               'display_name', p.display_name,
               'locale',       p.locale,
               'timezone',     p.timezone
             )
        from public.profiles p
       where p.id = v_uid
    ),

    -- What they told us they came here to do. Signal for tone and which
    -- persona to offer — NEVER an authorisation check. See src/lib/auth/roles.ts.
    'intents', v_intents,

    -- Standing directives.
    'brain_state', (
      select jsonb_build_object(
               'headline',   b.headline,
               'summary',    b.summary,
               'focus',      b.focus,
               'updated_at', b.updated_at
             )
        from public.ai_brain_state b
       where b.profile_id = v_uid
    ),

    -- Durable facts. Heaviest first, most recently reinforced next. Capped at
    -- 20 in SQL; brainBlock() truncates again to 8 for the prompt.
    -- Built with an explicit jsonb_build_object rather than to_jsonb(row) so
    -- `last_seen_at` can be an ORDER BY key without also landing in the prompt.
    -- It has to be in the subquery's select list to be orderable here, and it
    -- is pure noise to the model.
    'memory', (
      select coalesce(
               jsonb_agg(
                 jsonb_build_object(
                   'kind',       m.kind,
                   'content',    m.content,
                   'importance', m.importance,
                   'persona',    m.persona
                 )
                 order by m.importance desc, m.last_seen_at desc
               ),
               '[]'::jsonb
             )
        from (
          select kind, content, importance, persona, last_seen_at
            from public.ai_memory
           where profile_id = v_uid and active
           order by importance desc, last_seen_at desc
           limit 20
        ) m
    ),

    -- Learning log, newest first. `data` is deliberately excluded: it is a
    -- debugging payload, often large, and never belongs in a prompt.
    'recent_events', (
      select coalesce(jsonb_agg(e order by e.created_at desc), '[]'::jsonb)
        from (
          select domain, kind, summary, weight, created_at
            from public.ai_events
           where profile_id = v_uid
           order by created_at desc
           limit 14
        ) e
    ),

    -- Portfolio shape. Plain counts of rows the caller can already see — no
    -- derived metric, no money. Present so the assistant knows whether it is
    -- talking to a first-time buyer or an eleven-unit landlord and can pitch
    -- its answer accordingly.
    'portfolio', (
      select jsonb_build_object(
               'property_count', count(distinct pm.property_id),
               'roles',          coalesce(to_jsonb(array_agg(distinct pm.role::text)), '[]'::jsonb)
             )
        from public.property_members pm
       where pm.profile_id = v_uid
    ),

    'generated_at', now()
  );

  return v_result;
end;
$$;

comment on function public.get_ai_brain(uuid) is
  'Assembles the AI context block for one user. Returns prose, enums and raw '
  'row counts ONLY — never a derived or computed quantity. Quantitative '
  'context must be computed in deterministic code and passed into the prompt '
  'alongside this block.';


-- =============================================================================
-- SECTION 8 — Grants
--
-- Deny to anon by default; these functions all read personal data.
-- =============================================================================

revoke execute on function public.get_ai_brain(uuid)                      from public, anon;
revoke execute on function public.record_ai_event(text, text, text, jsonb, int) from public, anon;
revoke execute on function public.record_ai_memory(text, text, int, public.ai_persona, text) from public, anon;

grant execute on function public.get_ai_brain(uuid)                       to authenticated, service_role;
grant execute on function public.record_ai_event(text, text, text, jsonb, int) to authenticated, service_role;
grant execute on function public.record_ai_memory(text, text, int, public.ai_persona, text) to authenticated, service_role;
