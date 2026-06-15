import Link from "next/link";
import { Bot, LayoutDashboard, ShieldCheck, Sparkles } from "lucide-react";

const nav = [
  { href: "/", label: "Home", icon: Sparkles },
  { href: "/demo/new", label: "Demo", icon: Bot },
  { href: "/dashboard", label: "Customer", icon: LayoutDashboard },
  { href: "/admin", label: "Admin", icon: ShieldCheck },
];

export function AppShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-white/10 bg-[#102020]/90">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-4">
          <Link href="/" className="text-lg font-black text-white">
            WiseCall Portal
          </Link>
          <nav className="hidden items-center gap-2 md:flex">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white/60 transition hover:bg-white/5 hover:text-white"
              >
                <item.icon className="h-4 w-4 text-accent" />
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <section className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-4xl font-black text-white">{title}</h1>
          <p className="mt-3 max-w-2xl text-white/60">{subtitle}</p>
        </div>
        {children}
      </section>
    </main>
  );
}
