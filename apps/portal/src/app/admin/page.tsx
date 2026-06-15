import { AppShell } from "@/components/app-shell";

const rows = [
  {
    customer: "Demo prospect",
    industry: "Property",
    agent: "Requested",
    sms: "Waiting webhook",
  },
  {
    customer: "Example Dental",
    industry: "Dental",
    agent: "Live",
    sms: "Delivered",
  },
  {
    customer: "Example Legal",
    industry: "Legal",
    agent: "Setup call",
    sms: "Clicked",
  },
];

export default function AdminPage() {
  return (
    <AppShell
      title="Owlnet admin"
      subtitle="Internal WiseCall/Owlnet view across all customers, demo agents, production agents and SMS conversion state."
    >
      <section className="rounded-lg border border-accent/10 bg-[#102020]">
        <div className="border-b border-white/10 px-5 py-4">
          <h2 className="font-bold text-white">All agents</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-white/45">
              <tr>
                <th className="px-5 py-3 font-semibold">Customer</th>
                <th className="px-5 py-3 font-semibold">Industry</th>
                <th className="px-5 py-3 font-semibold">Agent status</th>
                <th className="px-5 py-3 font-semibold">SMS status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {rows.map((row) => (
                <tr key={row.customer}>
                  <td className="px-5 py-4 font-semibold text-white">{row.customer}</td>
                  <td className="px-5 py-4 text-white/60">{row.industry}</td>
                  <td className="px-5 py-4 text-accent">{row.agent}</td>
                  <td className="px-5 py-4 text-white/60">{row.sms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
