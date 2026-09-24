// Salesforce → SMS prototype.
//
// Outbound texts are matched by a Salesforce phone-number lookup. A single
// matching Contact or Lead can be selected from that lookup. When several
// records share the number, nothing is sent until the caller confirms which
// record the number maps to. Replies are delivered only to a recipient the
// caller has confirmed (the record owner, or a specific Salesforce user).
// A previously confirmed mapping is reused only while the live match set is
// unchanged. A new duplicate, or a disappeared record, asks for confirmation
// again.

export const SALESFORCE_SMS_CANDIDATE_LIMIT = 25;

const SALESFORCE_ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SalesforceObjectType = "Contact" | "Lead";
export type ReplyRouteType = "owner" | "user";

export type SalesforceSmsRecord = {
  id: string;
  objectType: SalesforceObjectType;
  name: string;
  phones: string[];
  ownerId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  /** Person Account shown in Salesforce; id remains its Contact for Task.WhoId. */
  personAccountId?: string;
};

export type ReplyRouteConfirmation = {
  type: ReplyRouteType;
  recipientId?: string | null;
};

export type ResolvedReplyRoute = {
  type: ReplyRouteType;
  recipientId: string;
  recipientName: string | null;
  recipientEmail: string | null;
};

export type StoredSmsBinding = {
  id?: string;
  profileId: string;
  phoneDigits: string;
  salesforceRecordId: string;
  salesforceObject: SalesforceObjectType;
  recordName: string | null;
  replyRoute: ResolvedReplyRoute;
  confirmedCandidateIds: string[];
};

export type SalesforceSmsDecision =
  | { status: "no_match" }
  | { status: "confirm_duplicate"; candidates: SalesforceSmsRecord[] }
  | {
      status: "confirm_reply_route";
      record: SalesforceSmsRecord;
      suggestedReplyRoute: ResolvedReplyRoute | null;
    }
  | {
      status: "send";
      record: SalesforceSmsRecord;
      replyRoute: ResolvedReplyRoute;
      candidateIds: string[];
      reusedConfirmation: boolean;
    }
  | { status: "reject"; reason: string };

export type OutboundSmsRequest = {
  profileId: string;
  to: string;
  text: string;
  /** Phone number the handset should see. Never a name such as WiseCall. */
  from?: string | null;
  confirmRecordId?: string | null;
  confirmReplyRoute?: ReplyRouteConfirmation | null;
  idempotencyKey?: string | null;
};

