import Link from "next/link";
import { requireAdminUser } from "@/lib/auth";
import { listBrands } from "@/lib/marketing/db";
import { ArrowRight } from "lucide-react";

export default async function HomePage() {
  await requireAdminUser();
  const brands = await listBrands();

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-4xl px-4 py-16">
        <p className="text-xs uppercase tracking-[0.2em] text-accent">Internal tool</p>
        <h1 className="mt-2 text-3xl font-bold text-white">AI Marketing Studio</h1>
        <p className="mt-3 max-w-2xl text-muted">
          Brand Brain and content drafts for WiseCall and Owlnet. Phase 1: research-backed
          copy generation with human approval before publishing.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {brands.map((brand) => (
            <Link
              key={brand.id}
              href={`/${brand.slug}`}
              className="group rounded-2xl border border-accent/15 bg-panel/60 p-6 transition hover:border-accent/40"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-white">{brand.name}</h2>
                  <p className="mt-2 text-sm text-muted">{brand.tagline}</p>
                </div>
                <ArrowRight
                  size={20}
                  className="text-accent opacity-60 transition group-hover:translate-x-1 group-hover:opacity-100"
                />
              </div>
            </Link>
          ))}
        </div>

        {brands.length === 0 ? (
          <p className="mt-8 rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-200">
            No brands found. Run the Supabase migration{" "}
            <code className="text-amber-100">20260630120000_marketing_studio.sql</code> to seed
            WiseCall and Owlnet workspaces.
          </p>
        ) : null}
      </div>
    </main>
  );
}
