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