/** Digits Vonage will display as the sender. A name is not a sender. */
export function numericSenderDigits(raw: string): string | null {
  const digits = canonicalSmsDigits(raw);
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

export function normaliseSmsDestination(raw: string): string | null {
  let number = String(raw || "").trim().replace(/[\s().-]/g, "");
  if (!number) return null;
  if (number.startsWith("00")) number = `+${number.slice(2)}`;
  if (number.startsWith("+")) {
    const digits = number.slice(1).replace(/\D/g, "");
    return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
  }
  const digits = number.replace(/\D/g, "");
  if (/^0\d{9,10}$/.test(digits)) return `+44${digits.slice(1)}`;
  if (/^\d{8,15}$/.test(digits)) return `+${digits}`;
  return null;
}

export function canonicalSmsDigits(raw: string): string {
  const e164 = normaliseSmsDestination(raw);
  return e164 ? e164.slice(1) : "";
}

export function phoneLookupVariants(raw: string): string[] {
  const canonical = canonicalSmsDigits(raw);
  if (!canonical) return [];
  const variants = new Set<string>([canonical]);
  if (canonical.startsWith("44")) variants.add(`0${canonical.slice(2)}`);
  if (canonical.startsWith("44")) variants.add(`+${canonical}`);
  return [...variants];
}

export function buildPhoneSosl(digits: string): string {
  if (!/^\d{8,15}$/.test(digits)) {
    throw new Error("Salesforce phone lookup requires an 8 to 15 digit number");
  }
  return [
    `FIND {${digits}${digits.startsWith("44") ? ` OR 0${digits.slice(2)} OR 00${digits}` : ""}} IN PHONE FIELDS RETURNING`,
    "Contact(Id,Name,Phone,MobilePhone,HomePhone,OtherPhone,OwnerId,Owner.Name,Owner.Email),",
    "Lead(Id,Name,Phone,MobilePhone,OwnerId,Owner.Name,Owner.Email WHERE IsConverted = false),",
    "Account(Id,Name,Phone,IsPersonAccount,PersonContactId,OwnerId,Owner.Name,Owner.Email WHERE IsPersonAccount = true)",
  ].join(" ");
}

export function recordMatchesNumber(record: SalesforceSmsRecord, destinationDigits: string): boolean {
  return record.phones.some((phone) => canonicalSmsDigits(phone) === destinationDigits);
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function phoneFields(row: Record<string, unknown>): string[] {
  const phones: string[] = [];
  for (const key of ["Phone", "MobilePhone", "HomePhone", "OtherPhone"]) {
    const value = asString(row[key]);
    if (value) phones.push(value);
  }
  return phones;
}

export function parseSalesforceSearchRecords(
  payload: unknown,
  destinationDigits: string,
): SalesforceSmsRecord[] {
  const root = payload && typeof payload === "object" ? (payload as { searchRecords?: unknown }) : {};
  const rows = Array.isArray(payload) ? payload : Array.isArray(root.searchRecords) ? root.searchRecords : [];
  const records: SalesforceSmsRecord[] = [];
  const seen = new Set<string>();

  for (const entry of rows) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const attributes = row.attributes as { type?: unknown } | undefined;
    const isPersonAccount = attributes?.type === "Account" && row.IsPersonAccount === true;
    const objectType = isPersonAccount ? "Contact" : attributes?.type === "Lead" || attributes?.type === "Contact" ? attributes.type : null;
    const id = asString(isPersonAccount ? row.PersonContactId : row.Id);
    if (isPersonAccount && phoneFields(row).some(phone => canonicalSmsDigits(phone) === destinationDigits) && (!id || !/^003[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?$/.test(id))) {
      throw new Error("Matching Person Account has no accessible linked Contact. Nothing was sent.");
    }
    if (!objectType || !id || seen.has(id) || !SALESFORCE_ID.test(id)) continue;
    const owner = row.Owner && typeof row.Owner === "object" ? (row.Owner as Record<string, unknown>) : null;
    const record: SalesforceSmsRecord = {
      id,
      objectType,
      name: asString(row.Name) || objectType,
      phones: phoneFields(row),
      ownerId: asString(row.OwnerId),
      ownerName: asString(owner?.Name),
      ownerEmail: asString(owner?.Email),
      ...(isPersonAccount ? { personAccountId: asString(row.Id) || undefined } : {}),
    };
    if (!recordMatchesNumber(record, destinationDigits)) continue;
    seen.add(id);
    records.push(record);
  }

  return records;
}

export function sameCandidateSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((id, index) => id === b[index]);
}

function suggestedOwnerRoute(record: SalesforceSmsRecord): ResolvedReplyRoute | null {
  if (!record.ownerId || !SALESFORCE_ID.test(record.ownerId)) return null;
  if (!record.ownerId.startsWith("005") && !record.ownerId.startsWith("00G")) return null;
  return {
    type: "owner",
    recipientId: record.ownerId,
    recipientName: record.ownerName,
    recipientEmail: record.ownerEmail,
  };
}

function resolveReplyRoute(
  confirmation: ReplyRouteConfirmation,
  record: SalesforceSmsRecord,
): { ok: true; route: ResolvedReplyRoute } | { ok: false; reason: string } {
  if (confirmation.type === "owner") {
    const owner = suggestedOwnerRoute(record);
    if (!owner) {
      return { ok: false, reason: "The selected Salesforce record has no user or queue owner to receive replies." };
    }
    if (confirmation.recipientId && confirmation.recipientId !== owner.recipientId) {
      return {
        ok: false,
        reason: "Owner reply routing must use the selected record's Salesforce owner. Pass type user to choose someone else.",
      };
    }
    return { ok: true, route: owner };
  }

  const recipientId = confirmation.recipientId?.trim() || "";
  if (!recipientId || !SALESFORCE_ID.test(recipientId) || !recipientId.startsWith("005")) {
    return { ok: false, reason: "User reply routing needs the Salesforce user id (005…) who should receive replies." };
  }
  return {
    ok: true,
    route: {
      type: "user",
      recipientId,
      recipientName: null,
      recipientEmail: null,
    },
  };
}

export function decideSalesforceSms(input: {
  matches: SalesforceSmsRecord[];
  binding?: StoredSmsBinding | null;
  confirmRecordId?: string | null;
  confirmReplyRoute?: ReplyRouteConfirmation | null;
}): SalesforceSmsDecision {
  const matches = dedupeRecords(input.matches);
  if (matches.length === 0) return { status: "no_match" };
  if (matches.length > SALESFORCE_SMS_CANDIDATE_LIMIT) {
    return {
      status: "reject",
      reason: `This number matches ${matches.length} Salesforce records. Narrow them in Salesforce before sending.`,
    };
  }

  const candidateIds = matches.map((record) => record.id).sort();
  const binding = input.binding ?? null;
  const setUnchanged = Boolean(
    binding && sameCandidateSet(binding.confirmedCandidateIds, candidateIds),
  );
  const confirmRecordId = input.confirmRecordId?.trim() || "";

  let selected: SalesforceSmsRecord | null = null;
  if (confirmRecordId) {
    selected = matches.find((record) => record.id === confirmRecordId) ?? null;
    if (!selected) {
      return {
        status: "reject",
        reason: "confirm_record_id is not one of the Salesforce records matched by this number.",
      };
    }
  } else if (matches.length === 1) {
    selected = matches[0];
  } else if (setUnchanged && binding) {
    selected = matches.find((record) => record.id === binding.salesforceRecordId) ?? null;
  }

  if (!selected) {
    return { status: "confirm_duplicate", candidates: matches };
  }

  const explicitRoute = input.confirmReplyRoute ?? null;
  if (explicitRoute) {
    const resolved = resolveReplyRoute(explicitRoute, selected);
    if (!resolved.ok) return { status: "reject", reason: resolved.reason };
    return {
      status: "send",
      record: selected,
      replyRoute: resolved.route,
      candidateIds,
      reusedConfirmation: false,
    };
  }

  const canReuse =
    setUnchanged &&
    binding &&
    binding.salesforceRecordId === selected.id &&
    (!confirmRecordId || confirmRecordId === selected.id);

  if (canReuse) {
    return {
      status: "send",
      record: selected,
      replyRoute: binding.replyRoute,
      candidateIds,
      reusedConfirmation: true,
    };
  }

  return {
    status: "confirm_reply_route",
    record: selected,
    suggestedReplyRoute: suggestedOwnerRoute(selected),
  };
}

function dedupeRecords(records: SalesforceSmsRecord[]): SalesforceSmsRecord[] {
  const seen = new Set<string>();
  const out: SalesforceSmsRecord[] = [];
  for (const record of records) {
    if (!record?.id || seen.has(record.id)) continue;
    seen.add(record.id);
    out.push(record);
  }
  return out;
}

export function publicSalesforceRecord(record: SalesforceSmsRecord) {
  return {
    id: record.id,
    object_type: record.objectType,
    name: record.name,
    phones: record.phones,
    owner_id: record.ownerId,
    owner_name: record.ownerName,
    owner_email: record.ownerEmail,
  };
}

export function publicReplyRoute(route: ResolvedReplyRoute) {
  return {
    type: route.type,
    recipient_id: route.recipientId,
    recipient_name: route.recipientName,
    recipient_email: route.recipientEmail,
  };
}

export function heldDecisionResponse(
  decision: Exclude<SalesforceSmsDecision, { status: "send" }>,
  phone: string,
): { httpStatus: number; body: Record<string, unknown> } {
  if (decision.status === "no_match") {
    return {
      httpStatus: 404,
      body: {
        ok: false,
        status: "no_match",
        phone,
        message: "No Salesforce Contact or Lead matches this number. Nothing was sent.",
      },
    };
  }
  if (decision.status === "confirm_duplicate") {
    return {
      httpStatus: 409,
      body: {
        ok: false,
        status: "confirm_duplicate",
        phone,
        candidates: decision.candidates.map(publicSalesforceRecord),
        message:
          "This number matches more than one Salesforce record. Confirm which record it maps to before sending. Replies stay unrouted until that mapping and a reply recipient are confirmed.",
      },
    };
  }
  if (decision.status === "confirm_reply_route") {
    return {
      httpStatus: 409,
      body: {
        ok: false,
        status: "confirm_reply_route",
        phone,
        record: publicSalesforceRecord(decision.record),
        suggested_reply_route: decision.suggestedReplyRoute
          ? publicReplyRoute(decision.suggestedReplyRoute)
          : null,
        message:
          "Confirm who should receive replies before sending. The suggested recipient is the Salesforce record owner and is not used until you confirm it.",
      },
    };
  }
  return {
    httpStatus: 422,
    body: {
      ok: false,
      status: "reject",
      phone,
      message: decision.reason,
    },
  };
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;

export function parseOutboundSmsBody(payload: unknown, idempotencyHeader?: string | null):
  | { ok: true; value: OutboundSmsRequest }
  | { ok: false; error: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "JSON object body is required." };
  }
  const body = payload as Record<string, unknown>;
  const profileId = asString(body.profile_id) || asString(body.profileId) || "";
  if (!UUID_RE.test(profileId)) return { ok: false, error: "profile_id must be the agent id." };

  const to = asString(body.to) || asString(body.phone) || "";
  if (!normaliseSmsDestination(to)) {
    return { ok: false, error: "to must be a phone number in international or UK local form." };
  }

  const text = asString(body.text) || asString(body.message) || asString(body.body) || "";
  if (!text) return { ok: false, error: "text is required." };
  if (text.length > 1000) return { ok: false, error: "text must be 1000 characters or fewer." };

  const fromRaw = asString(body.from) || asString(body.sms_from) || asString(body.sender);
  let from: string | null = null;
  if (fromRaw) {
    from = normaliseSmsDestination(fromRaw);
    if (!from || !numericSenderDigits(fromRaw)) {
      return {
        ok: false,
        error: "from must be the SMS phone number. Messages are not sent from the WiseCall name.",
      };
    }
  }

  const confirmRecordId = asString(body.confirm_record_id) || asString(body.confirmRecordId);
  const routeRaw = body.confirm_reply_route ?? body.confirmReplyRoute;
  let confirmReplyRoute: ReplyRouteConfirmation | null = null;
  if (routeRaw != null) {
    if (!routeRaw || typeof routeRaw !== "object" || Array.isArray(routeRaw)) {
      return { ok: false, error: "confirm_reply_route must be an object." };
    }
    const route = routeRaw as Record<string, unknown>;
    const type = asString(route.type);
    if (type !== "owner" && type !== "user") {
      return { ok: false, error: "confirm_reply_route.type must be owner or user." };
    }
    confirmReplyRoute = {
      type,
      recipientId: asString(route.recipient_id) || asString(route.recipientId),
    };
  }

  const idempotencyKey =
    asString(idempotencyHeader) || asString(body.idempotency_key) || asString(body.idempotencyKey);
  if (idempotencyKey && !IDEMPOTENCY_KEY.test(idempotencyKey)) {
    return { ok: false, error: "Idempotency-Key must be 8 to 128 letters, numbers, or . _ : -." };
  }

  return {
    ok: true,
    value: {
      profileId: profileId.toLowerCase(),
      to,
      text,
      from,
      confirmRecordId,
      confirmReplyRoute,
      idempotencyKey,
    },
  };
}

