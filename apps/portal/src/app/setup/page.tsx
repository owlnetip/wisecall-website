import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GuestSetup } from "@/components/guest-setup";
import { parseSetupEmail, parseSetupPhone } from "@/lib/guest-auto-ring";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dashboardSetupPath, parseNoWebsite, parseSetupWebsite } from "@/lib/setup-website";

export const metadata: Metadata = {
  title: "Hear WiseCall",
  description:
    "Enter your UK mobile. We call you so you can hear the receptionist. No account first.",
  robots: { index: false, follow: true },
};

export default async function GuestSetupPage({
  searchParams,
}: {
  searchParams: Promise<{
    website?: string;
    trial?: string;
    phone?: string;
    email?: string;
    nowebsite?: string;
  }>;
}) {
  const { website, phone, email, nowebsite } = await searchParams;
  const setupWebsite = parseSetupWebsite(website) ?? "";
  const noWebsite = parseNoWebsite(nowebsite) && !setupWebsite;
  const setupPhone = parseSetupPhone(phone);
  const setupEmail = parseSetupEmail(email);

  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      redirect(dashboardSetupPath(setupWebsite || undefined));
    }
  }

  return (
    <GuestSetup
      initialWebsite={setupWebsite}
      initialPhone={setupPhone}
      initialEmail={setupEmail}
      noWebsite={noWebsite}
    />
  );
}
