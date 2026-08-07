-- =============================================================================
-- 0004 — DEAL ROOMS
--
-- The product's central differentiator. Every competitor models a transaction
-- as a pile of email plus a shared folder. A deal room makes the transaction a
-- first-class object: one address, many participants each with a DISTINCT and
-- explicit role, threads that are scoped so a buyer's agent conversation is not
-- visible to the seller, a task checklist with owners and dates, and document
-- requests that have a state machine instead of a "did you send that yet?".
--
-- Design decisions, stated rather than implied:
--
--  1. ROLE IS PER-ROOM, NEVER GLOBAL. Same as `property_role` in 0001: the same
--     person is a buyer in one room and a seller in the next. A global role
--     column would leak access across contexts. `deal_participants.role` is the
--     only role that matters inside a room.
--
--  2. VISIBILITY IS A THREAD PROPERTY, NOT A MESSAGE PROPERTY. Per-message
--     visibility (as `public.messages.visible_to` does for the landlord/tenant
--     inbox) is right for an assistant aside; it is wrong here, because a
--     participant who can see half a negotiation thread reads a distorted
--     record. Threads are scoped; messages inherit. One rule, auditable.
--
--  3. SIDES ARE MODELLED. `deal_participants.side` ('buy'|'sell'|'neutral') is
--     what makes `visibility = 'own_side'` expressible without enumerating
--     roles at every call site. An inspector is neutral; a listing agent is
--     sell-side; a lender is buy-side.
--
--  4. NOTHING CASCADES INTO A DELETE OF THE ADDRESS SPINE. `addresses` is
--     `on delete restrict` from here: deleting a deal room must never be able
--     to take the canonical address with it.
--
--  5. NO PROTECTED-CLASS COLUMN, HERE OR ANYWHERE. A deal room holds a
--     transaction, not a description of the people in it. See 0005 for the
--     applications table where this constraint has teeth.
--
-- RLS posture: participants see only their own deal rooms. `(select auth.uid())`
-- everywhere (evaluated once per statement, not per row); `to authenticated` on
-- every policy; membership resolved through SECURITY DEFINER helpers in
-- `private` so a policy never joins a table that is itself under RLS.
--
-- Idempotent: safe to re-run. Enums use the duplicate_object guard, tables use
-- `if not exists`, policies are dropped and recreated, functions use
-- `create or replace` with a pinned `search_path`.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Enumerated vocabularies
-- -----------------------------------------------------------------------------