export type SalesforceSmsEnv = {
  secret: string;
  profileIds: string[];
  instanceUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string | null;
};

export function assertSalesforceInstanceUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SALESFORCE_INSTANCE_URL is not a valid URL.");
  }
  const host = url.hostname.toLowerCase();
  const allowed =
    host === "salesforce.com" ||
    host.endsWith(".salesforce.com") ||
    host.endsWith(".force.com");
  if (url.protocol !== "https:" || !allowed) {
    throw new Error("SALESFORCE_INSTANCE_URL must be an https Salesforce host.");
  }
  return url;
}

export function readSalesforceSmsEnv(
  env: Record<string, string | undefined>,
): { ok: true; config: SalesforceSmsEnv } | { ok: false; error: string } {
  const secret = env.WISECALL_SALESFORCE_SMS_SECRET?.trim() || "";
  const profileIds = (env.WISECALL_SALESFORCE_SMS_PROFILE_IDS || "")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
  const instanceUrl = env.SALESFORCE_INSTANCE_URL?.trim() || "";
  const clientId = env.SALESFORCE_CLIENT_ID?.trim() || "";
  const clientSecret = env.SALESFORCE_CLIENT_SECRET?.trim() || "";
  const refreshToken = env.SALESFORCE_REFRESH_TOKEN?.trim() || null;

  if (!secret || !instanceUrl || !clientId || !clientSecret || profileIds.length === 0) {
    return {
      ok: false,
      error:
        "Salesforce SMS is not configured. Set WISECALL_SALESFORCE_SMS_SECRET, WISECALL_SALESFORCE_SMS_PROFILE_IDS, SALESFORCE_INSTANCE_URL, SALESFORCE_CLIENT_ID, and SALESFORCE_CLIENT_SECRET.",
    };
  }

  try {
    assertSalesforceInstanceUrl(instanceUrl);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid Salesforce instance URL." };
  }

  for (const profileId of profileIds) {
    if (!UUID_RE.test(profileId)) {
      return { ok: false, error: "WISECALL_SALESFORCE_SMS_PROFILE_IDS must be a comma-separated list of agent ids." };
    }
  }

  return {
    ok: true,
    config: {
      secret,
      profileIds,
      instanceUrl: instanceUrl.replace(/\/+$/, ""),
      clientId,
      clientSecret,
      refreshToken,
    },
  };
}

