export type AgentOperationalState =
  | "live"
  | "paused"
  | "setting_up"
  | "review"
  | "disconnected";

export type AgentOperationalInput = {
  status: "Live" | "Setup" | "Review";
  routing: {
    status: "unprovisioned" | "pending" | "live";
    number: string;
  };
};

export function getAgentOperationalState(agent: AgentOperationalInput): AgentOperationalState {
  if (agent.status === "Review") return "review";
  if (agent.routing.status === "pending") return "setting_up";
  if (agent.routing.status === "live" && agent.routing.number.trim()) {
    return agent.status === "Live" ? "live" : "paused";
  }
  return "disconnected";
}

export function agentOperationalLabel(state: AgentOperationalState): string {
  if (state === "live") return "Live";
  if (state === "paused") return "Paused";
  if (state === "setting_up") return "Setting up";
  if (state === "review") return "Needs review";
  return "Not connected";
}

// Pause/Resume is only meaningful for an agent whose phone line is connected.
// A live agent can be taken offline (pause → is_active=false, which the call
// runtime honours by not matching the profile); a paused one can be brought
// back. Agents still setting up, in review, or disconnected have no number to
// answer, so neither control applies.
export function canPauseAgent(state: AgentOperationalState): boolean {
  return state === "live";
}

export function canResumeAgent(state: AgentOperationalState): boolean {
  return state === "paused";
}