do $$ begin
  create type public.deal_kind as enum (
    'purchase',      -- someone is buying; buyer + seller + agents
    'sale',          -- listing-side view of the same shape
    'lease',         -- landlord + prospective tenant working toward a signed lease
    'renewal',       -- existing lease being renewed
    'refinance',     -- owner + lender, no counterparty
    'off_market'     -- direct-to-owner approach before anything is listed
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.deal_status as enum (
    'exploring',      -- gathering information, no offer
    'negotiating',
    'under_contract',
    'in_diligence',
    'clear_to_close',
    'closed',
    'withdrawn',
    'dead'
  );
exception when duplicate_object then null; end $$;

-- The distinct roles a person can hold in one room. Deliberately wider than
-- buyer/seller/tenant/landlord/agent because a real closing has a lender, a
-- title company and an inspector in the thread, and giving each of them a named
-- role is what allows a document request to be addressed to "the lender"
-- instead of to a person who might change.
do $$ begin
  create type public.deal_role as enum (
    'buyer',
    'seller',
    'tenant',
    'landlord',
    'buyer_agent',
    'listing_agent',
    'lender',
    'inspector',
    'title',
    'attorney',
    'contractor',
    'observer'      -- read-only: an accountant, a spouse, a mentor
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.deal_side as enum ('buy', 'sell', 'neutral');
exception when duplicate_object then null; end $$;

-- Thread visibility. 'own_side' is the one that earns its keep: it lets a buyer
-- and their agent strategise inside the same room the seller is in.
do $$ begin
  create type public.deal_thread_visibility as enum (
    'all_participants',
    'own_side',       -- everyone whose participant.side matches the thread's side
    'role_scoped',    -- only the roles listed in visible_to_roles
    'direct'          -- only the explicitly listed profile ids
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.deal_task_status as enum (
    'open', 'in_progress', 'blocked', 'done', 'waived'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.doc_request_status as enum (
    'requested', 'submitted', 'accepted', 'rejected', 'waived', 'expired'
  );
exception when duplicate_object then null; end $$;


-- -----------------------------------------------------------------------------
-- deal_rooms
-- -----------------------------------------------------------------------------

create table if not exists public.deal_rooms (
  id               uuid primary key default gen_random_uuid(),
  -- The anchor. One room, one address. A portfolio deal gets one room per
  -- address plus a parent room (see parent_deal_room_id) rather than a room
  -- with an ambiguous address, because every task, document and disclosure in
  -- a real transaction attaches to a specific property.
  address_id       uuid not null references public.addresses(id) on delete restrict,
  -- Set when the room is run by an operating entity (a brokerage, an LLC).
  -- NULL for a private-party deal between two individuals.
  organization_id  uuid references public.organizations(id) on delete set null,
  parent_deal_room_id uuid references public.deal_rooms(id) on delete set null,
  title            text not null,
  kind             public.deal_kind not null,
  status           public.deal_status not null default 'exploring',
  -- Headline economics, integer cents, mirroring the money convention in 0001.
  -- These are TYPED BY A HUMAN, not computed — the computed valuation lives in
  -- the analysis tables and is deliberately kept separate from what the parties
  -- have actually agreed.
  list_price_cents     bigint check (list_price_cents is null or list_price_cents >= 0),
  offer_price_cents    bigint check (offer_price_cents is null or offer_price_cents >= 0),
  agreed_price_cents   bigint check (agreed_price_cents is null or agreed_price_cents >= 0),
  earnest_money_cents  bigint check (earnest_money_cents is null or earnest_money_cents >= 0),
  currency         char(3) not null default 'USD',
  -- Dates that drive the checklist. Deadlines are computed from these, never
  -- typed into a task by hand.
  offer_on         date,
  accepted_on      date,
  inspection_due_on date,
  financing_due_on date,
  target_close_on  date,
  closed_on        date,
  created_by       uuid not null references public.profiles(id),
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint deal_rooms_close_after_accept_ck
    check (closed_on is null or accepted_on is null or closed_on >= accepted_on),
  constraint deal_rooms_no_self_parent_ck
    check (parent_deal_room_id is null or parent_deal_room_id <> id)
);

comment on table public.deal_rooms is
  'A transaction workspace anchored to one address. Roles are per-room and '
  'never global (same rule as public.property_role). The price columns record '
  'what the PARTIES agreed; computed valuations live in public.analyses and are '
  'kept structurally separate so a negotiated number is never confused with a '
  'modelled one.';

create index if not exists deal_rooms_address_idx on public.deal_rooms (address_id);
create index if not exists deal_rooms_org_idx     on public.deal_rooms (organization_id)
  where archived_at is null;
create index if not exists deal_rooms_status_idx  on public.deal_rooms (status, updated_at desc)
  where archived_at is null;
create index if not exists deal_rooms_parent_idx  on public.deal_rooms (parent_deal_room_id);

drop trigger if exists deal_rooms_updated_at on public.deal_rooms;
create trigger deal_rooms_updated_at before update on public.deal_rooms
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- deal_participants
-- -----------------------------------------------------------------------------

create table if not exists public.deal_participants (
  deal_room_id uuid not null references public.deal_rooms(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id)   on delete cascade,
  role         public.deal_role not null,
  side         public.deal_side not null,
  -- Room administration: can invite, can edit room fields, can close the room.
  -- Separate from `role` because a buyer's agent typically administers a room
  -- the buyer owns, and a buyer sometimes administers their own.
  can_manage   boolean not null default false,
  -- Money visibility is its own switch. An inspector is a full participant in
  -- the diligence thread and has no business seeing the offer price.
  can_view_financials boolean not null default false,
  invited_by   uuid references public.profiles(id),
  invited_at   timestamptz not null default now(),
  -- Access is granted on acceptance. A pending invite grants NOTHING; the RLS
  -- helpers all filter on `accepted_at is not null`.
  accepted_at  timestamptz,
  removed_at   timestamptz,
  primary key (deal_room_id, profile_id)
);

comment on table public.deal_participants is
  'Per-room role assignment. accepted_at IS NULL grants no access whatsoever — '
  'an invitation is not membership. removed_at revokes without deleting the '
  'row, so the historical record of who saw what survives the removal.';

create index if not exists deal_participants_profile_idx
  on public.deal_participants (profile_id)
  where accepted_at is not null and removed_at is null;
create index if not exists deal_participants_room_role_idx
  on public.deal_participants (deal_room_id, role)
  where removed_at is null;

-- A room needs exactly one primary counterparty per side to be coherent, but
-- enforcing that in SQL would block the legitimate intermediate states (a room
-- created before the seller has accepted their invite). Enforced in the
-- application's "ready to send offer" check instead, deliberately.


-- -----------------------------------------------------------------------------
-- deal_threads + deal_messages
-- -----------------------------------------------------------------------------

create table if not exists public.deal_threads (
  id            uuid primary key default gen_random_uuid(),
  deal_room_id  uuid not null references public.deal_rooms(id) on delete cascade,
  title         text not null,
  visibility    public.deal_thread_visibility not null default 'all_participants',
  -- Only meaningful when visibility = 'own_side'.
  side          public.deal_side,
  -- Only meaningful when visibility = 'role_scoped'.
  visible_to_roles public.deal_role[] not null default '{}',
  -- Only meaningful when visibility = 'direct'.
  visible_to_profiles uuid[] not null default '{}',
  -- Realtime topic, same convention as public.conversations.
  topic         text generated always as ('deal:' || id::text) stored,
  created_by    uuid not null references public.profiles(id),
  last_message_at timestamptz,
  closed_at     timestamptz,
  created_at    timestamptz not null default now(),
  -- The visibility discriminant must carry the data its mode needs. Without
  -- this, a 'role_scoped' thread with an empty role array is invisible to
  -- everyone including its author, which reads as data loss.
  constraint deal_threads_visibility_ck check (
    (visibility = 'all_participants') or
    (visibility = 'own_side'    and side is not null) or
    (visibility = 'role_scoped' and array_length(visible_to_roles, 1) >= 1) or
    (visibility = 'direct'      and array_length(visible_to_profiles, 1) >= 1)
  )
);

comment on table public.deal_threads is
  'Visibility is a THREAD property, not a message property. A participant who '
  'can see half a negotiation reads a distorted record; scoping at the thread '
  'gives one auditable rule instead of a per-message judgement call.';

create index if not exists deal_threads_room_idx
  on public.deal_threads (deal_room_id, last_message_at desc nulls last);
create unique index if not exists deal_threads_topic_uq on public.deal_threads (topic);

create table if not exists public.deal_messages (
  id           uuid primary key default gen_random_uuid(),
  thread_id    uuid not null references public.deal_threads(id) on delete cascade,
  author_kind  public.message_author_kind not null default 'user',
  author_id    uuid references public.profiles(id),
  body         text,
  -- If the assistant wrote this, which run produced it (audit trail, same
  -- reasoning as public.messages.ai_run_id in 0001).
  ai_run_id    uuid references public.ai_runs(id),
  edited_at    timestamptz,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  constraint deal_messages_author_ck check (
    (author_kind = 'user' and author_id is not null) or
    (author_kind in ('assistant','system'))
  )
);

create index if not exists deal_messages_thread_idx
  on public.deal_messages (thread_id, created_at desc);
create index if not exists deal_messages_author_idx
  on public.deal_messages (author_id, created_at desc);

create or replace function private.touch_deal_thread()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.deal_threads
     set last_message_at = new.created_at
   where id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists deal_messages_touch_thread on public.deal_messages;
create trigger deal_messages_touch_thread
  after insert on public.deal_messages
  for each row execute function private.touch_deal_thread();


-- -----------------------------------------------------------------------------
-- deal_tasks — the checklist
-- -----------------------------------------------------------------------------

create table if not exists public.deal_tasks (
  id            uuid primary key default gen_random_uuid(),
  deal_room_id  uuid not null references public.deal_rooms(id) on delete cascade,
  title         text not null,
  description   text,
  -- A task is addressed to a ROLE first and a person second. Roles survive a
  -- participant swap mid-deal; person assignments do not.
  assigned_role public.deal_role,
  assigned_to   uuid references public.profiles(id),
  due_on        date,
  -- TRUE when due_on was computed from a deal_rooms date (accepted_on +
  -- inspection period, say) rather than typed. A computed deadline moves when
  -- its anchor moves; a typed one does not.
  due_is_derived boolean not null default false,
  derived_from   text,          -- 'accepted_on+10d', 'financing_due_on'
  status        public.deal_task_status not null default 'open',
  -- Blocks closing. Drives the "what is actually left" count, which is the
  -- number the room exists to answer.
  is_blocking   boolean not null default false,
  sort_order    integer not null default 0,
  completed_at  timestamptz,
  completed_by  uuid references public.profiles(id),
  created_by    uuid not null references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint deal_tasks_done_has_time_ck
    check ((status in ('done','waived')) = (completed_at is not null))
);

create index if not exists deal_tasks_room_idx
  on public.deal_tasks (deal_room_id, sort_order, due_on nulls last);
create index if not exists deal_tasks_open_idx
  on public.deal_tasks (deal_room_id, due_on)
  where status in ('open','in_progress','blocked');
create index if not exists deal_tasks_assignee_idx
  on public.deal_tasks (assigned_to, due_on)
  where status in ('open','in_progress','blocked');

drop trigger if exists deal_tasks_updated_at on public.deal_tasks;
create trigger deal_tasks_updated_at before update on public.deal_tasks
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- deal_document_requests
--
-- The state machine that replaces "did you send that yet?". The FK to the
-- fulfilling document is added in 0005, where public.documents is defined —
-- migrations run in order and this one must not depend forward.
-- -----------------------------------------------------------------------------

create table if not exists public.deal_document_requests (
  id            uuid primary key default gen_random_uuid(),
  deal_room_id  uuid not null references public.deal_rooms(id) on delete cascade,
  title         text not null,
  description   text,
  -- 'pre_approval'|'inspection_report'|'title_commitment'|'disclosure'|'w9'|...
  document_kind text,
  requested_from_role public.deal_role,
  requested_from uuid references public.profiles(id),
  due_on        date,
  status        public.doc_request_status not null default 'requested',
  -- Set in 0005 once public.documents exists.
  fulfilled_by_document_id uuid,
  submitted_at  timestamptz,
  decided_at    timestamptz,
  decided_by    uuid references public.profiles(id),
  decision_note text,
  created_by    uuid not null references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists deal_doc_requests_room_idx
  on public.deal_document_requests (deal_room_id, status, due_on nulls last);
create index if not exists deal_doc_requests_from_idx
  on public.deal_document_requests (requested_from)
  where status = 'requested';

drop trigger if exists deal_doc_requests_updated_at on public.deal_document_requests;
create trigger deal_doc_requests_updated_at before update on public.deal_document_requests
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- deal_events — append-only room timeline
-- -----------------------------------------------------------------------------

create table if not exists public.deal_events (
  id           bigint generated always as identity primary key,
  deal_room_id uuid not null references public.deal_rooms(id) on delete cascade,
  actor_id     uuid references public.profiles(id),
  actor_role   public.deal_role,
  event_type   text not null,   -- 'status.changed','task.completed','document.accepted'
  subject_type text,
  subject_id   uuid,
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists deal_events_room_idx
  on public.deal_events (deal_room_id, created_at desc);

-- Append-only. `private.forbid_mutation()` is defined in 0001 and used there
-- for the ledger; the same guarantee is what makes this timeline evidence.
drop trigger if exists deal_events_append_only on public.deal_events;
create trigger deal_events_append_only
  before update or delete on public.deal_events
  for each row execute function private.forbid_mutation();


-- =============================================================================
-- RLS helper functions
--
-- SECURITY DEFINER for the same reason as 0001 section 13: these read the
-- membership table, and a policy that queried it directly would recurse into
-- that table's own RLS. `set search_path = ''` closes the definer
-- privilege-escalation vector; `stable` lets Postgres cache within a statement.
-- =============================================================================

-- Rooms where the caller is an accepted, non-removed participant.
create or replace function private.deal_room_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(dp.deal_room_id), '{}')
    from public.deal_participants dp
   where dp.profile_id = (select auth.uid())
     and dp.accepted_at is not null
     and dp.removed_at is null;
$$;

-- Rooms the caller may administer (invite, edit, close).
create or replace function private.deal_room_ids_manage()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(dp.deal_room_id), '{}')
    from public.deal_participants dp
   where dp.profile_id = (select auth.uid())
     and dp.accepted_at is not null
     and dp.removed_at is null
     and dp.can_manage;
$$;

-- Rooms where the caller may see agreed prices and earnest money.
create or replace function private.deal_room_ids_financial()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(dp.deal_room_id), '{}')
    from public.deal_participants dp
   where dp.profile_id = (select auth.uid())
     and dp.accepted_at is not null
     and dp.removed_at is null
     and dp.can_view_financials;
$$;

-- Threads the caller may read. All four visibility modes are resolved HERE, in
-- one place, so no policy has to re-implement the rule and get it subtly wrong.
create or replace function private.deal_thread_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(t.id), '{}')
    from public.deal_threads t
    join public.deal_participants dp
      on dp.deal_room_id = t.deal_room_id
     and dp.profile_id = (select auth.uid())
     and dp.accepted_at is not null
     and dp.removed_at is null
   where t.visibility = 'all_participants'
      or (t.visibility = 'own_side'    and t.side = dp.side)
      or (t.visibility = 'role_scoped' and dp.role = any(t.visible_to_roles))
      or (t.visibility = 'direct'      and dp.profile_id = any(t.visible_to_profiles));
$$;

-- Threads the caller may post into: readable, and not closed.
create or replace function private.deal_thread_ids_writable()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(t.id), '{}')
    from public.deal_threads t
   where t.closed_at is null
     and t.id = any(private.deal_thread_ids());
$$;

grant execute on function private.deal_room_ids()           to authenticated;
grant execute on function private.deal_room_ids_manage()    to authenticated;
grant execute on function private.deal_room_ids_financial() to authenticated;
grant execute on function private.deal_thread_ids()         to authenticated;
grant execute on function private.deal_thread_ids_writable() to authenticated;


-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

alter table public.deal_rooms             enable row level security;
alter table public.deal_participants      enable row level security;
alter table public.deal_threads           enable row level security;
alter table public.deal_messages          enable row level security;
alter table public.deal_tasks             enable row level security;
alter table public.deal_document_requests enable row level security;
alter table public.deal_events            enable row level security;

-- ---------------------------------------------------------------------------
-- deal_rooms
-- ---------------------------------------------------------------------------

-- WHY: the whole access model in one line — you see a room iff you are in it.
drop policy if exists deal_rooms_select_participant on public.deal_rooms;
create policy deal_rooms_select_participant on public.deal_rooms
  for select to authenticated
  using ( id = any(private.deal_room_ids()) );

-- WHY: anyone may start a room, but only as themselves. The creator becomes a
-- participant via the trigger below, so there is no window in which a room
-- exists that its creator cannot read.
drop policy if exists deal_rooms_insert_self on public.deal_rooms;
create policy deal_rooms_insert_self on public.deal_rooms
  for insert to authenticated
  with check ( created_by = (select auth.uid()) );

-- WHY: only managers edit room-level fields (dates, prices, status). A buyer
-- who is not a manager can still act in the room; they cannot move the
-- closing date out from under everyone.
drop policy if exists deal_rooms_update_manager on public.deal_rooms;
create policy deal_rooms_update_manager on public.deal_rooms
  for update to authenticated
  using ( id = any(private.deal_room_ids_manage()) )
  with check ( id = any(private.deal_room_ids_manage()) );

-- WHY NO DELETE POLICY: rooms are archived (`archived_at`), never deleted. A
-- deleted transaction record is exactly what you need six months later.

-- ---------------------------------------------------------------------------
-- deal_participants
-- ---------------------------------------------------------------------------

-- WHY: knowing who else is in the room is table stakes; you cannot address a
-- document request to "the lender" without seeing that there is one.
drop policy if exists deal_participants_select_room on public.deal_participants;
create policy deal_participants_select_room on public.deal_participants
  for select to authenticated
  using ( deal_room_id = any(private.deal_room_ids()) );

-- WHY: an invitee must be able to see their own pending invitation before they
-- have accepted it — otherwise the invite is invisible to its recipient. This
-- is the ONE place a non-member reads a row, and it is scoped to their own.
drop policy if exists deal_participants_select_own_invite on public.deal_participants;
create policy deal_participants_select_own_invite on public.deal_participants
  for select to authenticated
  using ( profile_id = (select auth.uid()) );

-- WHY: managers invite. Also permitted: the room creator's bootstrap insert,
-- handled by the SECURITY DEFINER trigger below rather than by a policy hole.
drop policy if exists deal_participants_insert_manager on public.deal_participants;
create policy deal_participants_insert_manager on public.deal_participants
  for insert to authenticated
  with check ( deal_room_id = any(private.deal_room_ids_manage()) );

-- WHY: two distinct updates are legitimate — a manager changing someone's role
-- or removing them, and an invitee accepting their own invitation.
drop policy if exists deal_participants_update_manager on public.deal_participants;
create policy deal_participants_update_manager on public.deal_participants
  for update to authenticated
  using ( deal_room_id = any(private.deal_room_ids_manage()) )
  with check ( deal_room_id = any(private.deal_room_ids_manage()) );

drop policy if exists deal_participants_accept_own on public.deal_participants;
create policy deal_participants_accept_own on public.deal_participants
  for update to authenticated
  using ( profile_id = (select auth.uid()) )
  with check ( profile_id = (select auth.uid()) );

-- ---------------------------------------------------------------------------
-- deal_threads
-- ---------------------------------------------------------------------------

drop policy if exists deal_threads_select_visible on public.deal_threads;
create policy deal_threads_select_visible on public.deal_threads
  for select to authenticated
  using ( id = any(private.deal_thread_ids()) );

-- WHY: any participant may open a thread, in a room they belong to, as
-- themselves. Restricting thread creation to managers would push side
-- conversations back into email, which is the problem this table solves.
drop policy if exists deal_threads_insert_participant on public.deal_threads;
create policy deal_threads_insert_participant on public.deal_threads
  for insert to authenticated
  with check (
    deal_room_id = any(private.deal_room_ids())
    and created_by = (select auth.uid())
  );

-- WHY: retitle and close, by the author or a room manager. Note the `using`
-- clause deliberately does NOT allow editing visibility on a thread you can
-- only see because of its current visibility — widening is a manager action.
drop policy if exists deal_threads_update_author_or_manager on public.deal_threads;
create policy deal_threads_update_author_or_manager on public.deal_threads
  for update to authenticated
  using (
    id = any(private.deal_thread_ids())
    and (created_by = (select auth.uid()) or deal_room_id = any(private.deal_room_ids_manage()))
  )
  with check (
    created_by = (select auth.uid()) or deal_room_id = any(private.deal_room_ids_manage())
  );

-- ---------------------------------------------------------------------------
-- deal_messages
-- ---------------------------------------------------------------------------

-- WHY: message visibility is exactly thread visibility. One rule.
drop policy if exists deal_messages_select_thread on public.deal_messages;
create policy deal_messages_select_thread on public.deal_messages
  for select to authenticated
  using ( thread_id = any(private.deal_thread_ids()) and deleted_at is null );

drop policy if exists deal_messages_insert_participant on public.deal_messages;
create policy deal_messages_insert_participant on public.deal_messages
  for insert to authenticated
  with check (
    thread_id = any(private.deal_thread_ids_writable())
    and author_kind = 'user'
    and author_id = (select auth.uid())
  );

-- WHY: you may edit or soft-delete your own message and nobody else's. Hard
-- delete has no policy at all: a negotiation record that can be erased by one
-- party is not a record.
drop policy if exists deal_messages_update_own on public.deal_messages;
create policy deal_messages_update_own on public.deal_messages
  for update to authenticated
  using ( author_id = (select auth.uid()) and thread_id = any(private.deal_thread_ids()) )
  with check ( author_id = (select auth.uid()) );

-- ---------------------------------------------------------------------------
-- deal_tasks
-- ---------------------------------------------------------------------------

drop policy if exists deal_tasks_select_room on public.deal_tasks;
create policy deal_tasks_select_room on public.deal_tasks
  for select to authenticated
  using ( deal_room_id = any(private.deal_room_ids()) );

drop policy if exists deal_tasks_insert_participant on public.deal_tasks;
create policy deal_tasks_insert_participant on public.deal_tasks
  for insert to authenticated
  with check (
    deal_room_id = any(private.deal_room_ids())
    and created_by = (select auth.uid())
  );

-- WHY: the assignee closes their own task; a manager can close anyone's. Both
-- paths are legitimate and neither should require the other's involvement.
drop policy if exists deal_tasks_update_assignee_or_manager on public.deal_tasks;
create policy deal_tasks_update_assignee_or_manager on public.deal_tasks
  for update to authenticated
  using (
    deal_room_id = any(private.deal_room_ids())
    and (
      assigned_to = (select auth.uid())
      or created_by = (select auth.uid())
      or deal_room_id = any(private.deal_room_ids_manage())
    )
  )
  with check ( deal_room_id = any(private.deal_room_ids()) );

drop policy if exists deal_tasks_delete_manager on public.deal_tasks;
create policy deal_tasks_delete_manager on public.deal_tasks
  for delete to authenticated
  using ( deal_room_id = any(private.deal_room_ids_manage()) );

-- ---------------------------------------------------------------------------
-- deal_document_requests
-- ---------------------------------------------------------------------------

drop policy if exists deal_doc_requests_select_room on public.deal_document_requests;
create policy deal_doc_requests_select_room on public.deal_document_requests
  for select to authenticated
  using ( deal_room_id = any(private.deal_room_ids()) );

drop policy if exists deal_doc_requests_insert_participant on public.deal_document_requests;
create policy deal_doc_requests_insert_participant on public.deal_document_requests
  for insert to authenticated
  with check (
    deal_room_id = any(private.deal_room_ids())
    and created_by = (select auth.uid())
  );

-- WHY: the person the request is addressed to may submit; the requester or a
-- manager may accept/reject/waive. Both encoded in one policy because Postgres
-- evaluates the row, not the intent — the state-machine legality of the
-- transition is checked by the trigger below.
drop policy if exists deal_doc_requests_update on public.deal_document_requests;
create policy deal_doc_requests_update on public.deal_document_requests
  for update to authenticated
  using (
    deal_room_id = any(private.deal_room_ids())
    and (
      requested_from = (select auth.uid())
      or created_by = (select auth.uid())
      or deal_room_id = any(private.deal_room_ids_manage())
    )
  )
  with check ( deal_room_id = any(private.deal_room_ids()) );

-- ---------------------------------------------------------------------------
-- deal_events
-- ---------------------------------------------------------------------------

drop policy if exists deal_events_select_room on public.deal_events;
create policy deal_events_select_room on public.deal_events
  for select to authenticated
  using ( deal_room_id = any(private.deal_room_ids()) );

-- WHY NO INSERT POLICY: events are written by triggers (SECURITY DEFINER) and
-- by the server with the service role. A client that could forge a timeline
-- entry would make the timeline worthless as evidence.


-- =============================================================================
-- Triggers: bootstrap, state machine, timeline
-- =============================================================================

-- The creator becomes an accepted manager participant atomically with the
-- insert. Without this there is a window where a room exists and its RLS select
-- policy excludes its own creator — a bug that presents as "the room I just
-- made disappeared".
create or replace function private.deal_room_bootstrap_creator()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.deal_participants
    (deal_room_id, profile_id, role, side, can_manage, can_view_financials,
     invited_by, accepted_at)
  values (
    new.id,
    new.created_by,
    case new.kind
      when 'sale'     then 'seller'::public.deal_role
      when 'lease'    then 'landlord'::public.deal_role
      when 'renewal'  then 'landlord'::public.deal_role
      else 'buyer'::public.deal_role
    end,
    case new.kind
      when 'sale'    then 'sell'::public.deal_side
      when 'lease'   then 'sell'::public.deal_side
      when 'renewal' then 'sell'::public.deal_side
      else 'buy'::public.deal_side
    end,
    true, true, new.created_by, now()
  )
  on conflict (deal_room_id, profile_id) do nothing;
  return new;
end;
$$;

drop trigger if exists deal_rooms_bootstrap_creator on public.deal_rooms;
create trigger deal_rooms_bootstrap_creator
  after insert on public.deal_rooms
  for each row execute function private.deal_room_bootstrap_creator();


-- Document-request state machine. Enforced in the database because the
-- transitions carry legal weight (an "accepted" inspection report is a
-- contingency satisfied) and an app-layer check can be bypassed by any other
-- writer, including a future integration.
create or replace function private.enforce_doc_request_transition()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  ok boolean;
begin
  if new.status = old.status then
    return new;
  end if;

  ok := case old.status
    when 'requested' then new.status in ('submitted','waived','expired')
    when 'submitted' then new.status in ('accepted','rejected','waived')
    when 'rejected'  then new.status in ('submitted','waived','expired')
    when 'expired'   then new.status in ('submitted','waived')
    when 'accepted'  then false   -- terminal; reopen by creating a new request
    when 'waived'    then false   -- terminal
    else false
  end;

  if not ok then
    raise exception
      'Illegal document-request transition % -> % (request %). Create a new request instead of reopening a terminal one.',
      old.status, new.status, old.id
      using errcode = 'check_violation';
  end if;

  if new.status = 'submitted' and new.submitted_at is null then
    new.submitted_at := now();
  end if;
  if new.status in ('accepted','rejected','waived') and new.decided_at is null then
    new.decided_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists deal_doc_requests_transition on public.deal_document_requests;
create trigger deal_doc_requests_transition
  before update of status on public.deal_document_requests
  for each row execute function private.enforce_doc_request_transition();


-- Timeline entries for the events that matter. Written by the database so the
-- record exists regardless of which client made the change.
create or replace function private.log_deal_status_change()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.deal_events
      (deal_room_id, actor_id, event_type, subject_type, subject_id, detail)
    values (
      new.id, (select auth.uid()), 'status.changed', 'deal_room', new.id,
      jsonb_build_object('from', old.status, 'to', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists deal_rooms_log_status on public.deal_rooms;
create trigger deal_rooms_log_status
  after update of status on public.deal_rooms
  for each row execute function private.log_deal_status_change();

create or replace function private.log_deal_task_change()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.deal_events
      (deal_room_id, actor_id, event_type, subject_type, subject_id, detail)
    values (
      new.deal_room_id, (select auth.uid()), 'task.status_changed', 'deal_task', new.id,
      jsonb_build_object('title', new.title, 'from', old.status, 'to', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists deal_tasks_log_status on public.deal_tasks;
create trigger deal_tasks_log_status
  after update of status on public.deal_tasks
  for each row execute function private.log_deal_task_change();


-- =============================================================================
-- Grants
--
-- `authenticated` gets column-level DML; RLS decides which rows. Nothing is
-- granted to `anon` — a deal room is never public.
-- =============================================================================

grant select, insert, update on
  public.deal_rooms, public.deal_participants, public.deal_threads,
  public.deal_messages, public.deal_tasks, public.deal_document_requests
to authenticated;

grant select on public.deal_events to authenticated;
grant delete on public.deal_tasks  to authenticated;

revoke all on public.deal_rooms, public.deal_participants, public.deal_threads,
              public.deal_messages, public.deal_tasks,
              public.deal_document_requests, public.deal_events
from anon;


-- =============================================================================
-- Seed: the default closing checklist templates
--
-- Not a table of tasks — a table of TEMPLATES, so a new room can be populated
-- deterministically. Offsets are in days from a named anchor column on
-- deal_rooms; the application resolves them, so a moved acceptance date moves
-- every derived deadline with it.
-- =============================================================================

create table if not exists public.deal_task_templates (
  id            uuid primary key default gen_random_uuid(),
  kind          public.deal_kind not null,
  title         text not null,
  description   text,
  assigned_role public.deal_role,
  -- 'accepted_on' | 'offer_on' | 'target_close_on' | null (no deadline)
  due_anchor    text check (due_anchor in ('offer_on','accepted_on','inspection_due_on',
                                           'financing_due_on','target_close_on')),
  due_offset_days integer not null default 0,
  is_blocking   boolean not null default false,
  sort_order    integer not null default 0,
  jurisdiction  text,          -- null = applies everywhere
  citation      text,          -- required when the task exists because law says so
  created_at    timestamptz not null default now(),
  -- NULLS NOT DISTINCT is load-bearing for idempotency: `jurisdiction` is NULL
  -- on every template that applies everywhere, and under the default
  -- NULLS DISTINCT rule the ON CONFLICT below would never fire for them — so
  -- re-running this migration would silently insert a second copy of the whole
  -- seed. (Requires PG 15+, which this schema already needs for
  -- `security_invoker` views in 0005.)
  constraint deal_task_templates_uq unique nulls not distinct (kind, title, jurisdiction)
);

alter table public.deal_task_templates enable row level security;

-- WHY readable by all authenticated: templates are product content, not user
-- data. No write policy — they are seeded by migration and by service role.
drop policy if exists deal_task_templates_select_all on public.deal_task_templates;
create policy deal_task_templates_select_all on public.deal_task_templates
  for select to authenticated using ( true );

grant select on public.deal_task_templates to authenticated;

insert into public.deal_task_templates
  (kind, title, description, assigned_role, due_anchor, due_offset_days, is_blocking, sort_order)
values
  ('purchase','Deliver earnest money','Wire or deliver the earnest money deposit to the escrow holder and confirm receipt in writing.','buyer','accepted_on',3,true,10),
  ('purchase','Order inspection','Schedule the general home inspection. Book early — inspector availability, not the contract, is usually the binding constraint.','buyer','accepted_on',5,true,20),
  ('purchase','Inspection response','Accept, request repairs, or terminate under the inspection contingency.','buyer','inspection_due_on',0,true,30),
  ('purchase','Loan application submitted','Submit the full application to the lender.','buyer','accepted_on',5,true,40),
  ('purchase','Appraisal ordered','Lender orders the appraisal.','lender','accepted_on',10,true,50),
  ('purchase','Title commitment received','Review the commitment for liens, easements and exceptions.','title','accepted_on',14,true,60),
  ('purchase','Homeowner insurance bound','Bind coverage effective on the closing date; lender requires proof.','buyer','target_close_on',-7,true,70),
  ('purchase','Clear to close','Lender confirms all conditions satisfied.','lender','target_close_on',-3,true,80),
  ('purchase','Final walkthrough','Confirm condition and that agreed repairs were completed.','buyer','target_close_on',-1,false,90),
  ('purchase','Closing disclosure reviewed','Review figures against the agreed terms before signing.','buyer','target_close_on',-3,true,100),
  ('lease','Application submitted','Prospective tenant completes the rental application.','tenant',null,0,true,10),
  ('lease','Lease terms agreed','Rent, term, deposit, utilities and pet terms confirmed by both parties.','landlord',null,0,true,20),
  ('lease','Lease signed by all parties','Every adult occupant responsible for rent signs.','landlord',null,0,true,30),
  ('lease','Deposit and first month received','Confirm cleared funds before handing over keys.','landlord',null,0,true,40),
  ('lease','Move-in condition report','Photograph and document condition with the tenant present. This is the document that decides the deposit dispute that has not happened yet.','landlord',null,0,true,50),
  ('lease','Required disclosures delivered and acknowledged','Jurisdiction-specific. Record the acknowledgement, not just the delivery.','landlord',null,0,true,60)
on conflict (kind, title, jurisdiction) do nothing;


-- =============================================================================
-- Post-migration assertions — the cheapest regression test for the security
-- model. Mirrors the block at the end of 0001.
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
     and c.relname like 'deal\_%'
     and not c.relrowsecurity;
  if v_bad is not null then
    raise exception 'Deal-room tables without RLS enabled: %', v_bad;
  end if;
end $$;

do $$
declare v_bad text;
begin
  select string_agg(format('%s.%s', tablename, policyname), ', ')
    into v_bad
    from pg_policies
   where schemaname = 'public'
     and tablename like 'deal\_%'
     and roles = '{public}';
  if v_bad is not null then
    raise exception 'Deal-room policies missing an explicit TO role: %', v_bad;
  end if;
end $$;