export function secretsMatch(supplied: string, expected: string): boolean {
  if (!supplied || !expected || supplied.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < supplied.length; i += 1) {
    mismatch |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export type SentSmsReplay = {
  body: Record<string, unknown>;
};

export type SalesforceSmsDeps = {
  lookup: (digits: string) => Promise<SalesforceSmsRecord[]>;
  loadBinding: (profileId: string, phoneDigits: string) => Promise<StoredSmsBinding | null>;
  saveBinding: (binding: StoredSmsBinding) => Promise<{ id: string }>;
  findSent: (profileId: string, idempotencyKey: string) => Promise<SentSmsReplay | null>;
  saveMessage: (row: {
    profileId: string;
    bindingId: string | null;
    phoneDigits: string;
    body: string;
    status: string;
    salesforceRecordId: string | null;
    salesforceTaskId: string | null;
    providerMessageId: string | null;
    idempotencyKey: string | null;
    detail: Record<string, unknown>;
  }) => Promise<void>;
  sendSms: (input: { from: string; to: string; text: string }) => Promise<{ messageId: string | null }>;
  logSalesforceTask: (input: {
    record: SalesforceSmsRecord;
    replyRoute: ResolvedReplyRoute;
    phone: string;
    text: string;
    direction: "outbound" | "inbound";
  }) => Promise<{ taskId: string | null; error: string | null }>;
  recordUsage: (profileId: string) => Promise<void>;
  resolveFromNumber: (
    profileId: string,
    requestedFrom: string | null,
  ) => Promise<{ ok: true; from: string } | { ok: false; message: string }>;
};

export type OutboundExecution =
  | { httpStatus: number; body: Record<string, unknown> };

export async function executeSalesforceOutbound(
  request: OutboundSmsRequest,
  deps: SalesforceSmsDeps,
): Promise<OutboundExecution> {
  const phone = normaliseSmsDestination(request.to);
  const digits = canonicalSmsDigits(request.to);
  if (!phone || !digits) {
    return {
      httpStatus: 422,
      body: { ok: false, status: "invalid", message: "to must be a phone number in international or UK local form." },
    };
  }

  if (request.idempotencyKey) {
    const prior = await deps.findSent(request.profileId, request.idempotencyKey);
    if (prior) return { httpStatus: 200, body: { ...prior.body, idempotent_replay: true } };
  }

  const matches = await deps.lookup(digits);
  const binding = await deps.loadBinding(request.profileId, digits);
  const decision = decideSalesforceSms({
    matches,
    binding,
    confirmRecordId: request.confirmRecordId,
    confirmReplyRoute: request.confirmReplyRoute,
  });

  if (decision.status !== "send") {
    return heldDecisionResponse(decision, phone);
  }

  const sender = await deps.resolveFromNumber(request.profileId, request.from ?? null);
  if (!sender.ok) {
    return {
      httpStatus: 422,
      body: {
        ok: false,
        status: "sms_number_required",
        phone,
        message: sender.message,
      },
    };
  }
  const fromDigits = numericSenderDigits(sender.from);
  if (!fromDigits) {
    return {
      httpStatus: 422,
      body: {
        ok: false,
        status: "invalid",
        phone,
        message: "The SMS sender must be a phone number. Messages are not sent from the WiseCall name.",
      },
    };
  }
  const from = `+${fromDigits}`;

  let bindingId: string | null = null;
  try {
    const saved = await deps.saveBinding({
      profileId: request.profileId,
      phoneDigits: digits,
      salesforceRecordId: decision.record.id,
      salesforceObject: decision.record.objectType,
      recordName: decision.record.name,
      replyRoute: decision.replyRoute,
      confirmedCandidateIds: decision.candidateIds,
    });
    bindingId = saved.id;
  } catch {
    // Never send until an immediate reply is guaranteed to have a human route.
    return {
      httpStatus: 503,
      body: { ok: false, status: "binding_unavailable", message: "Reply routing could not be saved. No SMS was sent." },
    };
  }

  const sent = await deps.sendSms({ from, to: phone, text: request.text });

  let task: { taskId: string | null; error: string | null } = { taskId: null, error: null };
  try {
    task = await deps.logSalesforceTask({
      record: decision.record,
      replyRoute: decision.replyRoute,
      phone,
      text: request.text,
      direction: "outbound",
    });
  } catch (error) {
    task = {
      taskId: null,
      error: error instanceof Error ? error.message : "Salesforce task create failed.",
    };
  }

  const body: Record<string, unknown> = {
    ok: true,
    status: "sent",
    phone,
    provider: "vonage",
    provider_message_id: sent.messageId,
    from,
    reused_confirmation: decision.reusedConfirmation,
    record: publicSalesforceRecord(decision.record),
    reply_route: publicReplyRoute(decision.replyRoute),
    confirmed_candidate_ids: decision.candidateIds,
    salesforce_task_id: task.taskId,
    ...(task.error ? { salesforce_task_error: task.error } : {}),
  };

  try {
    await deps.saveMessage({
      profileId: request.profileId,
      bindingId,
      phoneDigits: digits,
      body: request.text,
      status: "sent",
      salesforceRecordId: decision.record.id,
      salesforceTaskId: task.taskId,
      providerMessageId: sent.messageId,
      idempotencyKey: request.idempotencyKey ?? null,
      detail: body,
    });
    await deps.recordUsage(request.profileId);
  } catch (error) {
    console.error(
      "[salesforce-sms] sent but follow-up log failed",
      error instanceof Error ? error.message : error,
    );
  }

  return { httpStatus: 200, body };
}

export function planInboundSalesforceReply(binding: StoredSmsBinding | null):
  | { status: "passthrough" }
  | { status: "route"; binding: StoredSmsBinding } {
  if (!binding?.salesforceRecordId || !binding.replyRoute?.recipientId) {
    return { status: "passthrough" };
  }
  return { status: "route", binding };
}
