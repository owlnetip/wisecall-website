import Link from "next/link";
import { signOutAction } from "@/app/actions/auth";
import type { BrandSlug } from "@/lib/marketing/types";
import { Brain, Calendar, FileText, Library, LogOut, Search } from "lucide-react";

export function WorkspaceNav({
  brand,
  brandName,
  active,
}: {
  brand: BrandSlug;
  brandName: string;
  active: "brain" | "research" | "campaigns" | "drafts" | "library";
}) {
  const links = [
    { href: `/${brand}`, key: "brain" as const, label: "Brand Brain", icon: Brain },
    { href: `/${brand}/research`, key: "research" as const, label: "Research", icon: Search },
    { href: `/${brand}/campaigns`, key: "campaigns" as const, label: "Campaigns", icon: Calendar },
    { href: `/${brand}/drafts`, key: "drafts" as const, label: "Draft Studio", icon: FileText },
    { href: `/${brand}/library`, key: "library" as const, label: "Content Library", icon: Library },
  ];

  return (
    <header className="border-b border-accent/10 bg-panel/60">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4">
        <div>
          <Link href="/" className="text-xs uppercase tracking-wide text-muted">
            Marketing Studio
          </Link>
          <h1 className="text-lg font-semibold text-white">{brandName}</h1>
        </div>

        <nav className="flex flex-wrap items-center gap-2">
          {links.map(({ href, key, label, icon: Icon }) => (
            <Link
              key={key}
              href={href}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                active === key
                  ? "bg-accent/15 text-accent"
                  : "text-muted hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon size={16} />
              {label}
            </Link>
          ))}
        </nav>

        <form action={signOutAction}>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-lg border border-accent/20 px-3 py-2 text-sm text-muted hover:text-white"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
