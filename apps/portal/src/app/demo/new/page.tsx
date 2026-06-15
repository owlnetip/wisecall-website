import { AppShell } from "@/components/app-shell";
import { DemoRequestForm } from "@/components/demo-request-form";

export default function NewDemoPage() {
  return (
    <AppShell
      title="Create demo agent"
      subtitle="Capture a prospect website and mobile number, create a demo token, and send a private demo link by SMS when the webhook is configured."
    >
      <div className="grid gap-6 lg:grid-cols-[480px_1fr]">
        <section className="rounded-lg border border-accent/15 bg-[#102020] p-5">
          <DemoRequestForm />
        </section>
        <section className="rounded-lg border border-accent/10 bg-white/[0.04] p-6">
          <h2 className="text-xl font-bold text-white">What this creates</h2>
          <div className="mt-5 space-y-4 text-sm leading-6 text-white/60">
            <p>
              A row in <span className="font-mono text-accent">demo_agents</span> with the website, industry, mobile number and a public demo token.
            </p>
            <p>
              A private URL like <span className="font-mono text-accent">/demo/abc123</span> that the prospect can open from SMS.
            </p>
            <p>
              When <span className="font-mono text-accent">WISECALL_DEMO_SMS_WEBHOOK_URL</span> is configured, the API will POST the SMS payload to that webhook.
            </p>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
