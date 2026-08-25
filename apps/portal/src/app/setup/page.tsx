import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GuestSetup } from "@/components/guest-setup";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dashboardSetupPath, parseSetupWebsite } from "@/lib/setup-website";

export const metadata: Metadata = {
  title: "Build your WiseCall receptionist",
  description: "Paste your website. We draft the receptionist. Create an account to get your number and 20 free inbound AI calls.",
};

export default async function GuestSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ website?: string; trial?: string }>;
}) {
  const { website } = await searchParams;
  const setupWebsite = parseSetupWebsite(website) ?? "";

  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      redirect(dashboardSetupPath(setupWebsite || undefined));
    }
  }

  return <GuestSetup initialWebsite={setupWebsite} />;
}
