// Shared scheduling-tool client for the WiseCall edge functions.
//
// The customer connects their own Cal.com (or Calendly) account in the portal;
// the credentials land on wisecall_calendar_connections and every function that
// needs the diary goes through here.
//
// Cal.com versions its v2 endpoints independently and each controller only
// accepts the versions it knows about — event-types 404s on anything other than
// 2024-06-14, and /v2/slots silently falls back to an older, differently-shaped
// endpoint unless it gets 2024-09-04. Hence one constant per endpoint family.

// deno-lint-ignore-file no-explicit-any

export const CALCOM_BASE = "https://api.cal.com/v2";
export const CALCOM_VERSION_EVENT_TYPES = "2024-06-14";
export const CALCOM_VERSION_SLOTS = "2024-09-04";
export const CALCOM_VERSION_BOOKINGS = "2024-08-13";
export const CALENDLY_BASE = "https://api.calendly.com";

const TIMEOUT_MS = 10000;

export type CalendarEventType = {
  id: string | number;
  slug?: string;
  title: string;
  duration_mins: number | null;
};

export type CalendarConnection = {
  id: string;
  provider: string;
  access_token: string;
  config: Record<string, unknown>;
  event_types: CalendarEventType[];
};

type JsonResult = { ok: boolean; status: number; body: any };

async function jsonFetch(url: string, init: RequestInit = {}): Promise<JsonResult> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text().catch(() => "");
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON error pages come back as text.
  }
  return { ok: res.ok, status: res.status, body };
}

function errorMessage(result: JsonResult): string {
  const body = result.body;
  if (typeof body === "string") return body.slice(0, 200);
  return (
    body?.error?.message ||
    body?.error?.details ||
    body?.message ||
    JSON.stringify(body ?? {}).slice(0, 200)
  );
}

function calcomHeaders(apiKey: string, version: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "cal-api-version": version,
    "Content-Type": "application/json",
  };
}

// ── connection ──────────────────────────────────────────────────────────────

export async function loadCalendarConnection(
  supabase: any,
  profileId: string,
): Promise<CalendarConnection | null> {
  const { data } = await supabase
    .from("wisecall_calendar_connections")
    .select("id, provider, access_token, config, event_types, status")
    .eq("profile_id", profileId)
    .eq("status", "connected")
    .order("updated_at", { ascending: false })
    .limit(1);

  const row = (data ?? [])[0];
  if (!row?.access_token) return null;
  return {
    id: row.id,
    provider: row.provider,
    access_token: row.access_token,
    config: (row.config as Record<string, unknown>) ?? {},
    event_types: Array.isArray(row.event_types) ? (row.event_types as CalendarEventType[]) : [],
  };
}

/**
 * Picks the event type the caller asked for. Matches on title then slug, both
 * ways round so "checkup" finds "New patient checkup", and falls back to the
 * first bookable type when the caller didn't name a service.
 */
export function resolveEventType(
  connection: Pick<CalendarConnection, "event_types">,
  service?: string | null,
): CalendarEventType | null {
  const types = Array.isArray(connection.event_types) ? connection.event_types : [];
  if (!types.length) return null;

  const query = (service ?? "").trim().toLowerCase();
  if (query) {
    const exact = types.find(
      (t) => (t.title ?? "").toLowerCase() === query || (t.slug ?? "").toLowerCase() === query,
    );
    if (exact) return exact;

    const partial = types.find((t) => {
      const title = (t.title ?? "").toLowerCase();
      const slug = (t.slug ?? "").toLowerCase();
      return (
        (title && (title.includes(query) || query.includes(title))) ||
        (slug && (slug.includes(query) || query.includes(slug)))
      );
    });
    if (partial) return partial;
  }
  return types[0];
}

export function eventTypeNames(connection: Pick<CalendarConnection, "event_types">): string[] {
  return (connection.event_types ?? []).map((t) => t.title).filter(Boolean);
}

// ── Cal.com ─────────────────────────────────────────────────────────────────

