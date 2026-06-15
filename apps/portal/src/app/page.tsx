import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Building2,
  LayoutDashboard,
  LockKeyhole,
  MessageSquareText,
  PhoneCall,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { DemoRequestForm } from "@/components/demo-request-form";

const workflow = [
  {
    icon: Building2,
    title: "Website to demo agent",
    body: "A prospect enters their mobile, website, industry and business name. WiseCall stores the request and creates a demo token.",
  },
  {
    icon: MessageSquareText,
    title: "SMS demo link",
    body: "The app can queue or trigger an SMS with a private demo URL and setup-call link when the SMS webhook is configured.",
  },
  {
    icon: LockKeyhole,
    title: "Customer isolation",
    body: "Customers only see their own agents and calls. Admin users can view every customer and agent through the internal console.",
  },
];

const portalAreas = [
  {
    href: "/demo/new",
    title: "Demo intake",
    body: "Create a website-based demo agent request and generate a shareable demo link.",
    icon: Sparkles,
  },
  {
    href: "/dashboard",
    title: "Customer portal",
    body: "Customer view for owned agents, call logs, transcripts and setup progress.",
    icon: LayoutDashboard,
  },
  {
    href: "/admin",
    title: "Owlnet admin",
    body: "Internal view across all customers, demo agents, production agents and SMS status.",
    icon: ShieldCheck,
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="border-b border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(125,232,235,0.16),transparent_32%),linear-gradient(135deg,#172929,#101d1d)]">
        <div className="mx-auto grid min-h-screen max-w-7xl gap-10 px-6 py-8 lg:grid-cols-[1fr_440px] lg:items-center">
          <div className="pt-20 lg:pt-0">
            <div className="mb-8 inline-flex items-center gap-2 rounded-lg border border-accent/20 bg-white/5 px-3 py-2 text-sm font-semibold text-accent">
              <span className="h-2 w-2 rounded-full bg-accent" />
              UK Vercel portal foundation
            </div>
            <h1 className="max-w-4xl text-5xl font-black leading-tight text-white md:text-7xl">
              Demo agents and customer portals for WiseCall.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-white/70">
              A separate app for <span className="text-white">app.wisecall.io</span> that uses the existing Supabase project, creates demo-agent links from a website URL, and keeps customer data isolated from the public marketing site.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/demo/new"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-6 py-3 text-sm font-bold text-[#172929] shadow-[0_0_28px_rgba(125,232,235,0.24)] transition hover:bg-accent-soft"
              >
                Create a demo link
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/admin"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-accent/25 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                View admin shell
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-accent/15 bg-[#122424]/92 p-5 shadow-2xl">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <p className="font-bold text-white">Demo request</p>
                <p className="text-sm text-white/50">Website + mobile to SMS link</p>
              </div>
            </div>
            <DemoRequestForm />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16">
        <div className="grid gap-4 md:grid-cols-3">
          {workflow.map((item) => (
            <div key={item.title} className="rounded-lg border border-accent/10 bg-white/[0.04] p-6">
              <item.icon className="mb-5 h-7 w-7 text-accent" />
              <h2 className="text-lg font-bold text-white">{item.title}</h2>
              <p className="mt-3 text-sm leading-6 text-white/60">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-white/10 bg-white/[0.025]">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <div className="mb-8 flex items-end justify-between gap-6">
            <div>
              <p className="text-sm font-semibold text-accent">Portal areas</p>
              <h2 className="mt-2 text-3xl font-black text-white">Built as a separate Vercel app</h2>
            </div>
            <div className="hidden items-center gap-2 text-sm text-white/55 md:flex">
              <PhoneCall className="h-4 w-4 text-accent" />
              Functions configured for London: lhr1
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {portalAreas.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group rounded-lg border border-accent/10 bg-[#122424] p-6 transition hover:border-accent/35 hover:bg-[#172929]"
              >
                <item.icon className="mb-5 h-7 w-7 text-accent" />
                <h3 className="text-xl font-bold text-white">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-white/60">{item.body}</p>
                <span className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-accent">
                  Open
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
