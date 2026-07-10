import Link from "next/link";
import { notFound } from "next/navigation";
import { Bot, Globe2, MessageSquareText } from "lucide-react";
import { CallbackForm } from "@/components/callback-form";
import { getDemoByToken } from "@/lib/demo-store";

export default async function DemoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const demo = await getDemoByToken(id);

  if (!demo) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(125,232,235,0.14),transparent_36%),#172929] px-6 py-8 text-foreground">
      <div className="mx-auto max-w-5xl">
        <header className="mb-10 flex items-center justify-between gap-6">
          <Link href="https://wisecall.io" className="text-lg font-black text-white">
            WiseCall
          </Link>
          <span className="rounded-lg border border-accent/15 bg-white/5 px-3 py-2 text-xs font-semibold text-accent">
            Demo agent
          </span>
        </header>

        <section className="grid gap-8 lg:grid-cols-[1fr_420px] lg:items-center">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-lg border border-accent/15 bg-white/5 px-3 py-2 text-sm font-semibold text-accent">
              <Bot className="h-4 w-4" />
              {demo.industry} assistant
            </div>
            <h1 className="break-words text-3xl font-black leading-tight text-white sm:text-4xl md:text-5xl lg:text-6xl">
              Test the WiseCall agent for {demo.business_name}.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-white/70">
              This demo was created from the business website. Try it like a real caller, then book a setup call if it fits.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-accent/10 bg-white/[0.04] p-4">
                <Globe2 className="mb-3 h-5 w-5 text-accent" />
                <p className="text-sm text-white/45">Website source</p>
                <p className="mt-1 truncate text-sm font-semibold text-white">
                  {demo.website_url}
                </p>
              </div>
              <div className="rounded-lg border border-accent/10 bg-white/[0.04] p-4">
                <MessageSquareText className="mb-3 h-5 w-5 text-accent" />
                <p className="text-sm text-white/45">Status</p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {demo.status}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-accent/15 bg-[#102020]/95 p-5 shadow-2xl">
            <div className="mb-6 text-center">
              <div className="mx-auto mb-5 flex h-28 w-28 items-center justify-center rounded-full bg-accent text-[#172929] shadow-[0_0_60px_rgba(125,232,235,0.25)]">
                <Bot className="h-11 w-11" />
              </div>
              <h2 className="text-2xl font-black text-white">
                Talk to the demo agent
              </h2>
              <p className="mt-2 text-sm text-white/55">
                Enter your mobile and the WiseCall demo agent calls you back.
              </p>
            </div>
            <CallbackForm source={`portal_demo_${id}`} />
          </div>
        </section>
      </div>
    </main>
  );
}
