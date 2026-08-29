import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GuestSetup } from "@/components/guest-setup";
import { parseSetupEmail, parseSetupPhone } from "@/lib/guest-auto-ring";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dashboardSetupPath, parseSetupWebsite } from "@/lib/setup-website";

export const metadata: Metadata = {
  title: "Build your WiseCall receptionist",
  description:
    "Paste your website and UK mobile. We draft the receptionist and call you when it is ready. No account first.",
  robots: { index: false, follow: true },
};

export default async function GuestSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ website?: string; trial?: string; phone?: string; email?: string }>;
}) {
  const { website, phone, email } = await searchParams;
  const setupWebsite = parseSetupWebsite(website) ?? "";
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
    />
  );
}
