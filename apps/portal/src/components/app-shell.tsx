"use client";

import Link from "next/link";
import { Bot, LayoutDashboard, Menu, ShieldCheck, Sparkles, X } from "lucide-react";
import { useState } from "react";

const nav = [
  { href: "/", label: "Home", icon: Sparkles },
  { href: "/demo/new", label: "Demo", icon: Bot },
  { href: "/dashboard", label: "Agents", icon: LayoutDashboard },
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="relative border-b border-white/10 bg-[#102020]/90">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
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
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open menu"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 text-white/80 transition hover:bg-white/5 md:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
        {mobileNavOpen ? (
          <div className="fixed inset-0 z-50 md:hidden">
            <div className="absolute inset-0 bg-black/50" onClick={() => setMobileNavOpen(false)} />
            <aside className="absolute right-0 top-0 flex h-full w-[min(280px,88vw)] flex-col bg-[#172929] shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
                <span className="font-black text-white">Menu</span>
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  aria-label="Close menu"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-white/60 hover:bg-white/5 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="flex flex-col gap-1 p-3">
                {nav.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileNavOpen(false)}
                    className="inline-flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold text-white/70 transition hover:bg-white/5 hover:text-white"
                  >
                    <item.icon className="h-4 w-4 text-accent" />
                    {item.label}
                  </Link>
                ))}
              </nav>
            </aside>
          </div>
        ) : null}
      </header>
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-black text-white sm:text-4xl">{title}</h1>
          <p className="mt-3 max-w-2xl text-sm text-white/60 sm:text-base">{subtitle}</p>
        </div>
        {children}
      </section>
    </main>
  );
}
