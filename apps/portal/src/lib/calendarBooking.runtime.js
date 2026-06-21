// calendarBooking.runtime.js — Cal.com + Calendly booking for WiseCall agents.
// Deploy to the voice runtime as src/integrations/calendarBooking.js.
//
// Connection shape (from wisecall_calendar_connections):
//   { provider: 'cal_com'|'calendly', access_token, config, event_types }
// - Cal.com: access_token = API key. Full in-call booking (slots → book).
// - Calendly: access_token = Personal Access Token / OAuth token. We fetch
//   availability and generate a SINGLE-USE scheduling link to SMS to the caller
//   (Calendly's direct-booking API is limited; the link is the reliable path).

const CALCOM_BASE = "https://api.cal.com/v2";
const CALCOM_API_VERSION = "2024-08-13";
const CALENDLY_BASE = "https://api.calendly.com";
const TIMEOUT_MS = 10000;

function jsonFetch(url, init) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }).then(async (res) => {
    const text = await res.text().catch(() => "");
    let body = text;
    try { body = text ? JSON.parse(text) : null; } catch { /* keep text */ }
    return { ok: res.ok, status: res.status, body };
  });
}

// ── Cal.com ────────────────────────────────────────────────────────────────
function calcomHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "cal-api-version": CALCOM_API_VERSION,
    "Content-Type": "application/json",
  };
}

async function calcomListEventTypes(apiKey) {
  const r = await jsonFetch(`${CALCOM_BASE}/event-types`, { headers: calcomHeaders(apiKey) });
  if (!r.ok) return [];
  const data = r.body?.data ?? [];
  // Normalise to {id, slug, title, duration_mins}
  return (Array.isArray(data) ? data : []).map((e) => ({
    id: e.id,
    slug: e.slug,
    title: e.title || e.slug,
    duration_mins: e.lengthInMinutes ?? e.length ?? null,
  }));
}

async function calcomGetSlots(apiKey, eventTypeId, fromISO, toISO) {
  const qs = new URLSearchParams({ eventTypeId: String(eventTypeId), start: fromISO, end: toISO });
  const r = await jsonFetch(`${CALCOM_BASE}/slots?${qs}`, { headers: calcomHeaders(apiKey) });
  if (!r.ok) return { ok: false, status: r.status, slots: [] };
  // v2 returns { data: { "YYYY-MM-DD": [{ start }] } } or { data: { slots: {...} } }
  const data = r.body?.data ?? {};
  const slots = [];
  const days = data.slots ?? data;
  for (const key of Object.keys(days || {})) {
    for (const s of days[key] || []) {
      if (s && s.start) slots.push(s.start);
    }
  }
  return { ok: true, status: r.status, slots };
}

async function calcomCreateBooking(apiKey, { eventTypeId, start, name, email, phone, timeZone }) {
  const attendee = { name: name || "Caller", timeZone: timeZone || "Europe/London", language: "en" };
  if (email) attendee.email = email;
  if (phone) attendee.phoneNumber = phone;
  const r = await jsonFetch(`${CALCOM_BASE}/bookings`, {
    method: "POST",
    headers: calcomHeaders(apiKey),
    body: JSON.stringify({ start, eventTypeId: Number(eventTypeId), attendee }),
  });
  return {
    ok: r.ok,
    status: r.status,
    bookingId: r.body?.data?.id ?? r.body?.data?.uid ?? null,
    error: r.ok ? null : r.body?.error?.message || r.body,
  };
}

// ── Calendly ─────────────────────────────────────────────────────────────────
function calendlyHeaders(token) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function calendlyCurrentUser(token) {
  const r = await jsonFetch(`${CALENDLY_BASE}/users/me`, { headers: calendlyHeaders(token) });
  return r.ok ? r.body?.resource ?? null : null;
}

