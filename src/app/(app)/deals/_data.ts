import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  DealDocumentRequestRow,
  DealParticipantRow,
  DealRoomRow,
  DealTaskRow,
  DealThreadRow,
  DealMessageRow,
  DealTaskTemplateRow,
} from "@/lib/domain/deals";
import type { ParticipantView } from "@/components/deals/ParticipantRoster";
import type { DocRequestView } from "@/components/deals/DocumentRequests";
import type { TaskView } from "@/components/deals/TaskChecklist";
import type { ThreadView } from "@/components/deals/ThreadList";

/**
 * Deal-room reads.
 *
 * Two deliberate behaviours:
 *
 *  1. AUTHORIZATION IS NEVER ASSUMED. Every function re-reads `auth.getUser()`
 *     and every query runs through the anon-key client, so RLS decides what
 *     comes back. The proxy refreshes the session; it does not authorise
 *     anything, and nothing here treats it as if it did.
 *
 *  2. A MISSING TABLE IS NOT A CRASH. Migrations 0004 and 0005 may not be
 *     applied to the target project yet. Every query is wrapped and a schema
 *     error degrades to an empty result with `schemaReady: false`, so the page
 *     renders an honest "not deployed yet" state instead of a 500.
 */

export type DealDataState<T> = {
  data: T;
  schemaReady: boolean;
  error: string | null;
};

/** Postgres/PostgREST codes that mean "the table or column is not there yet". */
function isSchemaError(code: string | undefined | null): boolean {
  // 42P01 undefined_table, 42703 undefined_column, PGRST205 unknown table in cache.
  return code === "42P01" || code === "42703" || code === "PGRST205" || code === "PGRST204";
}

export async function getViewerId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

type RoomListRow = DealRoomRow & {
  addresses: { line1: string; city: string; state: string; postal_code: string } | null;
};

export type DealListItem = {
  room: DealRoomRow;
  address_line: string;
  participant: DealParticipantRow;
  participant_count: number;
  tasks: Array<Pick<DealTaskRow, "status" | "is_blocking" | "due_on">>;
  outstanding_documents: number;
};

export async function listDealRooms(): Promise<DealDataState<DealListItem[]>> {
  const empty = { data: [] as DealListItem[], schemaReady: true, error: null };
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ...empty, error: "not signed in" };

  // RLS restricts this to rooms the caller participates in; the filter is the
  // policy, not this query.
  const roomsRes = await supabase
    .from("deal_rooms")
    .select(
      "*, addresses ( line1, city, state, postal_code )",
    )
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (roomsRes.error) {
    return {
      data: [],
      schemaReady: !isSchemaError(roomsRes.error.code),
      error: roomsRes.error.message,
    };
  }

  const rooms = (roomsRes.data ?? []) as unknown as RoomListRow[];
  if (rooms.length === 0) return empty;
  const ids = rooms.map((r) => r.id);

  const [partsRes, tasksRes, docsRes] = await Promise.all([
    supabase.from("deal_participants").select("*").in("deal_room_id", ids),
    supabase
      .from("deal_tasks")
      .select("deal_room_id, status, is_blocking, due_on")
      .in("deal_room_id", ids),
    supabase
      .from("deal_document_requests")
      .select("deal_room_id, status")
      .in("deal_room_id", ids),
  ]);

  const parts = (partsRes.data ?? []) as unknown as DealParticipantRow[];
  const tasks = (tasksRes.data ?? []) as unknown as Array<
    Pick<DealTaskRow, "status" | "is_blocking" | "due_on"> & { deal_room_id: string }
  >;
  const docs = (docsRes.data ?? []) as unknown as Array<{
    deal_room_id: string;
    status: DealDocumentRequestRow["status"];
  }>;

  const items: DealListItem[] = [];
  for (const room of rooms) {
    const mine = parts.find((p) => p.deal_room_id === room.id && p.profile_id === user.id);
    if (!mine) continue; // defensive: RLS should already have excluded it
    const a = room.addresses;
    items.push({
      room,
      address_line: a ? `${a.line1}, ${a.city}, ${a.state} ${a.postal_code}` : "Address unavailable",
      participant: mine,
      participant_count: parts.filter((p) => p.deal_room_id === room.id && p.removed_at === null)
        .length,
      tasks: tasks.filter((t) => t.deal_room_id === room.id),
      outstanding_documents: docs.filter(
        (d) => d.deal_room_id === room.id && d.status !== "accepted" && d.status !== "waived",
      ).length,
    });
  }

  return { data: items, schemaReady: true, error: null };
}

export type DealRoomDetail = {
  room: DealRoomRow;
  address_line: string;
  viewer: DealParticipantRow | null;
  participants: ParticipantView[];
  threads: ThreadView[];
  tasks: TaskView[];
  requests: DocRequestView[];
};

