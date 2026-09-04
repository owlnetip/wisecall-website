// Agent-inbox identity. Prefer the impersonation cookie (admin "Login as")
// and the existing wisecall_profiles owner_id — never invent a second auth
// table. When an agent id is requested, the result is that agent only, or
// nothing. Global (all-agents) is never the fallback.

export function scopedProfileIds(
  ownedIds: string[],
  requestedAgentId?: string | null,
): string[] {
  if (!requestedAgentId) return ownedIds;
  return ownedIds.includes(requestedAgentId) ? [requestedAgentId] : [];
}

export function filterRowsByAgent<T extends { profileId: string }>(
  rows: T[],
  profileIds: string[],
): T[] {
  if (profileIds.length === 0) return [];
  const allowed = new Set(profileIds);
  return rows.filter((row) => allowed.has(row.profileId));
}

// Client/admin inbox: agent-locked Login as and the admin Inbox fail closed
// to the selected agent. A customer account owner still sees every agent they
// own (unified inbox). The only way an admin sees more than one agent's
// threads is an explicit "all inboxes" flag — never the default Login as path.
export function visibleInboxProfileIds(input: {
  ownedIds: string[];
  selectedAgentId?: string | null;
  agentLocked?: boolean;
  adminMode?: boolean;
  adminShowAllInboxes?: boolean;
}): string[] {
  const { ownedIds, selectedAgentId, agentLocked, adminMode, adminShowAllInboxes } = input;
  if (agentLocked) return scopedProfileIds(ownedIds, selectedAgentId);
  if (adminMode) {
    if (adminShowAllInboxes) return ownedIds;
    if (!selectedAgentId) return [];
    return scopedProfileIds(ownedIds, selectedAgentId);
  }
  return ownedIds;
}