export async function calcomListEventTypes(apiKey: string): Promise<CalendarEventType[]> {
  const r = await jsonFetch(`${CALCOM_BASE}/event-types`, {
    headers: calcomHeaders(apiKey, CALCOM_VERSION_EVENT_TYPES),
  });
  if (!r.ok) return [];
  const data = r.body?.data ?? [];
  return (Array.isArray(data) ? data : []).map((e: any) => ({
    id: e.id,
    slug: e.slug,
    title: e.title || e.slug || String(e.id),
    duration_mins: e.lengthInMinutes ?? e.length ?? null,
  }));
}

/**
 * Free slots between two instants. `start`/`end` may be date-only (YYYY-MM-DD)
 * or full ISO; passing timeZone makes Cal.com return slots with the business's
 * own offset so we can group them by local day.
 */
export async function calcomGetSlots(
  apiKey: string,
  opts: {
    eventTypeId: string | number;
    start: string;
    end: string;
    timeZone?: string;
    bookingUidToReschedule?: string;
  },
): Promise<{ ok: boolean; status: number; slots: string[]; error?: string }> {
  const qs = new URLSearchParams({
    eventTypeId: String(opts.eventTypeId),
    start: opts.start,
    end: opts.end,
  });
  if (opts.timeZone) qs.set("timeZone", opts.timeZone);
  if (opts.bookingUidToReschedule) qs.set("bookingUidToReschedule", opts.bookingUidToReschedule);

  const r = await jsonFetch(`${CALCOM_BASE}/slots?${qs}`, {
    headers: calcomHeaders(apiKey, CALCOM_VERSION_SLOTS),
  });
  if (!r.ok) return { ok: false, status: r.status, slots: [], error: errorMessage(r) };

  // { data: { "2050-09-05": [{ start }, …] } }
  const days = r.body?.data ?? {};
  const slots: string[] = [];
  for (const key of Object.keys(days ?? {})) {
    for (const slot of days[key] ?? []) {
      const start = typeof slot === "string" ? slot : slot?.start;
      if (start) slots.push(start);
    }
  }
  slots.sort();
  return { ok: true, status: r.status, slots };
}

export async function calcomCreateBooking(
  apiKey: string,
  opts: {
    eventTypeId: string | number;
    start: string;
    name: string;
    email: string;
    phone?: string | null;
    timeZone?: string;
    notes?: string | null;
    metadata?: Record<string, string>;
  },
): Promise<{
  ok: boolean;
  status: number;
  uid: string | null;
  start: string | null;
  end: string | null;
  error?: string;
}> {
  const attendee: Record<string, unknown> = {
    name: opts.name || "Phone caller",
    email: opts.email,
    timeZone: opts.timeZone || "Europe/London",
    language: "en",
  };
  if (opts.phone) attendee.phoneNumber = opts.phone;

  const payload: Record<string, unknown> = {
    eventTypeId: Number(opts.eventTypeId),
    start: opts.start,
    attendee,
  };
  if (opts.metadata) payload.metadata = opts.metadata;
  if (opts.notes) payload.bookingFieldsResponses = { notes: opts.notes };

  const r = await jsonFetch(`${CALCOM_BASE}/bookings`, {
    method: "POST",
    headers: calcomHeaders(apiKey, CALCOM_VERSION_BOOKINGS),
    body: JSON.stringify(payload),
  });
  const data = r.body?.data ?? {};
  return {
    ok: r.ok,
    status: r.status,
    uid: data.uid ?? null,
    start: data.start ?? null,
    end: data.end ?? null,
    error: r.ok ? undefined : errorMessage(r),
  };
}

export async function calcomRescheduleBooking(
  apiKey: string,
  uid: string,
  start: string,
  reason?: string | null,
): Promise<{
  ok: boolean;
  status: number;
  uid: string | null;
  start: string | null;
  end: string | null;
  error?: string;
}> {
  const r = await jsonFetch(`${CALCOM_BASE}/bookings/${encodeURIComponent(uid)}/reschedule`, {
    method: "POST",
    headers: calcomHeaders(apiKey, CALCOM_VERSION_BOOKINGS),
    body: JSON.stringify({
      start,
      reschedulingReason: reason || "Rescheduled by the caller on the phone",
    }),
  });
  const data = r.body?.data ?? {};
  return {
    ok: r.ok,
    status: r.status,
    uid: data.uid ?? null,
    start: data.start ?? null,
    end: data.end ?? null,
    error: r.ok ? undefined : errorMessage(r),
  };
}