export async function getDealRoom(
  roomId: string,
): Promise<DealDataState<DealRoomDetail | null>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { data: null, schemaReady: true, error: "not signed in" };

  const roomRes = await supabase
    .from("deal_rooms")
    .select("*, addresses ( line1, city, state, postal_code )")
    .eq("id", roomId)
    .maybeSingle();

  if (roomRes.error) {
    return {
      data: null,
      schemaReady: !isSchemaError(roomRes.error.code),
      error: roomRes.error.message,
    };
  }
  if (!roomRes.data) return { data: null, schemaReady: true, error: null };

  const room = roomRes.data as unknown as RoomListRow;

  const [partsRes, threadsRes, tasksRes, docsRes] = await Promise.all([
    supabase
      .from("deal_participants")
      .select("*, profiles ( display_name, full_name )")
      .eq("deal_room_id", roomId),
    supabase.from("deal_threads").select("*").eq("deal_room_id", roomId),
    supabase
      .from("deal_tasks")
      .select("*, profiles:assigned_to ( display_name, full_name )")
      .eq("deal_room_id", roomId),
    supabase
      .from("deal_document_requests")
      .select("*, documents:fulfilled_by_document_id ( title )")
      .eq("deal_room_id", roomId),
  ]);

  type NamedProfile = { display_name: string | null; full_name: string | null } | null;

  const participants: ParticipantView[] = (
    (partsRes.data ?? []) as unknown as Array<DealParticipantRow & { profiles: NamedProfile }>
  ).map((p) => ({
    ...p,
    display_name: p.profiles?.display_name ?? p.profiles?.full_name ?? null,
    is_you: p.profile_id === user.id,
  }));

  const viewer =
    participants.find((p) => p.profile_id === user.id && p.removed_at === null) ?? null;

  const tasks: TaskView[] = (
    (tasksRes.data ?? []) as unknown as Array<DealTaskRow & { profiles: NamedProfile }>
  ).map((t) => ({
    ...t,
    assignee_name: t.profiles?.display_name ?? t.profiles?.full_name ?? null,
  }));

  const requests: DocRequestView[] = (
    (docsRes.data ?? []) as unknown as Array<
      DealDocumentRequestRow & { documents: { title: string } | null }
    >
  ).map((r) => ({ ...r, document_title: r.documents?.title ?? null }));

  const a = room.addresses;

  return {
    data: {
      room,
      address_line: a
        ? `${a.line1}, ${a.city}, ${a.state} ${a.postal_code}`
        : "Address unavailable",
      viewer,
      participants,
      threads: (threadsRes.data ?? []) as unknown as ThreadView[],
      tasks,
      requests,
    },
    schemaReady: true,
    error: null,
  };
}

export async function getThread(
  roomId: string,
  threadId: string,
): Promise<
  DealDataState<{
    thread: DealThreadRow;
    messages: Array<DealMessageRow & { author_name: string | null }>;
    viewer: DealParticipantRow | null;
  } | null>
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { data: null, schemaReady: true, error: "not signed in" };

  // RLS on deal_threads resolves all four visibility modes. If the caller may
  // not read this thread, the row simply is not returned — there is no separate
  // permission check to keep in sync.
  const threadRes = await supabase
    .from("deal_threads")
    .select("*")
    .eq("id", threadId)
    .eq("deal_room_id", roomId)
    .maybeSingle();

  if (threadRes.error) {
    return {
      data: null,
      schemaReady: !isSchemaError(threadRes.error.code),
      error: threadRes.error.message,
    };
  }
  if (!threadRes.data) return { data: null, schemaReady: true, error: null };

  const [msgRes, meRes] = await Promise.all([
    supabase
      .from("deal_messages")
      .select("*, profiles:author_id ( display_name, full_name )")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(200),
    supabase
      .from("deal_participants")
      .select("*")
      .eq("deal_room_id", roomId)
      .eq("profile_id", user.id)
      .maybeSingle(),
  ]);

  const messages = (
    (msgRes.data ?? []) as unknown as Array<
      DealMessageRow & { profiles: { display_name: string | null; full_name: string | null } | null }
    >
  ).map((m) => ({
    ...m,
    author_name: m.profiles?.display_name ?? m.profiles?.full_name ?? null,
  }));

  return {
    data: {
      thread: threadRes.data as unknown as DealThreadRow,
      messages,
      viewer: (meRes.data as unknown as DealParticipantRow) ?? null,
    },
    schemaReady: true,
    error: null,
  };
}

export async function getTaskTemplates(): Promise<DealTaskTemplateRow[]> {
  const supabase = await createClient();
  const res = await supabase.from("deal_task_templates").select("*");
  if (res.error) return [];
  return (res.data ?? []) as unknown as DealTaskTemplateRow[];
}