async function calendlyListEventTypes(token, userUri) {
  const qs = new URLSearchParams({ user: userUri, active: "true" });
  const r = await jsonFetch(`${CALENDLY_BASE}/event_types?${qs}`, { headers: calendlyHeaders(token) });
  if (!r.ok) return [];
  return (r.body?.collection ?? []).map((e) => ({
    id: e.uri,
    slug: e.slug,
    title: e.name,
    duration_mins: e.duration ?? null,
    scheduling_url: e.scheduling_url,
  }));
}

async function calendlyGetAvailableTimes(token, eventTypeUri, fromISO, toISO) {
  const qs = new URLSearchParams({ event_type: eventTypeUri, start_time: fromISO, end_time: toISO });
  const r = await jsonFetch(`${CALENDLY_BASE}/event_type_available_times?${qs}`, {
    headers: calendlyHeaders(token),
  });
  if (!r.ok) return { ok: false, status: r.status, slots: [] };
  return { ok: true, status: r.status, slots: (r.body?.collection ?? []).map((s) => s.start_time) };
}

// Calendly: book-by-link. Generate a single-use scheduling link to SMS the caller.
async function calendlyCreateSchedulingLink(token, eventTypeUri) {
  const r = await jsonFetch(`${CALENDLY_BASE}/scheduling_links`, {
    method: "POST",
    headers: calendlyHeaders(token),
    body: JSON.stringify({ max_event_count: 1, owner: eventTypeUri, owner_type: "EventType" }),
  });
  return {
    ok: r.ok,
    status: r.status,
    url: r.body?.resource?.booking_url ?? null,
    error: r.ok ? null : r.body,
  };
}

// ── Provider-agnostic facade used by the agent tools ─────────────────────────

// Resolve which event type the agent should use for a named service. Falls back
// to the connection's first/default event type when the service isn't matched.
function resolveEventType(connection, serviceName) {
  const types = Array.isArray(connection.event_types) ? connection.event_types : [];
  if (!types.length) return null;
  if (serviceName) {
    const q = String(serviceName).toLowerCase();
    const hit = types.find(
      (t) => (t.title || "").toLowerCase().includes(q) || (t.slug || "").toLowerCase().includes(q),
    );
    if (hit) return hit;
  }
  return types[0];
}

async function getAvailability(connection, { service, fromISO, toISO }) {
  const et = resolveEventType(connection, service);
  if (!et) return { ok: false, error: "No bookable services are configured." };
  if (connection.provider === "cal_com") {
    const r = await calcomGetSlots(connection.access_token, et.id, fromISO, toISO);
    return { ...r, service: et.title, eventType: et };
  }
  if (connection.provider === "calendly") {
    const r = await calendlyGetAvailableTimes(connection.access_token, et.id, fromISO, toISO);
    return { ...r, service: et.title, eventType: et };
  }
  return { ok: false, error: `Unsupported provider ${connection.provider}` };
}

// Returns either a confirmed booking (Cal.com) or a scheduling link to send the
// caller (Calendly). The agent reads `mode` to know how to respond.
async function bookAppointment(connection, { service, start, name, email, phone, timeZone }) {
  const et = resolveEventType(connection, service);
  if (!et) return { ok: false, error: "No bookable services are configured." };

  if (connection.provider === "cal_com") {
    const r = await calcomCreateBooking(connection.access_token, {
      eventTypeId: et.id, start, name, email, phone, timeZone,
    });
    return { ...r, mode: "booked", service: et.title };
  }

  if (connection.provider === "calendly") {
    const r = await calendlyCreateSchedulingLink(connection.access_token, et.id);
    return { ...r, mode: "link", service: et.title };
  }

  return { ok: false, error: `Unsupported provider ${connection.provider}` };
}

module.exports = {
  // facade
  getAvailability,
  bookAppointment,
  resolveEventType,
  // cal.com
  calcomListEventTypes,
  calcomGetSlots,
  calcomCreateBooking,
  // calendly
  calendlyCurrentUser,
  calendlyListEventTypes,
  calendlyGetAvailableTimes,
  calendlyCreateSchedulingLink,
};