export async function calcomCancelBooking(
  apiKey: string,
  uid: string,
  reason?: string | null,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const r = await jsonFetch(`${CALCOM_BASE}/bookings/${encodeURIComponent(uid)}/cancel`, {
    method: "POST",
    headers: calcomHeaders(apiKey, CALCOM_VERSION_BOOKINGS),
    body: JSON.stringify({
      cancellationReason: reason || "Cancelled by the caller on the phone",
    }),
  });
  return { ok: r.ok, status: r.status, error: r.ok ? undefined : errorMessage(r) };
}

// ── Calendly ────────────────────────────────────────────────────────────────
// Calendly has no reliable server-side booking API, so availability is read and
// the caller is sent a single-use scheduling link instead.

function calendlyHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export async function calendlyGetAvailableTimes(
  token: string,
  eventTypeUri: string,
  startISO: string,
  endISO: string,
): Promise<{ ok: boolean; status: number; slots: string[]; error?: string }> {
  const qs = new URLSearchParams({
    event_type: eventTypeUri,
    start_time: startISO,
    end_time: endISO,
  });
  const r = await jsonFetch(`${CALENDLY_BASE}/event_type_available_times?${qs}`, {
    headers: calendlyHeaders(token),
  });
  if (!r.ok) return { ok: false, status: r.status, slots: [], error: errorMessage(r) };
  return {
    ok: true,
    status: r.status,
    slots: (r.body?.collection ?? []).map((s: any) => s.start_time).filter(Boolean),
  };
}

export async function calendlyCreateSchedulingLink(
  token: string,
  eventTypeUri: string,
): Promise<{ ok: boolean; status: number; url: string | null; error?: string }> {
  const r = await jsonFetch(`${CALENDLY_BASE}/scheduling_links`, {
    method: "POST",
    headers: calendlyHeaders(token),
    body: JSON.stringify({ max_event_count: 1, owner: eventTypeUri, owner_type: "EventType" }),
  });
  return {
    ok: r.ok,
    status: r.status,
    url: r.body?.resource?.booking_url ?? null,
    error: r.ok ? undefined : errorMessage(r),
  };
}

// ── date / slot helpers ─────────────────────────────────────────────────────

/** YYYY-MM-DD for an instant, in the given timezone. */
export function localDateKey(value: Date | string, timeZone = "Europe/London"): string {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Turns whatever the model sent into a YYYY-MM-DD day in the business timezone.
 * Models are told to send an ISO date but occasionally say "today"/"tomorrow",
 * so those are handled rather than failing the call.
 */
export function parseRequestedDate(
  raw: string | null | undefined,
  timeZone = "Europe/London",
  now = new Date(),
): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return null;

  const dayMs = 24 * 60 * 60 * 1000;
  if (value === "today") return localDateKey(now, timeZone);
  if (value === "tomorrow") return localDateKey(new Date(now.getTime() + dayMs), timeZone);

  const isoDate = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) return `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return localDateKey(parsed, timeZone);
  return null;
}

/** "9:30am" — how the agent should say a time out loud. */
export function formatTimeOfDay(iso: string, timeZone = "Europe/London"): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date(iso))
    .replace(/\s/g, "")
    .toLowerCase();
}

/** "Thursday 24 July at 9:30am" — for confirmations and reminders. */
export function formatDateTime(iso: string, timeZone = "Europe/London"): string {
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(iso));
  return `${date} at ${formatTimeOfDay(iso, timeZone)}`;
}

/** "Thursday 24 July" */
export function formatDayLabel(dateKey: string, timeZone = "Europe/London"): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${dateKey}T12:00:00Z`));
}

export function groupSlotsByDay(
  slots: string[],
  timeZone = "Europe/London",
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const slot of slots) {
    const key = localDateKey(slot, timeZone);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(slot);
    else grouped.set(key, [slot]);
  }
  return grouped;
}

/** Does the diary have an open slot at (approximately) this instant? */
export function hasSlotAt(slots: string[], target: Date, toleranceMs = 2 * 60 * 1000): boolean {
  const wanted = target.getTime();
  return slots.some((slot) => Math.abs(new Date(slot).getTime() - wanted) < toleranceMs);
}
