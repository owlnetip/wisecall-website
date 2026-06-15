import { AppShell } from "@/components/app-shell";

const calls = [
  {
    caller: "Valuation enquiry",
    agent: "Property Demo Agent",
    status: "Qualified",
    time: "09:42",
  },
  {
    caller: "New patient enquiry",
    agent: "Dental Demo Agent",
    status: "Callback booked",
    time: "10:16",
  },
  {
    caller: "Legal intake",
    agent: "Legal Demo Agent",
    status: "Escalated",
    time: "11:03",
  },
];

export default function DashboardPage() {
  return (
    <AppShell
      title="Customer portal"
      subtitle="The customer view will show only the signed-in customer's own WiseCall agents, call logs and transcripts."
    >
      <div className="grid gap-4 md:grid-cols-3">
        {["Agents", "Calls today", "Open follow-ups"].map((label, index) => (
          <div key={label} className="rounded-lg border border-accent/10 bg-white/[0.04] p-5">
            <p className="text-sm text-white/45">{label}</p>
            <p className="mt-2 text-3xl font-black text-white">{[3, 18, 5][index]}</p>
          </div>
        ))}
      </div>

      <section className="mt-6 rounded-lg border border-accent/10 bg-[#102020]">
        <div className="border-b border-white/10 px-5 py-4">
          <h2 className="font-bold text-white">Recent calls</h2>
        </div>
        <div className="divide-y divide-white/10">
          {calls.map((call) => (
            <div key={`${call.agent}-${call.time}`} className="grid gap-3 px-5 py-4 text-sm md:grid-cols-4">
              <span className="font-semibold text-white">{call.caller}</span>
              <span className="text-white/60">{call.agent}</span>
              <span className="text-accent">{call.status}</span>
              <span className="font-mono text-white/45 md:text-right">{call.time}</span>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
